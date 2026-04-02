import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const systemRules = await prisma.systemRule.findMany();
    
    const templates = await prisma.template.findMany({
      include: {
        architect: { select: { id: true, firmName: true } }
      }
    });

    const learnedVocabulary: any[] = [];
    const learnedPatterns: any[] = [];

    for (const t of templates) {
      if (t.valueReplacements) {
        try {
          const reps = JSON.parse(t.valueReplacements);
          for (const [field, mappings] of Object.entries(reps)) {
            for (const [original, corrected] of Object.entries(mappings as Record<string, string>)) {
              learnedVocabulary.push({
                idx: `${t.architect.id}-${field}-${original}`,
                architectId: t.architect.id,
                architectName: t.architect.firmName,
                field,
                original,
                corrected,
              });
            }
          }
        } catch (e) {}
      }

      if (t.titleBlockPattern || t.titleBlockLocation) {
        let pattern = null;
        if (t.titleBlockPattern) {
          try { pattern = JSON.parse(t.titleBlockPattern); } catch (e) {}
        }
        learnedPatterns.push({
          architectId: t.architect.id,
          architectName: t.architect.firmName,
          titleBlockLocation: t.titleBlockLocation,
          revisionBlockLocation: t.revisionBlockLocation,
          pattern,
          lastUpdated: t.lastUpdated
        });
      }
    }

    return NextResponse.json({
      systemRules,
      learnedVocabulary,
      learnedPatterns
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
