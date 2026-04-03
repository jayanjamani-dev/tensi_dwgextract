import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractTextFromBbox, BoundingBox } from "@/lib/bbox-extraction";
import { TextElement } from "@/lib/pdfplumber";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const body = await req.json();
    const { fieldName, bbox } = body as { fieldName: string; bbox: BoundingBox };

    if (!fieldName || !bbox || typeof bbox.x0 !== "number") {
      return NextResponse.json({ error: "Missing fieldName or valid bbox" }, { status: 400 });
    }

    const { imageBase64 } = body as { imageBase64?: string };

    const drawing = await prisma.drawing.findUnique({
      where: { id },
    });

    if (!drawing) {
      return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
    }

    let matchedDrawingsCount = 0;
    const matchedDrawingIds: string[] = [];
    
    // Attempt to extract for the current drawing
    let extractedValue: string | null = null;
    let debugInfo = "";

    if (drawing.pdfplumberRaw) {
      const elements: TextElement[] = JSON.parse(drawing.pdfplumberRaw);
      extractedValue = extractTextFromBbox(elements, bbox);
      
      if (!extractedValue) {
        const near = elements.filter(el => 
          el.x >= bbox.x0 - 50 && el.x <= bbox.x1 + 50 &&
          el.y >= bbox.y0 - 50 && el.y <= bbox.y1 + 50
        );
        debugInfo = JSON.stringify({ bbox, count: elements.length, nearElements: near.map(n => ({t: n.text, x: n.x, y: n.y})) }, null, 2);
      }
    }

    // Fallback: If no text layer value was found AND we have an image crop (i.e. scanned PDF), use Gemini Vision
    if (!extractedValue && imageBase64) {
      try {
        const { GoogleGenerativeAI } = require("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const base64Data = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
        const prompt = "Extract exactly the text visible in this cropped image snippet. Do not include any extra words, markdown formatting, or explanation. Just return the literal text string as closely as possible. If it is empty, return nothing.";
        
        const result = await model.generateContent([
          prompt,
          { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
        ]);
        
        const text = result.response.text()?.trim();
        if (text) {
          extractedValue = text;
          debugInfo = "Extracted via Gemini Vision fallback " + debugInfo;
          
          // Since we can't mathematically cross-check scanned drawings, 
          // we treat all unextracted scanned drawings in this project as "matches"
          // so the user can choose to bulk-apply the new AI template rule to them.
          const otherDrawings = await prisma.drawing.findMany({
            where: {
              projectId: drawing.projectId,
              id: { not: id },
              // Find drawings that might need this fallback rule
              OR: [
                { pdfplumberRaw: { equals: "[]" } },
                { pdfplumberRaw: null }
              ]
            },
            select: { id: true }
          });
          
          otherDrawings.forEach(d => matchedDrawingIds.push(d.id));
        }
      } catch (geminiErr) {
        console.error("OCR fallback failed:", geminiErr);
      }
    }

    // If we successfully got a value, cross-check other drawings in the same project
    if (extractedValue !== null) {
      const dbFieldMap: Record<string, keyof typeof prisma.drawing.fields> = {
        drawingNumber: "drawingNumber",
        drawingTitle: "drawingTitle",
        revision: "revision",
        revisionDate: "revisionDate",
        status: "status",
        location: "location",
      };
      
      const dbField = dbFieldMap[fieldName];
      
      const otherDrawings = await prisma.drawing.findMany({
        where: {
          projectId: drawing.projectId,
          id: { not: id },
          pdfplumberRaw: { not: null },
        },
        select: {
          id: true,
          pdfplumberRaw: true,
        },
      });

      // Because 'pdfplumberRaw' is quite large, scanning in-memory might take a moment 
      // but it's drastically faster than running a Python sub-process per drawing.
      for (const other of otherDrawings) {
        if (!other.pdfplumberRaw || other.pdfplumberRaw === "[]") continue;
        
        const otherElements: TextElement[] = JSON.parse(other.pdfplumberRaw);
        if (otherElements.length === 0) continue;

        const otherExtractedValue = extractTextFromBbox(otherElements, bbox);
        
        // As long as we extract *something* from that exact coordinate in the other drawings,
        // we count it as a match (e.g. text was at least found there).
        // The user will be given the option to overwrite all these matching drawings.
        if (otherExtractedValue) {
          // You could optionally filter out if the current DB value already equals the extracted value,
          // but offering a bulk overwrite is safer.
          // Don't push duplicate ID if it was already added by scanned matching
          if (!matchedDrawingIds.includes(other.id)) {
            matchedDrawingIds.push(other.id);
          }
        }
      }
      
      matchedDrawingsCount = matchedDrawingIds.length;
    }

    return NextResponse.json({
      extractedValue,
      matchedDrawingsCount,
      matchedDrawingIds,
      architectId: drawing.architectId,
      debugInfo
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
