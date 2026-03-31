import { NextRequest, NextResponse } from "next/server";
import formidable, { Fields, Files } from "formidable";
import path from "path";
import fs from "fs";
import { prisma } from "@/lib/db";
import { IncomingMessage } from "http";

export const config = { api: { bodyParser: false } };

function parseForm(
  req: IncomingMessage,
  uploadDir: string
): Promise<{ fields: Fields; files: Files }> {
  const form = formidable({ uploadDir, keepExtensions: true, multiples: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

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

  // Convert NextRequest to IncomingMessage-compatible object for formidable
  const body = await req.arrayBuffer();
  const buffer = Buffer.from(body);

  // Write buffer to a temp file approach — use formidable with raw buffer via pipe
  // Instead, use a simpler manual approach for App Router
  const contentType = req.headers.get("content-type") || "";
  const boundary = contentType.split("boundary=")[1];

  if (!boundary) {
    return NextResponse.json({ error: "Invalid multipart request" }, { status: 400 });
  }

  // Parse multipart manually using formidable on a fake stream
  const { Readable } = await import("stream");
  const stream = Readable.from(buffer) as unknown as IncomingMessage;
  stream.headers = { "content-type": contentType };
  (stream as unknown as { method: string }).method = "POST";

  let parsedFiles: formidable.File[] = [];
  try {
    const { files } = await parseForm(stream, uploadDir);
    const fileField = files["files"] || files["file"];
    if (!fileField) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }
    parsedFiles = Array.isArray(fileField) ? fileField : [fileField];
  } catch (err) {
    return NextResponse.json({ error: `Upload parse error: ${err}` }, { status: 500 });
  }

  const created = [];
  for (const file of parsedFiles) {
    if (!file.originalFilename?.endsWith(".pdf")) continue;

    const finalPath = path.join(uploadDir, file.originalFilename);
    // If same filename already exists, overwrite
    if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
    fs.renameSync(file.filepath, finalPath);

    const drawing = await prisma.drawing.create({
      data: {
        projectId,
        filename: file.originalFilename,
        filepath: path.relative(process.cwd(), finalPath),
        extractionStatus: "pending",
      },
    });
    created.push(drawing);
  }

  return NextResponse.json({ created }, { status: 201 });
}
