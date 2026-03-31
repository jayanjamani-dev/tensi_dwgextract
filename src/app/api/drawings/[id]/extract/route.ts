import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractTextFromPdf } from "@/lib/pdfplumber";
import { detectCoverSheet } from "@/lib/cover-sheet";
import { extractWithGemini } from "@/lib/gemini";
import { validateExtraction } from "@/lib/validate-extraction";
import { getTemplateContext } from "@/lib/templates";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const drawing = await prisma.drawing.findUnique({ where: { id } });
  if (!drawing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Mark as processing
  await prisma.drawing.update({
    where: { id },
    data: { extractionStatus: "processing" },
  });

  try {
    // Step 1: Extract text via pdfplumber
    const { elements, scanned, error: pdfError } = await extractTextFromPdf(drawing.filepath);

    if (pdfError) {
      await prisma.drawing.update({
        where: { id },
        data: {
          extractionStatus: "extracted",
          flags: JSON.stringify(["PDF_EXTRACTION_ERROR"]),
          notes: pdfError,
        },
      });
      return NextResponse.json({ error: pdfError }, { status: 500 });
    }

    // Step 2: Cover sheet detection
    const isCoverSheet = detectCoverSheet(elements, drawing.filename);
    if (isCoverSheet || scanned) {
      const flags = [];
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
        },
      });
      return NextResponse.json({
        status: isCoverSheet ? "cover_sheet" : "scanned",
        flags,
      });
    }

    // Step 3: Template context
    const templateContext = await getTemplateContext(drawing.architectId);

    // Step 4: Gemini extraction
    let geminiResult;
    try {
      geminiResult = await extractWithGemini(elements, templateContext);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await prisma.drawing.update({
        where: { id },
        data: {
          extractionStatus: "extracted",
          pdfplumberRaw: JSON.stringify(elements),
          flags: JSON.stringify(["GEMINI_PARSE_ERROR"]),
          notes: errMsg,
          extractedAt: new Date(),
        },
      });
      return NextResponse.json({ error: errMsg }, { status: 500 });
    }

    // Step 5: Validation
    const confidenceThreshold = parseFloat(process.env.CONFIDENCE_THRESHOLD || "0.7");
    const validated = validateExtraction(geminiResult, confidenceThreshold);

    // Step 6: Write to DB
    const updated = await prisma.drawing.update({
      where: { id },
      data: {
        drawingNumber: validated.drawingNumber,
        drawingTitle: validated.drawingTitle,
        revision: validated.revision,
        revisionDate: validated.revisionDate,
        status: validated.status,
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
        flags: JSON.stringify(validated.flags),
        notes: validated.notes,
        extractionStatus: "extracted",
        extractedAt: new Date(),
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await prisma.drawing.update({
      where: { id },
      data: {
        extractionStatus: "extracted",
        flags: JSON.stringify(["EXTRACTION_ERROR"]),
        notes: errMsg,
      },
    });
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
