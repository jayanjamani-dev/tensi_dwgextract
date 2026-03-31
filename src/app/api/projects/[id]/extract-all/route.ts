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
  const { id: projectId } = await params;

  const drawings = await prisma.drawing.findMany({
    where: { projectId, extractionStatus: "pending" },
  });

  if (drawings.length === 0) {
    return NextResponse.json({ message: "No pending drawings", processed: 0 });
  }

  const results = [];
  const confidenceThreshold = parseFloat(process.env.CONFIDENCE_THRESHOLD || "0.7");

  for (const drawing of drawings) {
    await prisma.drawing.update({
      where: { id: drawing.id },
      data: { extractionStatus: "processing" },
    });

    try {
      const { elements, scanned, error: pdfError } = await extractTextFromPdf(drawing.filepath);

      if (pdfError) {
        await prisma.drawing.update({
          where: { id: drawing.id },
          data: {
            extractionStatus: "extracted",
            flags: JSON.stringify(["PDF_EXTRACTION_ERROR"]),
            notes: pdfError,
          },
        });
        results.push({ id: drawing.id, filename: drawing.filename, status: "error", error: pdfError });
        continue;
      }

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
          },
        });
        results.push({ id: drawing.id, filename: drawing.filename, status: isCoverSheet ? "cover_sheet" : "scanned" });
        continue;
      }

      const templateContext = await getTemplateContext(drawing.architectId);
      const geminiResult = await extractWithGemini(elements, templateContext);
      const validated = validateExtraction(geminiResult, confidenceThreshold);

      await prisma.drawing.update({
        where: { id: drawing.id },
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

      results.push({ id: drawing.id, filename: drawing.filename, status: "extracted", flags: validated.flags });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await prisma.drawing.update({
        where: { id: drawing.id },
        data: {
          extractionStatus: "extracted",
          flags: JSON.stringify(["EXTRACTION_ERROR"]),
          notes: errMsg,
        },
      });
      results.push({ id: drawing.id, filename: drawing.filename, status: "error", error: errMsg });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
