import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { prisma } from "@/lib/db";
import { getPageCount } from "@/lib/pdfplumber";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const uploadDir = path.join(process.cwd(), "uploads", projectId);
  fs.mkdirSync(uploadDir, { recursive: true });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    return NextResponse.json({ error: `Failed to parse form data: ${err}` }, { status: 400 });
  }

  // Accept files from "files" field (multi) or "file" field (single)
  const entries: FormDataEntryValue[] = formData.getAll("files");
  if (!entries.length) {
    const single = formData.get("file");
    if (single) entries.push(single);
  }

  if (!entries.length) {
    return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
  }

  const created = [];

  for (const entry of entries) {
    if (!(entry instanceof File)) continue;
    if (!entry.name.toLowerCase().endsWith(".pdf")) continue;

    // Save file to disk
    const buffer = Buffer.from(await entry.arrayBuffer());
    const finalPath = path.join(uploadDir, entry.name);
    fs.writeFileSync(finalPath, buffer);

    const relativePath = path.relative(process.cwd(), finalPath);

    // Detect page count — create one drawing record per page
    const pageCount = await getPageCount(finalPath);

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const drawing = await prisma.drawing.create({
        data: {
          projectId,
          filename: entry.name,
          filepath: relativePath,
          pageNumber: pageIndex,
          extractionStatus: "pending",
        },
      });
      created.push(drawing);
    }
  }

  if (created.length === 0) {
    return NextResponse.json({ error: "No valid PDF files found in upload" }, { status: 400 });
  }

  return NextResponse.json({ created }, { status: 201 });
}
