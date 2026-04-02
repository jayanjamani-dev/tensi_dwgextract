import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: architectId } = await params;
    const { field, original } = await req.json();

    if (!field || !original) {
      return NextResponse.json({ error: "Missing field or original value" }, { status: 400 });
    }

    const template = await prisma.template.findUnique({ where: { architectId } });
    if (!template || !template.valueReplacements) {
        return NextResponse.json({ ok: true });
    }

    const reps = JSON.parse(template.valueReplacements);
    if (reps[field] && reps[field][original]) {
      delete reps[field][original];
      
      // Clean up empty objects
      if (Object.keys(reps[field]).length === 0) {
        delete reps[field];
      }

      await prisma.template.update({
        where: { architectId },
        data: { valueReplacements: JSON.stringify(reps) }
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
