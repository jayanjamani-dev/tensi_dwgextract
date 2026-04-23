import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractTextFromRegions, extractTextFromCrop, renderPageAsImage, TextElement } from "@/lib/pdfplumber";
import { detectCoverSheet } from "@/lib/cover-sheet";
import { extractWithGemini, extractWithGeminiVision } from "@/lib/gemini";
import { validateExtraction, crossValidateWithElements } from "@/lib/validate-extraction";
import {
  getTemplateContext,
  getTemplatePattern,
  resolveArchitectAndLearnTemplate,
  preResolveArchitectFromSibling,
} from "@/lib/templates";
import type { GeminiCallMetrics } from "@/lib/api-metrics";

// Paid tier: ~1000 RPM. Free tier: 20 RPM (set GEMINI_RATE_DELAY_MS=3500).
const RATE_DELAY_MS = parseInt(process.env.GEMINI_RATE_DELAY_MS || "200");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const drawings = await prisma.drawing.findMany({
    where: { projectId, extractionStatus: "pending" },
    orderBy: { pageNumber: "asc" },
  });

  if (drawings.length === 0) {
    return NextResponse.json({ message: "No pending drawings", processed: 0 });
  }

  const results = [];
  const confidenceThreshold = parseFloat(process.env.CONFIDENCE_THRESHOLD || "0.7");
  let geminiCallCount = 0;

  for (const drawing of drawings) {
    const pipelineStart = Date.now();
    const pipelineFlags: string[] = [];

    await prisma.drawing.update({
      where: { id: drawing.id },
      data: { extractionStatus: "processing" },
    });

    try {
      // ── Step 0: Template-first — pre-resolve architect before extraction ──
      let activeArchitectId = drawing.architectId ?? null;
      if (!activeArchitectId) {
        const siblingArchitectId = await preResolveArchitectFromSibling(drawing.id, projectId);
        if (siblingArchitectId) {
          activeArchitectId = siblingArchitectId;
          pipelineFlags.push("ARCH_PRE_RESOLVED_FROM_SIBLING");
          await prisma.drawing.update({ where: { id: drawing.id }, data: { architectId: siblingArchitectId } });
        }
      }

      // ── Step 1: Smart PDF extraction (region mode or template-first crop) ──
      const pdfStart = Date.now();
      let elements: TextElement[] = [];
      let scanned = false;
      let pdfError: string | undefined;

      // Use locked template pattern for crop mode if available
      const PATTERN_LOCK_THRESHOLD = 2;
      const existingPattern = await getTemplatePattern(activeArchitectId);
      if (existingPattern && existingPattern.confirmedDrawingCount >= PATTERN_LOCK_THRESHOLD) {
        pipelineFlags.push("TEMPLATE_FAST_PATH");
        const cropResult = await extractTextFromCrop(drawing.filepath, drawing.pageNumber, existingPattern.bbox);
        if (!cropResult.error && cropResult.elements.length > 0) {
          elements = cropResult.elements;
          scanned = cropResult.scanned;
          pipelineFlags.push("CROP_MODE");
        } else if (cropResult.error) {
          // Crop extraction itself errored — fall back to region mode
          pipelineFlags.push("CROP_ERROR_FALLBACK");
          const regionResult = await extractTextFromRegions(drawing.filepath, drawing.pageNumber);
          if (regionResult.error) { pdfError = regionResult.error; }
          else { elements = regionResult.elements; scanned = regionResult.scanned; }
        } else {
          // Crop succeeded but returned 0 elements — PDF has no text layer in the title block area.
          // Skip region extraction (same file would also timeout on large A0/A1 PDFs).
          // Set scanned=true to trigger Vision fallback instead.
          pipelineFlags.push("CROP_EMPTY_SCANNED");
          scanned = true;
        }
      } else {
        const regionResult = await extractTextFromRegions(drawing.filepath, drawing.pageNumber);
        if (regionResult.error) {
          pdfError = regionResult.error;
        } else {
          elements = regionResult.elements;
          scanned = regionResult.scanned;
          if (elements.length < 5 && !scanned) {
            pipelineFlags.push("REGION_SPARSE");
          }
        }
      }

      const pdfplumberTimeMs = Date.now() - pdfStart;

      if (pdfError) {
        await prisma.drawing.update({
          where: { id: drawing.id },
          data: {
            extractionStatus: "extracted",
            flags: JSON.stringify([...pipelineFlags, "PDF_EXTRACTION_ERROR"]),
            notes: pdfError,
            pdfplumberTimeMs,
            processingTimeMs: Date.now() - pipelineStart,
          },
        });
        results.push({ id: drawing.id, filename: drawing.filename, page: drawing.pageNumber, status: "error", error: pdfError });
        continue;
      }

      // ── Step 2: Cover sheet detection ──────────────────────────────
      const isCoverSheet = detectCoverSheet(elements, drawing.filename);
      if (isCoverSheet) {
        await prisma.drawing.update({
          where: { id: drawing.id },
          data: {
            extractionStatus: "cover_sheet",
            documentType: "cover_sheet",
            pdfplumberRaw: JSON.stringify(elements),
            flags: JSON.stringify([...pipelineFlags, "COVER_SHEET"]),
            extractedAt: new Date(),
            pdfplumberTimeMs,
            processingTimeMs: Date.now() - pipelineStart,
          },
        });
        results.push({ id: drawing.id, filename: drawing.filename, page: drawing.pageNumber, status: "cover_sheet" });
        continue;
      }

      // ── Step 2.5: Vision fallback for scanned PDFs ─────────────────
      let useVision = false;
      let visionImageBase64 = "";
      if (scanned) {
        pipelineFlags.push("SCANNED");
        const imgResult = await renderPageAsImage(drawing.filepath, drawing.pageNumber);
        if (!imgResult.error && imgResult.imageBase64) {
          useVision = true;
          visionImageBase64 = imgResult.imageBase64;
          pipelineFlags.push("VISION_FALLBACK");
        } else {
          await prisma.drawing.update({
            where: { id: drawing.id },
            data: {
              extractionStatus: "extracted",
              documentType: "unknown",
              pdfplumberRaw: JSON.stringify(elements),
              flags: JSON.stringify([...pipelineFlags, "VISION_RENDER_FAILED"]),
              notes: imgResult.error ?? "Page rendered no image",
              extractedAt: new Date(),
              pdfplumberTimeMs,
              processingTimeMs: Date.now() - pipelineStart,
            },
          });
          results.push({ id: drawing.id, filename: drawing.filename, page: drawing.pageNumber, status: "scanned" });
          continue;
        }
      }

      // ── Step 3: Rate limiting ────────────────────────────────────
      if (geminiCallCount > 0) await sleep(RATE_DELAY_MS);
      geminiCallCount++;

      // ── Step 4: Gemini extraction ────────────────────────────────
      const templateContext = await getTemplateContext(activeArchitectId);
      let geminiMetrics: GeminiCallMetrics | undefined;
      let geminiResult;

      try {
        const response = useVision
          ? await extractWithGeminiVision(visionImageBase64, "image/png", templateContext)
          : await extractWithGemini(elements, templateContext);
        geminiResult = response.result;
        geminiMetrics = response.metrics;
        if (response.inputTruncated) pipelineFlags.push("INPUT_TRUNCATED");
      } catch (err) {
        const errMetrics = (err as { metrics?: GeminiCallMetrics }).metrics;
        const errMsg = err instanceof Error ? err.message : String(err);
        const isParseError = errMsg.includes("unparseable JSON");
        const errorFlag = isParseError ? "GEMINI_PARSE_ERROR" : "GEMINI_API_ERROR";

        if (errMetrics) {
          await prisma.apiCall.create({
            data: {
              drawingId: drawing.id,
              model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
              callType: useVision ? "extract_vision" : "extract",
              inputTokens: errMetrics.usage.inputTokens,
              outputTokens: errMetrics.usage.outputTokens,
              thinkingTokens: errMetrics.usage.thinkingTokens,
              totalTokens: errMetrics.usage.totalTokens,
              latencyMs: errMetrics.latencyMs,
              costUsd: errMetrics.costUsd,
              success: false,
              errorMessage: errMsg,
              retryCount: errMetrics.retryCount,
            },
          });
        }

        await prisma.drawing.update({
          where: { id: drawing.id },
          data: {
            extractionStatus: "extracted",
            pdfplumberRaw: JSON.stringify(elements),
            flags: JSON.stringify([...pipelineFlags, errorFlag]),
            notes: errMsg,
            extractedAt: new Date(),
            pdfplumberTimeMs,
            processingTimeMs: Date.now() - pipelineStart,
            totalInputTokens: errMetrics?.usage.inputTokens ?? 0,
            totalOutputTokens: errMetrics?.usage.outputTokens ?? 0,
            totalCostUsd: errMetrics?.costUsd ?? 0,
          },
        });
        results.push({ id: drawing.id, filename: drawing.filename, page: drawing.pageNumber, status: "error", error: errMsg });
        continue;
      }

      // ── Step 5: Validation ───────────────────────────────────────
      const validated = await validateExtraction(geminiResult, confidenceThreshold);
      crossValidateWithElements(validated, elements, geminiResult);
      const processingTimeMs = Date.now() - pipelineStart;

      // ── Step 6: Architect resolution + template learning ─────────
      const cleanFieldPositions: Record<string, { x: number; y: number }> = {};
      if (validated.fieldCoordinates) {
        for (const [key, value] of Object.entries(validated.fieldCoordinates)) {
          if (value) cleanFieldPositions[key] = value;
        }
      }

      const templateResult = await resolveArchitectAndLearnTemplate({
        drawingId: drawing.id,
        drawingNumber: validated.drawingNumber,
        titleBlockLocation: validated.titleBlockLocation,
        revisionBlockLocation: validated.revisionBlockLocation,
        fieldCoordinates: Object.keys(cleanFieldPositions).length > 0 ? cleanFieldPositions : null,
        elements,
        projectId,
        projectName: project.name,
        existingArchitectId: activeArchitectId,
        geminiArchitectFirmName: geminiResult.architect_firm_name,
        // Enriched metadata for template library (Task 2)
        revision: validated.revision,
        revisionDate: validated.revisionDate,
        revisionDateRaw: geminiResult.revision_date,
        status: validated.status,
      });

      const allFlags = [...new Set([...pipelineFlags, ...validated.flags, ...templateResult.flags])];
      console.log(`[extract-all] ${drawing.filename} p${drawing.pageNumber}: template=${templateResult.log.join(' | ')}`);

      // Persist ApiCall record
      if (geminiMetrics) {
        await prisma.apiCall.create({
          data: {
            drawingId: drawing.id,
            model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
            callType: useVision ? "extract_vision" : "extract",
            inputTokens: geminiMetrics.usage.inputTokens,
            outputTokens: geminiMetrics.usage.outputTokens,
            thinkingTokens: geminiMetrics.usage.thinkingTokens,
            totalTokens: geminiMetrics.usage.totalTokens,
            latencyMs: geminiMetrics.latencyMs,
            costUsd: geminiMetrics.costUsd,
            success: true,
            retryCount: geminiMetrics.retryCount,
          },
        });
      }

      await prisma.drawing.update({
        where: { id: drawing.id },
        data: {
          drawingNumber: validated.drawingNumber,
          drawingTitle: validated.drawingTitle,
          revision: validated.revision,
          revisionDate: validated.revisionDate,
          status: validated.status,
          location: validated.location,
          fieldCoordinates: validated.fieldCoordinates ? JSON.stringify(validated.fieldCoordinates) : null,
          extractionRules: JSON.stringify(validated.extractionRules),
          confidenceDrawingNumber: validated.confidenceDrawingNumber,
          confidenceDrawingTitle: validated.confidenceDrawingTitle,
          confidenceRevision: validated.confidenceRevision,
          confidenceRevisionDate: validated.confidenceRevisionDate,
          confidenceStatus: validated.confidenceStatus,
          confidenceLocation: validated.confidenceLocation,
          conflictDetected: validated.conflictDetected,
          conflictDetail: validated.conflictDetail,
          documentType: validated.documentType,
          titleBlockLocation: validated.titleBlockLocation,
          revisionBlockLocation: validated.revisionBlockLocation,
          extractionModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
          pdfplumberRaw: JSON.stringify(elements),
          flags: JSON.stringify(allFlags),
          notes: validated.notes,
          extractionStatus: "extracted",
          extractedAt: new Date(),
          pdfplumberTimeMs,
          processingTimeMs,
          totalInputTokens: geminiMetrics?.usage.inputTokens ?? 0,
          totalOutputTokens: geminiMetrics?.usage.outputTokens ?? 0,
          totalCostUsd: geminiMetrics?.costUsd ?? 0,
        },
      });

      results.push({ id: drawing.id, filename: drawing.filename, page: drawing.pageNumber, status: "extracted", flags: allFlags });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await prisma.drawing.update({
        where: { id: drawing.id },
        data: {
          extractionStatus: "extracted",
          flags: JSON.stringify([...pipelineFlags, "EXTRACTION_ERROR"]),
          notes: errMsg,
          processingTimeMs: Date.now() - pipelineStart,
        },
      });
      results.push({ id: drawing.id, filename: drawing.filename, page: drawing.pageNumber, status: "error", error: errMsg });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
