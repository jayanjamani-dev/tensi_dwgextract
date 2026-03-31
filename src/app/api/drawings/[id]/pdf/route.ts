import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs";
import path from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const drawing = await prisma.drawing.findUnique({ where: { id } });
  if (!drawing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filepath = path.join(process.cwd(), drawing.filepath);
  if (!fs.existsSync(filepath)) {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filepath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${drawing.filename}"`,
    },
  });
}
