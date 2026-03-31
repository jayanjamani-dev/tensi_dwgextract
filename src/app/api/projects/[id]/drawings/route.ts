import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const drawings = await prisma.drawing.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(drawings);
}
