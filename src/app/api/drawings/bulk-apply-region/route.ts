import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractTextFromBbox, BoundingBox } from "@/lib/bbox-extraction";
import { TextElement } from "@/lib/pdfplumber";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { bbox, fieldName, applyToDrawingIds, architectId } = body as {
      bbox: BoundingBox;
      fieldName: string;
      applyToDrawingIds: string[];
      architectId?: string;
    };

    if (!bbox || !fieldName || !applyToDrawingIds || !Array.isArray(applyToDrawingIds)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const dbFieldMap: Record<string, keyof typeof prisma.drawing.fields> = {
      drawingNumber: "drawingNumber",
      drawingTitle: "drawingTitle",
      revision: "revision",
      revisionDate: "revisionDate",
      status: "status",
      location: "location",
    };

    const dbField = dbFieldMap[fieldName];
    if (!dbField) {
      return NextResponse.json({ error: "Invalid fieldName" }, { status: 400 });
    }

    let updatedCount = 0;

    // Apply extraction to each specified drawing
    for (const drawingId of applyToDrawingIds) {
      const drawing = await prisma.drawing.findUnique({
        where: { id: drawingId },
      });

      if (!drawing) continue;

      let extractedValue: string | null = null;
      if (drawing.pdfplumberRaw) {
        const elements: TextElement[] = JSON.parse(drawing.pdfplumberRaw);
        extractedValue = extractTextFromBbox(elements, bbox);
      }

      if (extractedValue !== null) {
        await prisma.drawing.update({
          where: { id: drawingId },
          data: {
            [dbField]: extractedValue,
            [`confidence${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`]: 1.0,
          },
        });
        updatedCount++;
      } else {
        // SCANNED DOCUMENT FALLBACK:
        // Since we can't extract mathematically, we must route it to the AI for visual processing.
        // We set extractionStatus to pending so the background pipeline processes it with the newly saved template rule.
        await prisma.drawing.update({
          where: { id: drawingId },
          data: {
            extractionStatus: "pending",
          },
        });
      }
    }

    // Permanently learn this pattern for the architect
    if (architectId) {
      const template = await prisma.template.findUnique({
        where: { architectId },
      });

      if (template) {
        const fieldPositions = template.fieldPositions
          ? JSON.parse(template.fieldPositions)
          : {};

        fieldPositions[fieldName] = bbox; // Store full bbox {x0, y0, x1, y1}

        await prisma.template.update({
          where: { architectId },
          data: {
            fieldPositions: JSON.stringify(fieldPositions),
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      updatedCount,
      message: `Extracted and mapped to ${updatedCount} drawings`,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
