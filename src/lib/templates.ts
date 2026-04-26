import { prisma } from "./db";
import { TextElement } from "./pdfplumber";

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

// ── Pre-Resolution: Architect lookup BEFORE extraction ─────────────

/**
 * Attempt to resolve the architect for a drawing BEFORE running extraction,
 * by inheriting from a sibling drawing in the same project that already has one.
 */
export async function preResolveArchitectFromSibling(
  drawingId: string,
  projectId: string
): Promise<string | null> {
  const sibling = await prisma.drawing.findFirst({
    where: {
      projectId,
      architectId: { not: null },
      id: { not: drawingId },
    },
    select: { architectId: true },
  });
  return sibling?.architectId ?? null;
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

// ── Format Inference Helpers ────────────────────────────────────────

/** Infer a human-readable description of the drawing number format. */
export function inferDrawingNumberFormatDesc(drawingNumber: string): string {
  if (!drawingNumber || drawingNumber.length < 2) return "Unknown";

  const dn = drawingNumber.trim();

  if (/^[A-Z]\d{2,4}$/.test(dn)) return `Letter prefix + ${dn.length - 1} digits (e.g. ${dn})`;
  if (/^[A-Z]{2,3}\d{2,4}$/.test(dn)) return `Alpha prefix + digits (e.g. ${dn})`;
  if (/^[\w]+-[\w]+-[\w]+$/.test(dn)) return `Compound sections (e.g. ${dn})`;
  if (/^\d+$/.test(dn)) return `Numeric only (e.g. ${dn})`;
  if (/^\d+\.[A-Z]\d+/.test(dn)) return `Decimal-prefixed (e.g. ${dn})`;

  return `Custom format (e.g. ${dn})`;
}

/** Infer the revision number format from a value. */
export function inferRevisionNumberFormat(revision: string | null): string | null {
  if (!revision || revision === "-") return null;
  if (revision === "#") return "First-issue marker (#)";
  if (/^[A-Z]$/.test(revision)) return "Single letter (A, B, C)";
  if (/^[A-Z]{1,2}\d+$/.test(revision)) return `Letter+number (${revision.length <= 2 ? "e.g. T1, P1" : "e.g. BP7"})`;
  if (/^\d+$/.test(revision)) return "Numeric only (1, 2, 3)";
  if (/^[A-Z]{1,3}\d*[A-Z]?\d*$/.test(revision)) return `Alphanumeric (${revision.substring(0, 4)}-style)`;
  return "Custom";
}

/** Infer the revision date format from a raw (pre-normalisation) value. */
export function inferRevisionDateFormat(rawDate: string | null): string | null {
  if (!rawDate) return null;
  const d = rawDate.trim();

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return "DD/MM/YYYY";
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(d)) return "DD/MM/YY";
  if (/^\d{2}\.\d{2}\.\d{2,4}$/.test(d)) return "DD.MM.YY(YY)";
  if (/^\d{2}-\d{2}-\d{2,4}$/.test(d)) return "DD-MM-YY(YY)";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return "YYYY-MM-DD (ISO)";
  if (/^\d{2}\/\d{2}$/.test(d)) return "DD/MM (no year)";
  if (/^[A-Za-z]{3}[\s-]\d{2,4}$/.test(d)) return "Mon YY";
  return "Custom";
}

// ── Core Auto-Learning: Architect Resolution + Template Enrichment ──

export interface TemplateLearningInput {
  drawingId: string;
  drawingNumber: string | null;
  titleBlockLocation: string | null;
  revisionBlockLocation: string | null;
  elements: TextElement[];
  projectId: string;
  projectName: string;
  geminiArchitectFirmName?: string | null;
  existingArchitectId: string | null;
  revision?: string | null;
  revisionDate?: string | null;
  revisionDateRaw?: string | null;
  status?: string | null;
}

export interface TemplateLearningResult {
  architectId: string | null;
  flags: string[];
  log: string[];
}

/**
 * Resolves (or creates) the Architect entity and enriches the template with
 * format metadata learned from this drawing. Does NOT store bbox coordinates.
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

  // ── Step C: Enrich template with format metadata ──────────────
  if (!input.drawingNumber) {
    log.push("TEMPLATE_SKIP: no drawing number extracted");
    return { architectId, flags, log };
  }

  const enrichData: Record<string, unknown> = {};

  if (input.drawingNumber) {
    enrichData.drawingNumberFormatDesc = inferDrawingNumberFormatDesc(input.drawingNumber);
  }

  if (input.revision) {
    const rnf = inferRevisionNumberFormat(input.revision);
    if (rnf) enrichData.revisionNumberFormat = rnf;
  }

  if (input.revisionDateRaw) {
    const rdf = inferRevisionDateFormat(input.revisionDateRaw);
    if (rdf) enrichData.revisionDateFormat = rdf;
  } else if (input.revisionDate) {
    enrichData.revisionDateFormat = "DD/MM/YYYY";
  }

  if (input.status) {
    const existingTemplate = await prisma.template.findUnique({
      where: { architectId },
      select: { statusTerminology: true },
    });
    const existing: string[] = existingTemplate?.statusTerminology
      ? JSON.parse(existingTemplate.statusTerminology)
      : [];
    if (!existing.includes(input.status)) {
      existing.push(input.status);
      enrichData.statusTerminology = JSON.stringify(existing);
    }
  }

  if (Object.keys(enrichData).length > 0) {
    await prisma.template.upsert({
      where: { architectId },
      create: { architectId, ...enrichData, lastUpdated: new Date() },
      update: { ...enrichData, lastUpdated: new Date() },
    });
    log.push(`TEMPLATE_ENRICHED: ${Object.keys(enrichData).join(", ")}`);
  }

  return { architectId, flags, log };
}
