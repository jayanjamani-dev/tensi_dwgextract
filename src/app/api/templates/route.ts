import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const templates = await prisma.template.findMany({
    include: { architect: true },
    orderBy: { lastUpdated: "desc" },
  });
  return NextResponse.json(templates);
}
