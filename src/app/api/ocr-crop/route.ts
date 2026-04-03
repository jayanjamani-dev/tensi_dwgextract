import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = await req.json();
    
    if (!imageBase64) {
      return NextResponse.json({ error: "Missing imageBase64" }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Strip the data URL prefix if present
    const base64Data = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

    const prompt = "Extract exactly the text visible in this cropped image snippet. Do not include any extra words, markdown formatting, or explanation. Just return the literal text string as closely as possible. If it is empty, return nothing.";

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: "image/jpeg"
        }
      }
    ]);

    const text = result.response.text()?.trim() || "";

    return NextResponse.json({ text });
  } catch (err: any) {
    console.error("OCR crop error:", err);
    return NextResponse.json({ error: err.message || "Failed to OCR crop" }, { status: 500 });
  }
}
