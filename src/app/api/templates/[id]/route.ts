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
    "valueReplacements",
    "learnedRules",
    // Enriched format intelligence fields (Task 2)
    "drawingNumberFormatDesc",
    "drawingTitleConventions",
    "revisionNumberFormat",
    "revisionDateFormat",
    "statusTerminology",
  ];

  const jsonFields = new Set(["revisionColumnOrder", "fieldLabelMap", "valueReplacements", "learnedRules", "statusTerminology"]);

  const data: Record<string, unknown> = { lastUpdated: new Date() };
  for (const field of updatable) {
    if (field in body) {
      if (jsonFields.has(field)) {
        // Accept null (to clear the field), or store as JSON string
        if (body[field] === null) {
          data[field] = null;
        } else {
          data[field] = typeof body[field] === "string" ? body[field] : JSON.stringify(body[field]);
        }
      } else {
        data[field] = body[field];
      }
    }
  }

  const template = await prisma.template.update({ where: { id }, data });
  return NextResponse.json(template);
}
