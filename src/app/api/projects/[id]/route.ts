import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

// DELETE /api/projects/[id] — delete entire project + drawings + uploaded files
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: { drawings: { select: { filepath: true } } },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Delete uploaded files
  const uploadDir = path.join(process.cwd(), "uploads", id);
  try {
    await fs.rm(uploadDir, { recursive: true, force: true });
  } catch {
    // Directory may not exist — that's fine
  }

  // Cascade delete via Prisma (drawings, apiCalls, corrections all cascade)
  await prisma.project.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
