import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { ids, fieldName, correctedValue } = body;

  if (!ids || !Array.isArray(ids) || ids.length === 0 || !fieldName || !correctedValue) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // 1. Fetch current drawings to create correction logs
  const drawings = await prisma.drawing.findMany({
    where: { id: { in: ids } },
    select: { id: true, [fieldName]: true }
  });

  const correctionsData = drawings.map((d: any) => ({
    drawingId: d.id,
    fieldName,
    originalValue: d[fieldName] ? String(d[fieldName]) : null,
    correctedValue
  }));

  // 2. Batch update drawings
  await prisma.drawing.updateMany({
    where: { id: { in: ids } },
    data: { [fieldName]: correctedValue }
  });

  // 3. Log corrections
  if (correctionsData.length > 0) {
    await prisma.correction.createMany({ data: correctionsData });
  }

  return NextResponse.json({ success: true, count: ids.length });
}
