import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { prisma } from "@/lib/db";

export async function GET() {
  const drawings = await prisma.drawing.findMany({
    where: { project: { name: { contains: "Melbourne" } }, filename: { contains: "Arch Combined 5" } }
  });
  
  if (!drawings.length) return NextResponse.json({ error: "no drawings" });
  const rawStr = drawings[0].pdfplumberRaw;
  const rawObj = rawStr ? JSON.parse(rawStr) : null;
  return NextResponse.json({
    hasRaw: !!rawStr,
    length: rawObj ? rawObj.length : -1,
    sample: rawObj ? rawObj.filter((e: any) => e.text.includes("CAFE")) : []
  });
}
