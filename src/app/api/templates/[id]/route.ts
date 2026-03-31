import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const updatable = [
    "titleBlockLocation",
    "revisionBlockLocation",
    "revisionColumnOrder",
    "revisionReadingDirection",
    "fieldLabelMap",
  ];

  const data: Record<string, unknown> = { lastUpdated: new Date() };
  for (const field of updatable) {
    if (field in body) {
      // Store JSON fields as strings
      if (field === "revisionColumnOrder" || field === "fieldLabelMap") {
        data[field] = typeof body[field] === "string" ? body[field] : JSON.stringify(body[field]);
      } else {
        data[field] = body[field];
      }
    }
  }

  const template = await prisma.template.update({ where: { id }, data });
  return NextResponse.json(template);
}
