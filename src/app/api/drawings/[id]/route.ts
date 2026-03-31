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

  if (corrections.length > 0) {
    await prisma.correction.createMany({ data: corrections });
  }

  return NextResponse.json(drawing);
}
