import { prisma } from "./db";

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

  return `
Known template for this architect (firm: ${architect.firmName}):
- Title block location: ${t.titleBlockLocation || "unknown"}
- Revision block location: ${t.revisionBlockLocation || "unknown"}
- Known field labels: ${JSON.stringify(labelMap)}
- Revision column order: ${JSON.stringify(columnOrder)}
- Revision reading direction: ${t.revisionReadingDirection || "unknown"}
Use this context to guide your extraction. If the drawing does not match this template, ignore the template and proceed with general rules. Note any mismatch in the notes field.`.trim();
}

export async function updateTemplateFromCorrection(
  architectId: string,
  fieldName: string,
  _correctedValue: string | null
): Promise<void> {
  // For now, just ensure a template record exists.
  // Future: parse field label mappings from corrections.
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
  void fieldName; // suppress unused warning — used in future improvement loop
}
