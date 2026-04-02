import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(req: NextRequest) {
  try {
    const { mapping } = await req.json();
    if (!mapping || typeof mapping !== 'object') {
      return NextResponse.json({ error: "Invalid mapping payload" }, { status: 400 });
    }

    await prisma.systemRule.update({
      where: { ruleType: "STATUS_NORMALISATION" },
      data: { content: JSON.stringify(mapping) }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
