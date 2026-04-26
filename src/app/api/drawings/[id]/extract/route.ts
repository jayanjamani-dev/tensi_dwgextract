import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractTextFromPdf, extractTextFromRegions, renderPageAsImage, TextElement } from "@/lib/pdfplumber";
import { detectCoverSheet, isLikelyCoverSheetByFilename } from "@/lib/cover-sheet";
import { extractWithGemini, extractWithGeminiVision } from "@/lib/gemini";
import { validateExtraction, crossValidateWithElements } from "@/lib/validate-extraction";
import {
  getTemplateContext,
  resolveArchitectAndLearnTemplate,
  preResolveArchitectFromSibling,
} from "@/lib/templates";
import type { GeminiCallMetrics } from "@/lib/api-metrics";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pipelineStart = Date.now();

  const drawing = await prisma.drawing.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true } },
      architect: { select: { id: true, firmName: true } },
    },
  });
  if (!drawing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.drawing.update({
    where: { id },
    data: { extractionStatus: "processing" },
  });

  const pipelineFlags: string[] = [];

  try {
    // ── Step 0: Pre-resolve architect from sibling ────────────────
    let activeArchitectId = drawing.architectId;
    if (!activeArchitectId) {
      const siblingArchitectId = await preResolveArchitectFromSibling(id, drawing.project.id);
      if (siblingArchitectId) {
        activeArchitectId = siblingArchitectId;
        pipelineFlags.push("ARCH_PRE_RESOLVED_FROM_SIBLING");
        await prisma.drawing.update({ where: { id }, data: { architectId: siblingArchitectId } });
      }
    }

    // ── Step 1: PDF extraction (three-zone, unconditional) ────────
    // Cover sheets use full-page extraction so the drawing list table in the
    // middle of the page is visible to Gemini. All other drawings use the
    // three-zone extractor (bottom 25% + right 25% + left-bottom 15%).
    const pdfStart = Date.now();
    let elements: TextElement[] = [];
    let pdfError: string | undefined;
    let scanned = false;

    const likelyCoverSheetByName = isLikelyCoverSheetByFilename(drawing.filename);

    if (likelyCoverSheetByName) {
      pipelineFlags.push("COVER_SHEET_FULL_PAGE");
      const fullResult = await extractTextFromPdf(drawing.filepath, drawing.pageNumber);
      if (fullResult.error) {
        pdfError = fullResult.error;
      } else {
        elements = fullResult.elements;
        scanned = fullResult.scanned;
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
        where: { id },
        data: {
          extractionStatus: "extracted",
          flags: JSON.stringify([...pipelineFlags, "PDF_EXTRACTION_ERROR"]),
          notes: pdfError,
          pdfplumberTimeMs,
          processingTimeMs: Date.now() - pipelineStart,
        },
      });
      return NextResponse.json({ error: pdfError }, { status: 500 });
    }

    // ── Step 2: Cover sheet detection ────────────────────────────
    const isCoverSheet = detectCoverSheet(elements, drawing.filename);
    if (isCoverSheet) {
      pipelineFlags.push("COVER_SHEET");
    }

    // ── Step 2.5: Vision fallback for scanned PDFs ────────────────
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
          where: { id },
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
        return NextResponse.json({ status: "scanned", flags: [...pipelineFlags, "VISION_RENDER_FAILED"] });
      }
    }

    // ── Step 3: Gemini extraction ─────────────────────────────────
    const templateContext = await getTemplateContext(activeArchitectId);
    let geminiMetrics: GeminiCallMetrics | undefined;

    let geminiResult;
    try {
      const rateDelay = parseInt(process.env.GEMINI_RATE_DELAY_MS || "200", 10);
      if (rateDelay > 0) await new Promise((r) => setTimeout(r, rateDelay));

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
            drawingId: id,
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

      const processingTimeMs = Date.now() - pipelineStart;
      await prisma.drawing.update({
        where: { id },
        data: {
          extractionStatus: "extracted",
          pdfplumberRaw: JSON.stringify(elements),
          flags: JSON.stringify([...pipelineFlags, errorFlag]),
          notes: errMsg,
          extractedAt: new Date(),
          pdfplumberTimeMs,
          processingTimeMs,
          totalInputTokens: errMetrics?.usage.inputTokens ?? 0,
          totalOutputTokens: errMetrics?.usage.outputTokens ?? 0,
          totalCostUsd: errMetrics?.costUsd ?? 0,
        },
      });
      return NextResponse.json({ error: errMsg }, { status: 500 });
    }

    // ── Step 4: Validation ────────────────────────────────────────
    const confidenceThreshold = parseFloat(process.env.CONFIDENCE_THRESHOLD || "0.7");
    const validated = await validateExtraction(geminiResult, confidenceThreshold);
    crossValidateWithElements(validated, elements, geminiResult);

    const processingTimeMs = Date.now() - pipelineStart;
    const allFlags = [...new Set([...pipelineFlags, ...validated.flags])];

    // ── Step 4.5: Inject pipeline source into extractionRules ─────
    const pipelineSource = useVision ? "vision" : "region";
    const hasRevBlock =
      validated.revisionBlockLocation !== "none" &&
      validated.revisionBlockLocation !== "unknown" &&
      validated.revisionBlockLocation !== null;
    const revSource = hasRevBlock ? "revision_block" : pipelineSource;

    validated.extractionRules.drawingNumber.source = pipelineSource;
    validated.extractionRules.drawingTitle.source  = pipelineSource;
    validated.extractionRules.revision.source      = revSource;
    validated.extractionRules.revision.blockLocation = validated.revisionBlockLocation || undefined;
    validated.extractionRules.revisionDate.source  = revSource;
    validated.extractionRules.revisionDate.blockLocation = validated.revisionBlockLocation || undefined;
    validated.extractionRules.status.source        = pipelineSource;

    // Persist ApiCall record
    if (geminiMetrics) {
      await prisma.apiCall.create({
        data: {
          drawingId: id,
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

    // ── Step 5: Architect resolution + template enrichment ────────
    const templateResult = await resolveArchitectAndLearnTemplate({
      drawingId: id,
      drawingNumber: validated.drawingNumber,
      titleBlockLocation: validated.titleBlockLocation,
      revisionBlockLocation: validated.revisionBlockLocation,
      elements,
      projectId: drawing.project.id,
      projectName: drawing.project.name,
      existingArchitectId: activeArchitectId,
      geminiArchitectFirmName: geminiResult.architect_firm_name,
      revision: validated.revision,
      revisionDate: validated.revisionDate,
      revisionDateRaw: geminiResult.revision_date,
      status: validated.status,
    });

    const finalFlags = [...new Set([...allFlags, ...templateResult.flags])];
    console.log(`[extract] ${drawing.filename}: template=${templateResult.log.join(' | ')}`);

    // ── Step 6: Write to DB ───────────────────────────────────────
    const updated = await prisma.drawing.update({
      where: { id },
      data: {
        drawingNumber: validated.drawingNumber,
        drawingTitle: validated.drawingTitle,
        revision: validated.revision,
        revisionDate: validated.revisionDate,
        status: validated.status,
        location: validated.location,
        fieldCoordinates: validated.fieldCoordinates ? JSON.stringify(validated.fieldCoordinates) : null,
        extractionRules: JSON.stringify(validated.extractionRules),
        drawingRegister: geminiResult.drawing_register ? JSON.stringify(geminiResult.drawing_register) : null,
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
        flags: JSON.stringify(finalFlags),
        notes: validated.notes,
        extractionStatus:
          validated.documentType === "cover_sheet" || isCoverSheet
            ? "cover_sheet"
            : "extracted",
        extractedAt: new Date(),
        pdfplumberTimeMs,
        processingTimeMs,
        totalInputTokens: geminiMetrics?.usage.inputTokens ?? 0,
        totalOutputTokens: geminiMetrics?.usage.outputTokens ?? 0,
        totalCostUsd: geminiMetrics?.costUsd ?? 0,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await prisma.drawing.update({
      where: { id },
      data: {
        extractionStatus: "extracted",
        flags: JSON.stringify([...pipelineFlags, "EXTRACTION_ERROR"]),
        notes: errMsg,
        processingTimeMs: Date.now() - pipelineStart,
      },
    });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
