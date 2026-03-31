import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const VALID_STATUSES = ["pending", "processing", "extracted", "cover_sheet", "reviewed", "published"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { extractionStatus } = await req.json();

  if (!VALID_STATUSES.includes(extractionStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const data: Record<string, unknown> = { extractionStatus };
  if (extractionStatus === "reviewed") data.reviewedAt = new Date();
  if (extractionStatus === "published") data.publishedAt = new Date();

  const drawing = await prisma.drawing.update({ where: { id }, data });
  return NextResponse.json(drawing);
}
