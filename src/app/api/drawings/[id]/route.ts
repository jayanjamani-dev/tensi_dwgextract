import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { detectPattern, applyPattern, matchesPattern } from "@/lib/pattern-detector";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const drawing = await prisma.drawing.findUnique({
    where: { id },
    include: { corrections: { orderBy: { correctedAt: "desc" } } },
  });
  if (!drawing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    ...drawing,
    extractionRules: drawing.extractionRules
      ? (() => { try { return JSON.parse(drawing.extractionRules); } catch { return null; } })()
      : null,
    drawingRegister: drawing.drawingRegister
      ? (() => { try { return JSON.parse(drawing.drawingRegister); } catch { return null; } })()
      : null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const editableFields = [
    "drawingNumber",
    "drawingTitle",
    "revision",
    "revisionDate",
    "status",
    "architectId",
    "notes",
  ];

  const current = await prisma.drawing.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updates: Record<string, unknown> = {};
  const corrections = [];

  for (const field of editableFields) {
    if (field in body && body[field] !== undefined) {
      const currentValue = (current as Record<string, unknown>)[field];
      const newValue = body[field];

      if (currentValue !== newValue) {
        corrections.push({
          drawingId: id,
          fieldName: field,
          originalValue: currentValue != null ? String(currentValue) : null,
          correctedValue: newValue != null ? String(newValue) : null,
        });
      }
      updates[field] = newValue;
    }
  }

  const drawing = await prisma.drawing.update({ where: { id }, data: updates });

  const similarErrors: Record<string, { original: string; corrected: string; affectedIds: string[]; count: number; isGlobal?: boolean }> = {};

  if (corrections.length > 0) {
    // Attach architectId to corrections
    const correctionsWithArchitect = corrections.map(c => ({
      ...c,
      architectId: current.architectId
    }));
    await prisma.correction.createMany({ data: correctionsWithArchitect });

    for (const correction of correctionsWithArchitect) {
      if (correction.originalValue && correction.architectId && correction.correctedValue) {
        // 1. Detect Pattern
        const pattern = detectPattern(correction.originalValue, correction.correctedValue);
        
        // 2. Log to Architect Template & Learned Rules
        const template = await prisma.template.findUnique({ where: { architectId: correction.architectId } });
        if (template) {
          const replacements = template.valueReplacements ? JSON.parse(template.valueReplacements) : {};
          if (!replacements[correction.fieldName]) replacements[correction.fieldName] = {};
          replacements[correction.fieldName][correction.originalValue] = correction.correctedValue;
          
          let learnedRules = template.learnedRules ? JSON.parse(template.learnedRules) : [];
          if (pattern && pattern.type !== "exact") {
              // Add or update pattern rule
              const existingIdx = learnedRules.findIndex((r: any) => r.type === pattern.type && r.field === correction.fieldName && r.value === pattern.value);
              if (existingIdx === -1) {
                  learnedRules.push({ ...pattern, field: correction.fieldName, exampleOriginal: correction.originalValue, exampleCorrected: correction.correctedValue, lastSeen: new Date() });
              } else {
                  learnedRules[existingIdx].lastSeen = new Date();
              }
          }

          await prisma.template.update({
            where: { id: template.id },
            data: { 
                valueReplacements: JSON.stringify(replacements), 
                learnedRules: JSON.stringify(learnedRules),
                lastUpdated: new Date() 
            },
          });
        }

        // 3. Find similar errors GLOBALLY (same architect)
        const allDrawingsForArchitect = await prisma.drawing.findMany({
          where: {
            architectId: correction.architectId,
            id: { not: current.id },
          },
          select: { id: true, [correction.fieldName]: true, filename: true, projectId: true }
        });

        const matches = allDrawingsForArchitect.filter(d => {
            const val = (d as any)[correction.fieldName];
            if (pattern && pattern.type !== "exact") {
                return matchesPattern(val, correction.originalValue, pattern);
            }
            return val === correction.originalValue;
        });

        if (matches.length > 0) {
          const projectIds = new Set(matches.map(m => (m as any).projectId));
          similarErrors[correction.fieldName] = {
            original: correction.originalValue!,
            corrected: correction.correctedValue!,
            affectedIds: matches.map(d => String((d as any).id)),
            count: matches.length,
            isGlobal: projectIds.size > 1 || !projectIds.has(current.projectId),
          };
        }
      }
    }
  }

  return NextResponse.json({ drawing, similarErrors });
}
