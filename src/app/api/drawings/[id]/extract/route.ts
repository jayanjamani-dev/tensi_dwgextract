import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractTextFromRegions, extractTextFromCrop, renderPageAsImage, TextElement } from "@/lib/pdfplumber";
import { detectCoverSheet } from "@/lib/cover-sheet";
import { extractWithGemini, extractWithGeminiVision } from "@/lib/gemini";
import { extractTextFromBbox, BoundingBox } from "@/lib/bbox-extraction";
import { validateExtraction, crossValidateWithElements } from "@/lib/validate-extraction";
import {
  getTemplateContext,
  getTemplatePattern,
  saveTemplatePattern,
  incrementPatternConfirmation,
  validatePatternMatch,
  inferDrawingNumberFormat,
  getProjectExtractedCount,
  getProjectConfirmedSide,
  preResolveArchitectFromSibling,
  TitleBlockPattern,
  TitleBlockBbox,
  resolveArchitectAndLearnTemplate,
  getLearnedBboxRegions,
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
    // ── Step 0: Template-first — pre-resolve architect before extraction ──
    // If this drawing has no architectId yet, try to inherit from a sibling drawing
    // in the same project. This makes template-first extraction work from the 2nd
    // drawing onwards without waiting for Gemini to identify the architect.
    let activeArchitectId = drawing.architectId;
    if (!activeArchitectId) {
      const siblingArchitectId = await preResolveArchitectFromSibling(id, drawing.project.id);
      if (siblingArchitectId) {
        activeArchitectId = siblingArchitectId;
        pipelineFlags.push("ARCH_PRE_RESOLVED_FROM_SIBLING");
        // Pre-link drawing to architect so template context is available immediately
        await prisma.drawing.update({ where: { id }, data: { architectId: siblingArchitectId } });
      }
    }

    // ── Step 1: Smart PDF extraction ───────────────────────────────
    const pdfStart = Date.now();
    let elements: TextElement[] = [];
    let pdfError: string | undefined;
    let scanned = false;
    let cropMode = false;
    let detectedSide: "bottom" | "right" | "unknown" = "unknown";
    let usedBbox: TitleBlockBbox | null = null;

    // Check for existing architect template pattern (uses pre-resolved architectId)
    const existingPattern = await getTemplatePattern(activeArchitectId);
    if (existingPattern && existingPattern.confirmedDrawingCount >= PATTERN_LOCK_THRESHOLD) {
      pipelineFlags.push("TEMPLATE_FAST_PATH");
    }

    if (existingPattern && existingPattern.confirmedDrawingCount >= PATTERN_LOCK_THRESHOLD) {
      // ── TEMPLATE-HINTED CROP MODE ──
      // Template bbox is a GUIDE, not a strict boundary. Expand it generously in
      // the direction opposite to the title block side so any revision block rows
      // that sit above/left of the template bbox are still captured. This prevents
      // the crop from cutting off the most recent revision rows when the template
      // was learned from a drawing with a shorter revision history.
      const tpl = existingPattern.bbox;
      const sideHint = existingPattern.side;
      const expandedBbox =
        sideHint === "bottom"
          ? { x0: tpl.x0, y0: Math.max(0, tpl.y0 - 300), x1: tpl.x1, y1: tpl.y1 }
          : sideHint === "right"
            ? { x0: Math.max(0, tpl.x0 - 300), y0: tpl.y0, x1: tpl.x1, y1: tpl.y1 }
            : tpl;
      const cropResult = await extractTextFromCrop(
        drawing.filepath,
        drawing.pageNumber,
        expandedBbox
      );

      if (cropResult.error) {
        pdfError = cropResult.error;
      } else if (cropResult.elements.length === 0) {
        // Crop returned no text elements — PDF has no text layer in the known title block area.
        // Do NOT fall back to region extraction: on large A0/A1 PDFs, region extraction also
        // returns 0 elements AND can time out (>30s), leaving the drawing in a failed state.
        // Instead, set scanned=true to trigger the Vision fallback (renderPageAsImage → Gemini Vision).
        // Vision sees the full page and can locate the title block visually.
        pipelineFlags.push("CROP_EMPTY_SCANNED");
        scanned = true;
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
          usedBbox = { ...existingPattern, bbox: expandedBbox }.bbox;
          pipelineFlags.push("CROP_MODE");
          pipelineFlags.push("CROP_EXPANDED");
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

        // If the region is sparse, flag it but proceed — full-page extraction is
        // prohibited because only title block text must be sent to the AI model.
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

    // ── Step 2: Cover sheet detection ─────────────────────────────
    const isCoverSheet = detectCoverSheet(elements, drawing.filename);
    if (isCoverSheet) {
      await prisma.drawing.update({
        where: { id },
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
      return NextResponse.json({ status: "cover_sheet", flags: [...pipelineFlags, "COVER_SHEET"] });
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
        // Image rendering failed — can't extract, mark as scanned and return
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
      // Rate delay
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
            callType: useVision ? "extract_vision" : (cropMode ? "extract_crop" : "extract"),
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

    // ── Step 4.1: Cross-validate Gemini output against source text ──
    // Every field value must have textual evidence in the extracted elements.
    // For Vision mode (no elements), applies confidence-based fallback rules.
    crossValidateWithElements(validated, elements, geminiResult);

    const processingTimeMs = Date.now() - pipelineStart;

    // Merge pipeline flags into validated flags
    const allFlags = [...new Set([...pipelineFlags, ...validated.flags])];

    // ── Step 4.5: Apply BBox Overrides (fallback only) ────────────
    // Gemini is the primary extractor. BBox overrides are applied only when Gemini
    // returned low confidence (< threshold) or null for a field — i.e. Gemini could
    // not confidently identify the value from context alone.
    const learnedBboxes = await getLearnedBboxRegions(activeArchitectId);
    if (learnedBboxes) {
      const fieldConfidenceMap: Record<string, number | null | undefined> = {
        drawingNumber: validated.confidenceDrawingNumber,
        drawingTitle: validated.confidenceDrawingTitle,
        revision: validated.confidenceRevision,
        revisionDate: validated.confidenceRevisionDate,
        status: validated.confidenceStatus,
        location: validated.confidenceLocation,
      };
      for (const [field, bbox] of Object.entries(learnedBboxes)) {
        const map: Record<string, keyof typeof validated> = {
          drawingNumber: "drawingNumber",
          drawingTitle: "drawingTitle",
          revision: "revision",
          revisionDate: "revisionDate",
          status: "status",
          location: "location",
        };
        const key = map[field];
        if (!key) continue;

        const geminiConfidence = fieldConfidenceMap[field] ?? 0;
        const geminiValue = (validated as any)[key];

        // Only apply BBOX override if Gemini didn't extract the field confidently
        if (!geminiValue || geminiConfidence < confidenceThreshold) {
          const val = extractTextFromBbox(elements, bbox as BoundingBox);
          if (val) {
            (validated as any)[key] = val;
            (validated as any)[`confidence${key.charAt(0).toUpperCase() + key.slice(1)}`] = 1.0;
            allFlags.push(`BBOX_OVERRIDE_${key.toUpperCase()}`);
          }
        }
      }
    }

    // ── Step 4.6: Inject pipeline source into extractionRules ────────
    // This is done after BBox overrides so we can accurately record the final source.
    const pipelineSource = useVision ? "vision" : cropMode ? "crop_bbox" : "region";
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

    // Mark any BBox-overridden fields
    for (const flag of allFlags) {
      const m = flag.match(/^BBOX_OVERRIDE_(.+)$/);
      if (m) {
        const camel = m[1].toLowerCase().replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
        const rule = (validated.extractionRules as Record<string, import("@/lib/validate-extraction").ExtractionFieldRule>)[camel];
        if (rule) {
          rule.source = "bbox_override";
          if (!rule.transforms.includes("bbox_override")) rule.transforms.push("bbox_override");
        }
      }
    }

    // Persist ApiCall record
    if (geminiMetrics) {
      await prisma.apiCall.create({
        data: {
          drawingId: id,
          model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
          callType: useVision ? "extract_vision" : (cropMode ? "extract_crop" : "extract"),
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

    // ── Step 5: Architect Resolution + Template Learning ──────────
    const cleanFieldPositions: Record<string, { x: number; y: number }> = {};
    if (validated.fieldCoordinates) {
      for (const [key, value] of Object.entries(validated.fieldCoordinates)) {
        if (value) cleanFieldPositions[key] = value;
      }
    }

    const templateResult = await resolveArchitectAndLearnTemplate({
      drawingId: id,
      drawingNumber: validated.drawingNumber,
      titleBlockLocation: validated.titleBlockLocation,
      revisionBlockLocation: validated.revisionBlockLocation,
      fieldCoordinates: Object.keys(cleanFieldPositions).length > 0 ? cleanFieldPositions : null,
      elements,
      projectId: drawing.project.id,
      projectName: drawing.project.name,
      existingArchitectId: activeArchitectId,
      geminiArchitectFirmName: geminiResult.architect_firm_name,
      // Enriched fields for template metadata (Task 2)
      revision: validated.revision,
      revisionDate: validated.revisionDate,
      revisionDateRaw: geminiResult.revision_date, // pre-normalisation value
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
