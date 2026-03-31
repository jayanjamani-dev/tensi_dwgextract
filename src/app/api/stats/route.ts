import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const [drawings, corrections, architects] = await Promise.all([
    prisma.drawing.findMany({
      select: {
        id: true,
        architectId: true,
        extractionStatus: true,
        confidenceDrawingNumber: true,
        confidenceDrawingTitle: true,
        confidenceRevision: true,
        confidenceRevisionDate: true,
        confidenceStatus: true,
        flags: true,
      },
    }),
    prisma.correction.findMany({ select: { fieldName: true, drawingId: true } }),
    prisma.architect.findMany({ select: { id: true, firmName: true } }),
  ]);

  type DrawingRow = typeof drawings[0];
  const extracted = drawings.filter((d: DrawingRow) => d.extractionStatus === "extracted" || d.extractionStatus === "reviewed" || d.extractionStatus === "published");
  const total = drawings.length;
  const totalExtracted = extracted.length;

  const fields = ["drawingNumber", "drawingTitle", "revision", "revisionDate", "status"] as const;
  const fieldConfidenceKeys: Record<string, keyof DrawingRow> = {
    drawingNumber: "confidenceDrawingNumber",
    drawingTitle: "confidenceDrawingTitle",
    revision: "confidenceRevision",
    revisionDate: "confidenceRevisionDate",
    status: "confidenceStatus",
  };

  const avgConfidence: Record<string, number> = {};
  for (const field of fields) {
    const key = fieldConfidenceKeys[field];
    const vals = extracted
      .map((d: DrawingRow) => d[key] as number | null)
      .filter((v: number | null): v is number => v !== null);
    avgConfidence[field] = vals.length > 0 ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : 0;
  }

  const correctionCounts: Record<string, number> = {};
  for (const c of corrections) {
    const f = c.fieldName;
    correctionCounts[f] = (correctionCounts[f] || 0) + 1;
  }

  const totalFields = totalExtracted * fields.length;
  const totalCorrections = corrections.length;
  const accuracyRate = totalFields > 0 ? (totalFields - totalCorrections) / totalFields : 0;

  // Per-architect breakdown
  type ArchRow = typeof architects[0];
  const architectMap = Object.fromEntries(architects.map((a: ArchRow) => [a.id, a.firmName]));
  const perArchitect: Record<string, { firmName: string; total: number; corrections: number }> = {};

  for (const d of extracted as DrawingRow[]) {
    const archId = d.architectId || "unknown";
    if (!perArchitect[archId]) {
      perArchitect[archId] = {
        firmName: archId === "unknown" ? "Unknown" : (architectMap[archId] || archId),
        total: 0,
        corrections: 0,
      };
    }
    perArchitect[archId].total++;
  }

  for (const c of corrections) {
    const drawing = drawings.find((d: DrawingRow) => d.id === c.drawingId);
    const archId = drawing?.architectId || "unknown";
    if (perArchitect[archId]) perArchitect[archId].corrections++;
  }

  return NextResponse.json({
    total,
    totalExtracted,
    avgConfidence,
    correctionCounts,
    accuracyRate,
    perArchitect: Object.values(perArchitect),
  });
}
