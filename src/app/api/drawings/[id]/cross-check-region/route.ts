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

    // Attempt to extract a value for the current drawing
    let extractedValue: string | null = null;
    let debugInfo = "";
    let usedVision = false;

    // ── PRIMARY: Gemini Vision on the canvas crop ──────────────────────────────
    // The canvas crop is pixel-accurate (captures exactly what the user selected).
    // Using Vision here avoids coordinate-system mismatches and margin errors that
    // cause pdfplumber text-layer matching to bleed into adjacent title block columns.
    if (imageBase64) {
      try {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
        if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY not set");
        const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });
        const base64Data = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
        const mimeType =
          imageBase64.startsWith("data:image/jpeg") || imageBase64.startsWith("data:image/jpg")
            ? ("image/jpeg" as const)
            : ("image/png" as const);

        // Field-aware prompt so Gemini returns only the relevant text.
        const fieldLabel = fieldName
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, (c) => c.toUpperCase())
          .trim();
        const prompt =
          `You are reading a cropped image from a construction drawing title block. ` +
          `The region shown is the "${fieldLabel}" field. ` +
          `Return ONLY the exact text visible in this region — no explanation, no markdown, ` +
          `no extra words. If the region appears blank, return nothing.`;

        const result = await model.generateContent([
          prompt,
          { inlineData: { data: base64Data, mimeType } },
        ]);

        const text = result.response.text()?.trim();
        if (text) {
          extractedValue = text;
          usedVision = true;
          debugInfo = "Extracted via Gemini Vision (primary)";
        }
      } catch (geminiErr) {
        console.error("Vision extraction failed, falling back to pdfplumber:", geminiErr);
      }
    }

    // ── FALLBACK: pdfplumber text layer ────────────────────────────────────────
    // Used when: (a) no canvas crop was provided, or (b) Vision returned nothing.
    if (!extractedValue && drawing.pdfplumberRaw) {
      const elements: TextElement[] = JSON.parse(drawing.pdfplumberRaw);
      extractedValue = extractTextFromBbox(elements, bbox);

      if (!extractedValue) {
        const near = elements.filter(
          (el) =>
            el.x >= bbox.x0 - 50 &&
            el.x <= bbox.x1 + 50 &&
            el.y >= bbox.y0 - 50 &&
            el.y <= bbox.y1 + 50
        );
        debugInfo = JSON.stringify(
          { bbox, count: elements.length, nearElements: near.map((n) => ({ t: n.text, x: n.x, y: n.y })) },
          null,
          2
        );
      }
    }

    // For scanned drawings where Vision provided the value, offer all other scanned drawings
    // in this project as candidates for bulk-apply.
    if (usedVision && extractedValue) {
      const scannedDrawings = await prisma.drawing.findMany({
        where: {
          projectId: drawing.projectId,
          id: { not: id },
          OR: [{ pdfplumberRaw: { equals: "[]" } }, { pdfplumberRaw: null }],
        },
        select: { id: true },
      });
      scannedDrawings.forEach((d) => matchedDrawingIds.push(d.id));
    }

    // ── Cross-check other drawings using pdfplumber (fast, no extra API calls) ──
    // Even when Vision provided the current drawing's value, we scan other drawings
    // with pdfplumber to identify which ones have text at this same location.
    if (extractedValue !== null) {
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

      for (const other of otherDrawings) {
        if (!other.pdfplumberRaw || other.pdfplumberRaw === "[]") continue;

        const otherElements: TextElement[] = JSON.parse(other.pdfplumberRaw);
        if (otherElements.length === 0) continue;

        // Use a larger margin (15px) when scanning other drawings — minor coordinate
        // shifts between drawings from the same architect are common, and we want to
        // offer bulk-apply for as many drawings as possible.
        const otherExtractedValue = extractTextFromBbox(otherElements, bbox, 15);
        if (otherExtractedValue && !matchedDrawingIds.includes(other.id)) {
          matchedDrawingIds.push(other.id);
        }
      }

      matchedDrawingsCount = matchedDrawingIds.length;
    }

    return NextResponse.json({
      extractedValue,
      matchedDrawingsCount,
      matchedDrawingIds,
      architectId: drawing.architectId,
      debugInfo,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
