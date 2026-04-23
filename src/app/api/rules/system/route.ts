import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();

    // Support both old format { mapping } and new format { ruleType, ... }
    const ruleType: string = body.ruleType ?? "STATUS_NORMALISATION";

    if (ruleType === "STATUS_NORMALISATION") {
      const { mapping } = body;
      if (!mapping || typeof mapping !== "object") {
        return NextResponse.json({ error: "Invalid mapping payload" }, { status: 400 });
      }
      await prisma.systemRule.upsert({
        where: { ruleType: "STATUS_NORMALISATION" },
        update: { content: JSON.stringify(mapping), lastUpdated: new Date() },
        create: {
          ruleType: "STATUS_NORMALISATION",
          content: JSON.stringify(mapping),
          description: "Maps raw extracted status strings to canonical values (case-insensitive key matching)",
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (ruleType === "EXTRACTION_RULES") {
      const { rules } = body;
      if (!Array.isArray(rules)) {
        return NextResponse.json({ error: "Invalid rules payload — expected array" }, { status: 400 });
      }
      for (const r of rules) {
        if (typeof r.id !== "number" || typeof r.field !== "string" || typeof r.rule !== "string") {
          return NextResponse.json({ error: "Each rule must have numeric id, string field, and string rule" }, { status: 400 });
        }
      }
      await prisma.systemRule.upsert({
        where: { ruleType: "EXTRACTION_RULES" },
        update: { content: JSON.stringify(rules), lastUpdated: new Date() },
        create: {
          ruleType: "EXTRACTION_RULES",
          content: JSON.stringify(rules),
          description: "Full extraction and business logic rules per field — editable in System Rules tab",
        },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Unknown ruleType: ${ruleType}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
