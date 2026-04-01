import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const drawing = await prisma.drawing.findUnique({
    where: { id },
    include: { corrections: { orderBy: { correctedAt: "desc" } } },
  });
  if (!drawing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(drawing);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const editableFields = [
    "drawingNumber",
    "drawingTitle",
    "revision",
    "revisionDate",
    "status",
    "architectId",
    "notes",
  ];

  const current = await prisma.drawing.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updates: Record<string, unknown> = {};
  const corrections = [];

  for (const field of editableFields) {
    if (field in body && body[field] !== undefined) {
      const currentValue = (current as Record<string, unknown>)[field];
      const newValue = body[field];

      if (currentValue !== newValue) {
        corrections.push({
          drawingId: id,
          fieldName: field,
          originalValue: currentValue != null ? String(currentValue) : null,
          correctedValue: newValue != null ? String(newValue) : null,
        });
      }
      updates[field] = newValue;
    }
  }

  const drawing = await prisma.drawing.update({ where: { id }, data: updates });

  const similarErrors: Record<string, { original: string; corrected: string; affectedIds: string[]; count: number }> = {};

  if (corrections.length > 0) {
    await prisma.correction.createMany({ data: corrections });

    for (const correction of corrections) {
      if (correction.originalValue && current.architectId && correction.correctedValue) {
        // 1. Log to Architect Template
        const template = await prisma.template.findUnique({ where: { architectId: current.architectId } });
        if (template) {
          const replacements = template.valueReplacements ? JSON.parse(template.valueReplacements) : {};
          if (!replacements[correction.fieldName]) replacements[correction.fieldName] = {};
          
          // Only add replacement if it's not a deletion mapping (or we can allow deletion mappings too, but value shouldn't be null)
          replacements[correction.fieldName][correction.originalValue] = correction.correctedValue;
          
          await prisma.template.update({
            where: { id: template.id },
            data: { valueReplacements: JSON.stringify(replacements), lastUpdated: new Date() },
          });
        }

        // 2. Find similar errors in the same project
        const similarDrawings = await prisma.drawing.findMany({
          where: {
            projectId: current.projectId,
            [correction.fieldName]: correction.originalValue,
            id: { not: current.id }, 
          },
          select: { id: true }
        });

        if (similarDrawings.length > 0) {
          similarErrors[correction.fieldName] = {
            original: correction.originalValue,
            corrected: correction.correctedValue,
            affectedIds: similarDrawings.map((d: { id: string }) => d.id),
            count: similarDrawings.length,
          };
        }
      }
    }
  }

  return NextResponse.json({ drawing, similarErrors });
}
