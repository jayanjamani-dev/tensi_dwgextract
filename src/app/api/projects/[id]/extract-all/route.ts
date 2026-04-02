import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractTextFromPdf, TextElement } from "@/lib/pdfplumber";
import { detectCoverSheet } from "@/lib/cover-sheet";
import { extractWithGemini } from "@/lib/gemini";
import { validateExtraction } from "@/lib/validate-extraction";
import { getTemplateContext, resolveArchitectAndLearnTemplate } from "@/lib/templates";
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

    await prisma.drawing.update({
      where: { id: drawing.id },
      data: { extractionStatus: "processing" },
    });

    try {
      // Step 1: pdfplumber
      const pdfStart = Date.now();
      let elements: TextElement[] = [];
      const pdfResult = await extractTextFromPdf(drawing.filepath, drawing.pageNumber);
      elements = pdfResult.elements;
      const scanned = pdfResult.scanned;
      const pdfError = pdfResult.error;
      const pdfplumberTimeMs = Date.now() - pdfStart;

      if (pdfError) {
        await prisma.drawing.update({
          where: { id: drawing.id },
          data: {
            extractionStatus: "extracted",
            flags: JSON.stringify(["PDF_EXTRACTION_ERROR"]),
            notes: pdfError,
            pdfplumberTimeMs,
            processingTimeMs: Date.now() - pipelineStart,
          },
        });
        results.push({ id: drawing.id, filename: drawing.filename, page: drawing.pageNumber, status: "error", error: pdfError });
        continue;
      }

      // Step 2: Cover sheet detection
      const isCoverSheet = detectCoverSheet(elements, drawing.filename);
      if (isCoverSheet || scanned) {
        const flags = [];
        if (isCoverSheet) flags.push("COVER_SHEET");
        if (scanned) flags.push("SCANNED");

        await prisma.drawing.update({
          where: { id: drawing.id },
          data: {
            extractionStatus: isCoverSheet ? "cover_sheet" : "extracted",
            documentType: isCoverSheet ? "cover_sheet" : "unknown",
            pdfplumberRaw: JSON.stringify(elements),
            flags: JSON.stringify(flags),
            extractedAt: new Date(),
            pdfplumberTimeMs,
            processingTimeMs: Date.now() - pipelineStart,
          },
        });
        results.push({ id: drawing.id, filename: drawing.filename, page: drawing.pageNumber, status: isCoverSheet ? "cover_sheet" : "scanned" });
        continue;
      }

      // Step 3: Rate limiting
      if (geminiCallCount > 0) await sleep(RATE_DELAY_MS);
      geminiCallCount++;

      // Step 4: Gemini extraction
      const templateContext = await getTemplateContext(drawing.architectId);
      let geminiMetrics: GeminiCallMetrics | undefined;
      let geminiResult;

      try {
        const response = await extractWithGemini(elements, templateContext);
        geminiResult = response.result;
        geminiMetrics = response.metrics;
      } catch (err) {
        const errMetrics = (err as { metrics?: GeminiCallMetrics }).metrics;
        const errMsg = err instanceof Error ? err.message : String(err);

        if (errMetrics) {
          await prisma.apiCall.create({
            data: {
              drawingId: drawing.id,
              model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
              callType: "extract",
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
            flags: JSON.stringify(["GEMINI_PARSE_ERROR"]),
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

      // Step 5: Validation
      const validated = await validateExtraction(geminiResult, confidenceThreshold);
      const processingTimeMs = Date.now() - pipelineStart;

      // Step 6: Architect resolution + template learning
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
        existingArchitectId: drawing.architectId,
        geminiArchitectFirmName: geminiResult.architect_firm_name,
      });

      const allFlags = [...new Set([...validated.flags, ...templateResult.flags])];
      console.log(`[extract-all] ${drawing.filename} p${drawing.pageNumber}: template=${templateResult.log.join(' | ')}`);

      // Persist ApiCall record
      if (geminiMetrics) {
        await prisma.apiCall.create({
          data: {
            drawingId: drawing.id,
            model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
            callType: "extract",
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
          confidenceDrawingNumber: validated.confidenceDrawingNumber,
          confidenceDrawingTitle: validated.confidenceDrawingTitle,
          confidenceRevision: validated.confidenceRevision,
          confidenceRevisionDate: validated.confidenceRevisionDate,
          confidenceStatus: validated.confidenceStatus,
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
          flags: JSON.stringify(["EXTRACTION_ERROR"]),
          notes: errMsg,
          processingTimeMs: Date.now() - pipelineStart,
        },
      });
      results.push({ id: drawing.id, filename: drawing.filename, page: drawing.pageNumber, status: "error", error: errMsg });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
