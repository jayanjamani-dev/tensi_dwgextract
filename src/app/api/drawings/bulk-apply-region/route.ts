import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractTextFromCrop, TextElement } from "@/lib/pdfplumber";
import { BoundingBox } from "@/lib/bbox-extraction";

/** Join crop elements in reading order (top→bottom, left→right per line). */
function joinCropText(elements: TextElement[]): string | null {
  if (!elements || elements.length === 0) return null;
  const sorted = [...elements].sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) < Math.max(a.size, b.size) * 0.5) return a.x - b.x;
    return yDiff;
  });
  // Group into lines and join
  let result = "";
  let lastEl: TextElement | null = null;
  for (const el of sorted) {
    if (!lastEl) {
      result = el.text;
    } else {
      const yDiff = Math.abs(el.y - lastEl.y);
      result += yDiff > Math.max(el.size, lastEl.size) * 0.8 ? " " + el.text : " " + el.text;
    }
    lastEl = el;
  }
  return result.trim() || null;
}

const BATCH_SIZE = 4; // max concurrent Python subprocesses

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      bbox,
      fieldName,
      applyToDrawingIds,
      architectId,
      knownValue,
      knownDrawingId,
    } = body as {
      bbox: BoundingBox;
      fieldName: string;
      applyToDrawingIds: string[];
      architectId?: string;
      knownValue?: string;
      knownDrawingId?: string;
    };

    if (!bbox || !fieldName || !applyToDrawingIds || !Array.isArray(applyToDrawingIds)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const dbFieldMap: Record<string, string> = {
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

    const confidenceField = `confidence${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`;

    // Load all target drawings up front
    const drawings = await prisma.drawing.findMany({
      where: { id: { in: applyToDrawingIds } },
      select: { id: true, filepath: true, pageNumber: true },
    });

    let updatedCount = 0;
    const skippedIds: string[] = [];

    // Process in batches to limit concurrent Python processes
    for (let i = 0; i < drawings.length; i += BATCH_SIZE) {
      const batch = drawings.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (drawing) => {
          let extractedValue: string | null = null;

          if (knownValue && knownDrawingId && drawing.id === knownDrawingId) {
            // Use the Vision-confirmed value for the triggering drawing — no re-extraction needed.
            extractedValue = knownValue;
          } else {
            // ── Strict pdfplumber crop extraction ──────────────────────────────
            // Crops the PDF to exactly the selected bbox region, extracting ONLY
            // text within those boundaries. No margin, no adjacent field bleed.
            const cropResult = await extractTextFromCrop(
              drawing.filepath,
              drawing.pageNumber,
              bbox
            );

            if (!cropResult.error && cropResult.elements.length > 0) {
              extractedValue = joinCropText(cropResult.elements);
            }
            // If crop returns nothing (scanned PDF or no text in that region), skip silently.
          }

          return { id: drawing.id, value: extractedValue };
        })
      );

      // Write results to DB
      for (const { id, value } of batchResults) {
        if (value !== null) {
          await prisma.drawing.update({
            where: { id },
            data: {
              [dbField]: value,
              [confidenceField]: 1.0,
            },
          });
          updatedCount++;
        } else {
          skippedIds.push(id);
        }
      }
    }

    // Save the bbox rule to the architect's template so the extraction pipeline
    // uses it automatically on future drawings.
    if (architectId) {
      const template = await prisma.template.findUnique({ where: { architectId } });
      if (template) {
        const fieldPositions = template.fieldPositions
          ? JSON.parse(template.fieldPositions)
          : {};
        fieldPositions[fieldName] = bbox;
        await prisma.template.update({
          where: { architectId },
          data: { fieldPositions: JSON.stringify(fieldPositions) },
        });
      }
    }

    return NextResponse.json({
      success: true,
      updatedCount,
      skippedCount: skippedIds.length,
      message: `Updated ${updatedCount} drawings${skippedIds.length ? `, skipped ${skippedIds.length} (no text in that region)` : ""}`,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
