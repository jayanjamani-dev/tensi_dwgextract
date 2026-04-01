import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractTextFromPdf, extractTextFromRegions, extractTextFromCrop, TextElement } from "@/lib/pdfplumber";
import { detectCoverSheet } from "@/lib/cover-sheet";
import { extractWithGemini } from "@/lib/gemini";
import { validateExtraction } from "@/lib/validate-extraction";
import {
  getTemplateContext,
  getTemplatePattern,
  saveTemplatePattern,
  incrementPatternConfirmation,
  validatePatternMatch,
  inferDrawingNumberFormat,
  getProjectExtractedCount,
  getProjectConfirmedSide,
  TitleBlockPattern,
  TitleBlockBbox,
} from "@/lib/templates";
import type { GeminiCallMetrics } from "@/lib/api-metrics";

const PATTERN_LOCK_THRESHOLD = 2; // Confirm pattern after this many successful drawings

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
    // ── Step 1: Smart PDF extraction ───────────────────────────────
    const pdfStart = Date.now();
    let elements: TextElement[] = [];
    let pdfError: string | undefined;
    let scanned = false;
    let cropMode = false;
    let detectedSide: "bottom" | "right" | "unknown" = "unknown";
    let usedBbox: TitleBlockBbox | null = null;

    // Check for existing architect template pattern
    const existingPattern = await getTemplatePattern(drawing.architectId);

    if (existingPattern && existingPattern.confirmedDrawingCount >= PATTERN_LOCK_THRESHOLD) {
      // ── CROP MODE: Use known title block bbox ──
      const cropResult = await extractTextFromCrop(
        drawing.filepath,
        drawing.pageNumber,
        existingPattern.bbox
      );

      if (cropResult.error) {
        pdfError = cropResult.error;
      } else if (cropResult.elements.length === 0) {
        // Crop returned nothing — fall back to regions
        pipelineFlags.push("CROP_EMPTY_FALLBACK");
        const regionResult = await extractTextFromRegions(drawing.filepath, drawing.pageNumber);
        elements = regionResult.elements;
        scanned = regionResult.scanned;
        pdfError = regionResult.error;
        detectedSide = regionResult.titleBlockSide;
      } else {
        // Validate pattern still matches this drawing
        const match = validatePatternMatch(
          cropResult.elements,
          existingPattern,
          drawing.project.name,
          undefined // drawingNumber unknown yet
        );

        if (match.matched) {
          elements = cropResult.elements;
          scanned = cropResult.scanned;
          cropMode = true;
          usedBbox = existingPattern.bbox;
          pipelineFlags.push("CROP_MODE");
        } else {
          // Pattern mismatch — fall back to regions
          pipelineFlags.push("PATTERN_MISMATCH");
          const regionResult = await extractTextFromRegions(drawing.filepath, drawing.pageNumber);
          elements = regionResult.elements;
          scanned = regionResult.scanned;
          pdfError = regionResult.error;
          detectedSide = regionResult.titleBlockSide;
        }
      }
    } else {
      // ── REGION MODE: Scan bottom strip + right column ──
      const extractedCount = await getProjectExtractedCount(drawing.project.id);
      const confirmedSide = await getProjectConfirmedSide(drawing.project.id);

      if (extractedCount >= PATTERN_LOCK_THRESHOLD && confirmedSide) {
        // Project has confirmed a side from first 2 drawings — use that region only
        detectedSide = confirmedSide;
        pipelineFlags.push("PROJECT_SIDE_LOCKED");
      }

      const regionResult = await extractTextFromRegions(drawing.filepath, drawing.pageNumber);

      if (regionResult.error) {
        pdfError = regionResult.error;
      } else {
        elements = regionResult.elements;
        scanned = regionResult.scanned;
        detectedSide = regionResult.titleBlockSide;

        // If we have enough elements, use the regional scan; otherwise fallback to full page
        if (elements.length < 5 && !scanned) {
          pipelineFlags.push("REGION_SPARSE_FALLBACK");
          const fullResult = await extractTextFromPdf(drawing.filepath, drawing.pageNumber);
          elements = fullResult.elements;
          scanned = fullResult.scanned;
          pdfError = fullResult.error;
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

    // ── Step 2: Cover sheet detection ─────────────────────────────
    // For cover sheet detection, need full-page text — use extracted elements as-is
    const isCoverSheet = detectCoverSheet(elements, drawing.filename);
    if (isCoverSheet || scanned) {
      const flags = [...pipelineFlags];
      if (isCoverSheet) flags.push("COVER_SHEET");
      if (scanned) flags.push("SCANNED");

      await prisma.drawing.update({
        where: { id },
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
      return NextResponse.json({ status: isCoverSheet ? "cover_sheet" : "scanned", flags });
    }

    // ── Step 3: Gemini extraction ─────────────────────────────────
    const templateContext = await getTemplateContext(drawing.architectId);
    let geminiMetrics: GeminiCallMetrics | undefined;

    let geminiResult;
    try {
      // Rate delay
      const rateDelay = parseInt(process.env.GEMINI_RATE_DELAY_MS || "200", 10);
      if (rateDelay > 0) await new Promise((r) => setTimeout(r, rateDelay));

      const response = await extractWithGemini(elements, templateContext);
      geminiResult = response.result;
      geminiMetrics = response.metrics;
    } catch (err) {
      const errMetrics = (err as { metrics?: GeminiCallMetrics }).metrics;
      const errMsg = err instanceof Error ? err.message : String(err);

      if (errMetrics) {
        await prisma.apiCall.create({
          data: {
            drawingId: id,
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

      const processingTimeMs = Date.now() - pipelineStart;
      await prisma.drawing.update({
        where: { id },
        data: {
          extractionStatus: "extracted",
          pdfplumberRaw: JSON.stringify(elements),
          flags: JSON.stringify([...pipelineFlags, "GEMINI_PARSE_ERROR"]),
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
    const validated = validateExtraction(geminiResult, confidenceThreshold);
    const processingTimeMs = Date.now() - pipelineStart;

    // Merge pipeline flags into validated flags
    const allFlags = [...new Set([...pipelineFlags, ...validated.flags])];

    // Persist ApiCall record
    if (geminiMetrics) {
      await prisma.apiCall.create({
        data: {
          drawingId: id,
          model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
          callType: cropMode ? "extract_crop" : "extract",
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

    // ── Step 5: Template Learning ─────────────────────────────────
    if (drawing.architectId && validated.drawingNumber) {
      const architectId = drawing.architectId;

      if (cropMode) {
        // Already using a confirmed pattern — increment count
        await incrementPatternConfirmation(architectId);
        allFlags.push("PATTERN_CONFIRMED");
      } else {
        // Region mode — learn from this drawing
        const currentPattern = await getTemplatePattern(architectId);
        const extractedCount = await getProjectExtractedCount(drawing.project.id);

        const side = validated.titleBlockLocation === "right" ? "right" as const : "bottom" as const;
        const drawingNumberFormat = inferDrawingNumberFormat(validated.drawingNumber);

        // Filter out null field coordinates
        const cleanFieldPositions: Record<string, { x: number; y: number }> = {};
        if (validated.fieldCoordinates) {
          for (const [key, value] of Object.entries(validated.fieldCoordinates)) {
            if (value) cleanFieldPositions[key] = value;
          }
        }

        if (!currentPattern) {
          // First drawing from this architect — create candidate pattern
          const regionBbox = side === "bottom"
            ? { x0: 0, y0: (elements[0]?.page_height ?? 842) * 0.75, x1: elements[0]?.page_width ?? 595, y1: elements[0]?.page_height ?? 842 }
            : { x0: (elements[0]?.page_width ?? 595) * 0.70, y0: 0, x1: elements[0]?.page_width ?? 595, y1: elements[0]?.page_height ?? 842 };

          const newPattern: TitleBlockPattern = {
            side,
            bbox: regionBbox,
            confirmedDrawingCount: 1,
            architectFirmName: drawing.architect?.firmName ?? "Unknown",
            projectName: drawing.project.name,
            drawingNumberFormat: drawingNumberFormat ?? undefined,
          };

          await saveTemplatePattern(
            architectId,
            newPattern,
            validated.titleBlockLocation,
            validated.revisionBlockLocation,
            Object.keys(cleanFieldPositions).length > 0 ? cleanFieldPositions : null
          );
        } else if (currentPattern.confirmedDrawingCount < PATTERN_LOCK_THRESHOLD) {
          // Building confidence — check if this drawing agrees with the prior pattern
          if (currentPattern.side === side) {
            currentPattern.confirmedDrawingCount += 1;
            // Merge drawing number format if first one was missing
            if (!currentPattern.drawingNumberFormat && drawingNumberFormat) {
              currentPattern.drawingNumberFormat = drawingNumberFormat;
            }
            await saveTemplatePattern(
              architectId,
              currentPattern,
              validated.titleBlockLocation,
              validated.revisionBlockLocation,
              Object.keys(cleanFieldPositions).length > 0 ? cleanFieldPositions : null
            );

            if (currentPattern.confirmedDrawingCount >= PATTERN_LOCK_THRESHOLD) {
              allFlags.push("PATTERN_LOCKED");
            }
          }
          // If sides disagree, leave the pattern as-is — more data needed
        } else {
          // Pattern already locked but we're not in crop mode (e.g. new project, mismatch fallback)
          // Just increment if the side matches
          if (currentPattern.side === side) {
            await incrementPatternConfirmation(architectId);
            allFlags.push("PATTERN_CONFIRMED");
          }
        }
      }
    }

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
