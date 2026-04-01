import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

// DELETE /api/drawings/batch — delete multiple drawings by IDs
// Body: { ids: string[] }
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const ids: string[] = body.ids;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids[] required" }, { status: 400 });
  }

  // Get filepaths before deleting
  const drawings = await prisma.drawing.findMany({
    where: { id: { in: ids } },
    select: { id: true, filepath: true },
  });

  // Delete files from disk
  for (const d of drawings) {
    try {
      const absPath = path.isAbsolute(d.filepath)
        ? d.filepath
        : path.join(process.cwd(), d.filepath);
      await fs.unlink(absPath);
    } catch {
      // File may not exist — continue
    }
  }

  // Delete from DB (cascade deletes apiCalls + corrections)
  await prisma.drawing.deleteMany({ where: { id: { in: ids } } });

  return NextResponse.json({ deleted: drawings.length });
}
