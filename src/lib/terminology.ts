/**
 * A terminology normalization layer mapping discovered format variations to canonical groups.
 * This dictionary should be expanded over time as new architect and consultant variations are encountered.
 */
export const TERMINOLOGY_MAP: Record<string, string[]> = {
  revision: [
    "rev",
    "r",
    "revision",
    "rev no",
    "revision no",
    "issue",
    "issue no",
    "iss",
    "current issue",
    "current rev",
  ],
  drawing_number: [
    "drawing no",
    "drg no",
    "dwg no",
    "sheet no",
    "drawing number",
    "sheet number",
    "sheet num",
    "drg",
    "dwg",
    "drawing",
    "ref no",
    "project drawing number",
  ],
  drawing_title: [
    "title",
    "drawing title",
    "sheet title",
    "description",
    "drawing name",
  ],
  revision_date: [
    "date",
    "rev date",
    "revision date",
    "issue date",
    "date drawn",
  ],
  status: [
    "status",
    "drawing status",
    "issue status",
    "issued for",
    "for",
    "purpose of issue",
  ],
  location: [
    "project address",
    "site address",
    "address",
    "location",
    "project location",
    "site",
    "property",
  ],
};

/**
 * Given a raw label from a drawing, attempt to map it to a canonical field group.
 */
export function getCanonicalField(rawLabel: string): string | null {
  const normalized = rawLabel.toLowerCase().trim();
  for (const [canonical, variants] of Object.entries(TERMINOLOGY_MAP)) {
    if (variants.includes(normalized)) {
      return canonical;
    }
  }
  return null;
}

/**
 * Generate a prompt string listing all canonical mapped variations.
 */
export function generateTerminologyPromptContext(): string {
  let context = "--- TERMINOLOGY MAPPING RULES ---\n";
  context += "Treat the following labels as equivalent descriptors for the specified fields:\n";
  for (const [canonical, variants] of Object.entries(TERMINOLOGY_MAP)) {
    context += `- ${canonical}: ${variants.join(", ")}\n`;
  }
  return context;
}
