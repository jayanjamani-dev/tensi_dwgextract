import { prisma } from "./db";
import { TextElement } from "./pdfplumber";

// ── Types ──────────────────────────────────────────────────────────

export interface TitleBlockBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TitleBlockPattern {
  side: "bottom" | "right";
  bbox: TitleBlockBbox;
  confirmedDrawingCount: number;
  architectFirmName: string;
  projectName?: string;
  drawingNumberFormat?: string; // regex pattern, e.g. "A\\d{3}"
}

export interface PatternMatchResult {
  matched: boolean;
  reason: string;
}

// ── Template Context (Gemini prompt injection) ─────────────────────

export async function getTemplateContext(architectId: string | null): Promise<string> {
  if (!architectId) return "";

  const architect = await prisma.architect.findUnique({
    where: { id: architectId },
    include: { template: true },
  });

  if (!architect?.template) return "";

  const t = architect.template;
  const labelMap = t.fieldLabelMap ? JSON.parse(t.fieldLabelMap) : {};
  const columnOrder = t.revisionColumnOrder ? JSON.parse(t.revisionColumnOrder) : [];
  const replacements = t.valueReplacements ? JSON.parse(t.valueReplacements) : {};

  let context = `
Known template for this architect (firm: ${architect.firmName}):
- Title block location: ${t.titleBlockLocation || "unknown"}
- Revision block location: ${t.revisionBlockLocation || "unknown"}
- Known field labels: ${JSON.stringify(labelMap)}
- Revision column order: ${JSON.stringify(columnOrder)}
- Revision reading direction: ${t.revisionReadingDirection || "unknown"}
`;

  // Inject crop bbox info if pattern exists
  const pattern = parsePattern(t.titleBlockPattern);
  if (pattern) {
    context += `
- CROP MODE: Text was extracted from a cropped region (${pattern.side}), bbox: [${pattern.bbox.x0}, ${pattern.bbox.y0}, ${pattern.bbox.x1}, ${pattern.bbox.y1}]. All x/y coordinates are relative to the full page, not the crop.
`;
  }

  // Inject learned correction rules
  const replacementFields = Object.keys(replacements);
  if (replacementFields.length > 0) {
    context += `\n--- PAST CORRECTIONS AND ML RULES ---\n`;
    context += `You MUST apply these exact mapping rules to your extracted values for this architect before returning them:\n`;
    for (const field of replacementFields) {
      for (const [original, corrected] of Object.entries(replacements[field] as Record<string, string>)) {
        context += `- If extracted '${field}' is exactly "${original}", you MUST output "${corrected}" instead.\n`;
      }
    }
  }

  context += `
Use this context to guide your extraction. If the drawing does not match this template, ignore the template and proceed with general rules. Note any mismatch in the notes field.`;

  return context.trim();
}

// ── Pattern Storage ────────────────────────────────────────────────

function parsePattern(raw: string | null | undefined): TitleBlockPattern | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TitleBlockPattern;
  } catch {
    return null;
  }
}

/** Retrieve the stored title block pattern for an architect. */
export async function getTemplatePattern(architectId: string | null): Promise<TitleBlockPattern | null> {
  if (!architectId) return null;

  const template = await prisma.template.findUnique({
    where: { architectId },
  });

  return parsePattern(template?.titleBlockPattern);
}

/** Upsert the title block pattern for an architect. */
export async function saveTemplatePattern(
  architectId: string,
  pattern: TitleBlockPattern,
  titleBlockLocation?: string,
  revisionBlockLocation?: string,
  fieldPositions?: Record<string, { x: number; y: number }> | null
): Promise<void> {
  const patternJson = JSON.stringify(pattern);
  const existing = await prisma.template.findUnique({ where: { architectId } });

  let mergedFieldPositions = existing?.fieldPositions ? JSON.parse(existing.fieldPositions) : {};
  if (fieldPositions) {
    // Merge new positions (keep old ones if parsing a new one fails)
    mergedFieldPositions = { ...mergedFieldPositions, ...fieldPositions };
  }
  if (!existing) {
    await prisma.template.create({
      data: {
        architectId,
        titleBlockPattern: patternJson,
        fieldPositions: JSON.stringify(mergedFieldPositions),
        titleBlockLocation: titleBlockLocation ?? null,
        revisionBlockLocation: revisionBlockLocation ?? null,
        lastUpdated: new Date(),
      },
    });
  } else {
    const updateData: Record<string, unknown> = {
      titleBlockPattern: patternJson,
      fieldPositions: JSON.stringify(mergedFieldPositions),
      lastUpdated: new Date(),
    };
    if (titleBlockLocation) updateData.titleBlockLocation = titleBlockLocation;
    if (revisionBlockLocation) updateData.revisionBlockLocation = revisionBlockLocation;

    await prisma.template.update({
      where: { architectId },
      data: updateData,
    });
  }
}

/** Increment the confirmed drawing count on an existing pattern. */
export async function incrementPatternConfirmation(architectId: string): Promise<void> {
  const pattern = await getTemplatePattern(architectId);
  if (!pattern) return;

  pattern.confirmedDrawingCount += 1;

  await prisma.template.update({
    where: { architectId },
    data: {
      titleBlockPattern: JSON.stringify(pattern),
      lastUpdated: new Date(),
    },
  });
}

// ── Pattern Validation ─────────────────────────────────────────────

/** Validate that extracted elements match the expected pattern.
 *  Checks: (1) architect firm name present, (2) project name present,
 *  (3) drawing number matches expected format. */
export function validatePatternMatch(
  elements: TextElement[],
  pattern: TitleBlockPattern,
  projectName?: string,
  drawingNumber?: string
): PatternMatchResult {
  const allText = elements.map((e) => e.text.toLowerCase()).join(" ");
  const reasons: string[] = [];
  let matchCount = 0;

  // Check 1: Architect firm name
  const firmLower = pattern.architectFirmName.toLowerCase();
  // Check for at least one keyword from the firm name (2+ char words)
  const firmWords = firmLower.split(/\s+/).filter((w) => w.length >= 3);
  const firmMatch = firmWords.length === 0 || firmWords.some((w) => allText.includes(w));
  if (firmMatch) {
    matchCount++;
  } else {
    reasons.push(`Architect firm name "${pattern.architectFirmName}" not found in text`);
  }

  // Check 2: Project name
  if (projectName) {
    const projLower = projectName.toLowerCase();
    const projWords = projLower.split(/\s+/).filter((w) => w.length >= 3);
    const projMatch = projWords.length === 0 || projWords.some((w) => allText.includes(w));
    if (projMatch) {
      matchCount++;
    } else {
      reasons.push(`Project name "${projectName}" not found in text`);
    }
  } else {
    // No project name to check — give benefit of doubt
    matchCount++;
  }

  // Check 3: Drawing number format
  if (drawingNumber && pattern.drawingNumberFormat) {
    try {
      const regex = new RegExp(pattern.drawingNumberFormat, "i");
      if (regex.test(drawingNumber)) {
        matchCount++;
      } else {
        reasons.push(`Drawing number "${drawingNumber}" doesn't match expected format /${pattern.drawingNumberFormat}/`);
      }
    } catch {
      // Invalid regex — skip check, give benefit of doubt
      matchCount++;
    }
  } else {
    // No format to check
    matchCount++;
  }

  // Need at least 2 of 3 checks to pass
  const matched = matchCount >= 2;

  return {
    matched,
    reason: matched
      ? `Pattern matched (${matchCount}/3 checks passed)`
      : `Pattern mismatch: ${reasons.join("; ")}`,
  };
}

// ── Drawing Number Format Detection ────────────────────────────────

/** Infer a regex pattern from a drawing number string.
 *  e.g. "A101" → "^[A-Z]\\d{3}$", "3049-WD-A401" → "^\\d+-[A-Z]+-[A-Z]\\d+$" */
export function inferDrawingNumberFormat(drawingNumber: string): string | null {
  if (!drawingNumber || drawingNumber.length < 2) return null;

  const cleaned = drawingNumber.trim();

  // Build a generalised regex by replacing character classes
  let pattern = "";
  let i = 0;
  while (i < cleaned.length) {
    if (/[A-Z]/.test(cleaned[i])) {
      // Count consecutive uppercase letters
      let count = 0;
      while (i < cleaned.length && /[A-Z]/.test(cleaned[i])) { count++; i++; }
      pattern += count === 1 ? "[A-Z]" : `[A-Z]{${count}}`;
    } else if (/[a-z]/.test(cleaned[i])) {
      let count = 0;
      while (i < cleaned.length && /[a-z]/.test(cleaned[i])) { count++; i++; }
      pattern += count === 1 ? "[a-z]" : `[a-z]{${count}}`;
    } else if (/\d/.test(cleaned[i])) {
      let count = 0;
      while (i < cleaned.length && /\d/.test(cleaned[i])) { count++; i++; }
      pattern += `\\d{${count}}`;
    } else {
      // Literal separator (-, ., /, etc.)
      pattern += "\\" + cleaned[i];
      i++;
    }
  }

  return `^${pattern}$`;
}

// ── Project-Level Pattern State ────────────────────────────────────

/** Count successfully extracted drawings in a project (excluding cover sheets). */
export async function getProjectExtractedCount(projectId: string): Promise<number> {
  return prisma.drawing.count({
    where: {
      projectId,
      extractionStatus: "extracted",
      documentType: { not: "cover_sheet" },
      drawingNumber: { not: null },
    },
  });
}

/** Get the title block side from the first successfully extracted drawing in a project. */
export async function getProjectConfirmedSide(
  projectId: string
): Promise<"bottom" | "right" | null> {
  const firstExtracted = await prisma.drawing.findFirst({
    where: {
      projectId,
      extractionStatus: "extracted",
      documentType: { not: "cover_sheet" },
      titleBlockLocation: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: { titleBlockLocation: true },
  });

  if (!firstExtracted?.titleBlockLocation) return null;

  const loc = firstExtracted.titleBlockLocation;
  if (loc === "bottom" || loc === "bottom-right") return "bottom";
  if (loc === "right") return "right";
  return null;
}

// ── Legacy compat ──────────────────────────────────────────────────

export async function updateTemplateFromCorrection(
  architectId: string,
  fieldName: string,
  _correctedValue: string | null
): Promise<void> {
  const existing = await prisma.template.findUnique({ where: { architectId } });
  if (!existing) {
    await prisma.template.create({
      data: { architectId, lastUpdated: new Date() },
    });
  } else {
    await prisma.template.update({
      where: { architectId },
      data: { lastUpdated: new Date() },
    });
  }
  void fieldName;
}

// ── Core Auto-Learning: Architect Resolution + Template Update ──────

const PATTERN_LOCK_THRESHOLD_LEARN = 2;

export interface TemplateLearningInput {
  drawingId: string;
  drawingNumber: string | null;
  titleBlockLocation: string | null;
  revisionBlockLocation: string | null;
  fieldCoordinates: Record<string, { x: number; y: number }> | null;
  elements: TextElement[];
  projectId: string;
  projectName: string;
  geminiArchitectFirmName?: string | null;
  existingArchitectId: string | null;
}

export interface TemplateLearningResult {
  architectId: string | null;
  flags: string[];
  log: string[];
}

/**
 * The main template auto-learning trigger.
 * 1. Resolves (or creates) the Architect entity from extraction output or project siblings.
 * 2. Links the drawing to the Architect in the DB.
 * 3. Creates or updates the architect's TitleBlockPattern template.
 *
 * Call this AFTER every successful Gemini extraction.
 */
export async function resolveArchitectAndLearnTemplate(
  input: TemplateLearningInput
): Promise<TemplateLearningResult> {
  const flags: string[] = [];
  const log: string[] = [];

  // ── Step A: Resolve architect ─────────────────────────────────
  let architectId = input.existingArchitectId;

  if (!architectId) {
    // Try to inherit from a sibling drawing in the same project
    const sibling = await prisma.drawing.findFirst({
      where: {
        projectId: input.projectId,
        architectId: { not: null },
        id: { not: input.drawingId },
      },
      select: { architectId: true },
    });

    if (sibling?.architectId) {
      architectId = sibling.architectId;
      flags.push("ARCH_RESOLVED_FROM_SIBLING");
      log.push(`ARCH_RESOLVED_FROM_SIBLING: ${architectId}`);
    }
  }

  if (!architectId) {
    // Use Gemini-extracted firm name to find or create architect
    const firmName = input.geminiArchitectFirmName?.trim();
    if (firmName && firmName.length > 2) {
      const existing = await prisma.architect.findFirst({
        where: { firmName: { equals: firmName } },
      });
      if (existing) {
        architectId = existing.id;
        log.push(`ARCH_FOUND_BY_NAME: ${firmName}`);
      } else {
        const created = await prisma.architect.create({
          data: { firmName },
        });
        architectId = created.id;
        flags.push("ARCH_AUTO_CREATED");
        log.push(`ARCH_CREATED: ${firmName} (${architectId})`);
      }
    }
  }

  if (!architectId) {
    // Final fallback: use a shared "Unknown" architect per project so templates still accumulate
    const unknownName = `Unknown (Project ${input.projectId.slice(-6)})`;
    const existing = await prisma.architect.findFirst({
      where: { firmName: unknownName },
    });
    if (existing) {
      architectId = existing.id;
    } else {
      const created = await prisma.architect.create({ data: { firmName: unknownName } });
      architectId = created.id;
    }
    flags.push("ARCH_FALLBACK_UNKNOWN");
    log.push(`ARCH_FALLBACK: using "${unknownName}"`);
  }

  // ── Step B: Link drawing to architect ────────────────────────
  await prisma.drawing.update({
    where: { id: input.drawingId },
    data: { architectId },
  });
  log.push(`DRAWING_LINKED: architectId=${architectId}`);

  // ── Step C: Learn template pattern ───────────────────────────
  if (!input.drawingNumber) {
    log.push("TEMPLATE_SKIP: no drawing number extracted");
    return { architectId, flags, log };
  }

  const side: "bottom" | "right" =
    input.titleBlockLocation === "right" ? "right" : "bottom";

  const currentPattern = await getTemplatePattern(architectId);
  const drawingNumberFormat = inferDrawingNumberFormat(input.drawingNumber);
  const cleanFieldPositions =
    input.fieldCoordinates && Object.keys(input.fieldCoordinates).length > 0
      ? input.fieldCoordinates
      : null;

  const elements = input.elements;
  const pageWidth = elements[0]?.page_width ?? 595;
  const pageHeight = elements[0]?.page_height ?? 842;

  const regionBbox: TitleBlockBbox =
    side === "bottom"
      ? { x0: 0, y0: pageHeight * 0.75, x1: pageWidth, y1: pageHeight }
      : { x0: pageWidth * 0.7, y0: 0, x1: pageWidth, y1: pageHeight };

  const architect = await prisma.architect.findUnique({
    where: { id: architectId },
    select: { firmName: true },
  });

  if (!currentPattern) {
    const newPattern: TitleBlockPattern = {
      side,
      bbox: regionBbox,
      confirmedDrawingCount: 1,
      architectFirmName: architect?.firmName ?? "Unknown",
      drawingNumberFormat: drawingNumberFormat ?? undefined,
    };
    await saveTemplatePattern(
      architectId,
      newPattern,
      input.titleBlockLocation ?? undefined,
      input.revisionBlockLocation ?? undefined,
      cleanFieldPositions
    );
    log.push(`TEMPLATE_CREATED (count=1, side=${side})`);
  } else if (currentPattern.confirmedDrawingCount < PATTERN_LOCK_THRESHOLD_LEARN) {
    if (currentPattern.side === side) {
      currentPattern.confirmedDrawingCount += 1;
      if (!currentPattern.drawingNumberFormat && drawingNumberFormat) {
        currentPattern.drawingNumberFormat = drawingNumberFormat;
      }
      await saveTemplatePattern(
        architectId,
        currentPattern,
        input.titleBlockLocation ?? undefined,
        input.revisionBlockLocation ?? undefined,
        cleanFieldPositions
      );
      log.push(`TEMPLATE_UPDATED (count=${currentPattern.confirmedDrawingCount}, side=${side})`);
      if (currentPattern.confirmedDrawingCount >= PATTERN_LOCK_THRESHOLD_LEARN) {
        flags.push("PATTERN_LOCKED");
        log.push("PATTERN_LOCKED");
      }
    } else {
      flags.push("PATTERN_SIDE_MISMATCH");
      log.push(`TEMPLATE_SIDE_MISMATCH: expected ${currentPattern.side}, got ${side}`);
    }
  } else {
    // Pattern already locked
    if (currentPattern.side === side) {
      await incrementPatternConfirmation(architectId);
      flags.push("PATTERN_CONFIRMED");
      log.push(`PATTERN_CONFIRMED (count=${currentPattern.confirmedDrawingCount + 1})`);
    } else {
      flags.push("PATTERN_MISMATCH");
      log.push(`PATTERN_MISMATCH_LOCKED: expected ${currentPattern.side}, got ${side}`);
    }
  }

  return { architectId, flags, log };
}

