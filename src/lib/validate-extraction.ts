import { GeminiExtractionResult, FieldCoordinate } from "./gemini";
import type { TextElement } from "./pdfplumber";

export interface FieldCoordinates {
  drawing_number: FieldCoordinate | null;
  drawing_title: FieldCoordinate | null;
  revision: FieldCoordinate | null;
  revision_date: FieldCoordinate | null;
  status: FieldCoordinate | null;
  location: FieldCoordinate | null;
}

export interface ExtractionFieldRule {
  /** Where the value came from — filled by the extract route after validateExtraction */
  source?: string;             // "crop_bbox" | "region" | "vision" | "revision_block" | "bbox_override"
  blockLocation?: string;      // revisionBlockLocation, for revision / revisionDate fields
  transforms: string[];        // e.g. ["newlines_collapsed", "date_normalised", "status_normalised"]
  validation: "passed" | "failed" | "flagged";
  rawValue?: string;           // pre-normalisation Gemini value (dates, status)
  normalisedFormat?: string;   // revisionDate: detected input format e.g. "DD/MM/YY"
  canonical?: string;          // status: the canonical value mapped to
}

export interface ExtractionRules {
  drawingNumber: ExtractionFieldRule;
  drawingTitle:  ExtractionFieldRule;
  revision:      ExtractionFieldRule;
  revisionDate:  ExtractionFieldRule;
  status:        ExtractionFieldRule;
  [key: string]: ExtractionFieldRule;
}

export interface ValidationResult {
  drawingNumber: string | null;
  drawingTitle: string | null;
  revision: string | null;
  revisionDate: string | null;
  status: string | null;
  location: string | null;
  fieldCoordinates: FieldCoordinates | null;
  confidenceDrawingNumber: number;
  confidenceDrawingTitle: number;
  confidenceRevision: number;
  confidenceRevisionDate: number;
  confidenceStatus: number;
  confidenceLocation: number;
  conflictDetected: boolean;
  conflictDetail: string | null;
  documentType: string;
  titleBlockLocation: string;
  revisionBlockLocation: string;
  flags: string[];
  notes: string | null;
  extractionRules: ExtractionRules;
}

import { prisma } from "./db";

async function getStatusNormalisationRules(): Promise<Record<string, string>> {
  const rule = await prisma.systemRule.findUnique({
    where: { ruleType: "STATUS_NORMALISATION" },
  });
  if (!rule) return {};
  try {
    return JSON.parse(rule.content);
  } catch {
    return {};
  }
}

/**
 * Hardcoded canonical status map — exhaustive, deterministic.
 * Keys are lowercase trimmed variants; values are the canonical display string.
 * DB STATUS_NORMALISATION rules can supplement but never override this map.
 */
const CANONICAL_STATUS: Record<string, string> = {
  // Construction Issue
  "construction issue":                  "Construction Issue",
  "issued for construction":             "Construction Issue",
  "issue for construction":              "Construction Issue",
  "for construction":                    "Construction Issue",
  "for construction (fc)":              "Construction Issue",
  "construction":                        "Construction Issue",
  "ifc":                                 "Construction Issue",
  "fc":                                  "Construction Issue",
  "cd issue":                            "Construction Issue",
  "construction d&c":                    "Construction Issue",
  "issued construction":                 "Construction Issue",

  // Preliminary Construction Issue
  "preliminary construction issue":      "Preliminary Construction Issue",
  "pci":                                 "Preliminary Construction Issue",
  "preliminary ifc":                     "Preliminary Construction Issue",

  // Tender Issue
  "tender issue":                        "Tender Issue",
  "issued for tender":                   "Tender Issue",
  "for tender":                          "Tender Issue",
  "ift":                                 "Tender Issue",
  "tender":                              "Tender Issue",
  "tender d&c":                          "Tender Issue",
  "tender documentation":                "Tender Issue",
  "revised tender issue":                "Tender Issue",
  "tenderable":                          "Tender Issue",
  "pre-tender issue":                    "Tender Issue",

  // Preliminary
  "preliminary":                         "Preliminary",
  "preliminary issue":                   "Preliminary",
  "sketch design":                       "Preliminary",
  "draft":                               "Preliminary",
  "preliminary d&c":                     "Preliminary",

  // Design Development
  "design development":                  "Design Development",
  "dd":                                  "Design Development",

  // For Approval
  "for approval":                        "For Approval",
  "approval":                            "For Approval",
  "ifa":                                 "For Approval",
  "approved":                            "For Approval",
  "approved as noted":                   "For Approval",
  "aan":                                 "For Approval",

  // For Review
  "for review":                          "For Review",
  "issue for review":                    "For Review",
  "issued for review":                   "For Review",
  "ifr":                                 "For Review",

  // For Information Only
  "for information only":                "For Information Only",
  "for information":                     "For Information Only",
  "for info":                            "For Information Only",
  "fi":                                  "For Information Only",
  "for information only not for construction": "For Information Only",

  // For Coordination
  "for coordination":                    "For Coordination",
  "coordination issue":                  "For Coordination",

  // For Pricing
  "for pricing":                         "For Pricing",

  // For Building Approval (generic council building approval)
  "for building approval":               "For Building Approval",
  "building approval":                   "For Building Approval",

  // For Building Permit (BP Issue — different jurisdiction/permit type)
  "building permit issue":               "For Building Permit",
  "bp issue":                            "For Building Permit",
  "for building permit":                 "For Building Permit",

  // For CDC Approval (NSW Complying Development Certificate — legally distinct)
  "for cdc approval":                    "For CDC Approval",
  "cdc approval":                        "For CDC Approval",
  "cdc":                                 "For CDC Approval",
  "cdc issue":                           "For CDC Approval",

  // Not for Construction
  "not for construction":                "Not for Construction",
  "nfc":                                 "Not for Construction",

  // As Built / As Installed
  "as built":                            "As Built",
  "as-built":                            "As Built",
  "as installed":                        "As Installed",
  "as-installed":                        "As Installed",

  // Working Drawing
  "working drawing":                     "Working Drawing",

  // Superseded / Void
  "superseded":                          "Superseded",
  "void":                                "Void",

  // Schematic Design
  "schematic design":                    "Schematic Design",
  "sd":                                  "Schematic Design",
};

async function normaliseStatus(raw: string | null): Promise<string | null> {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();

  // Hardcoded map first — deterministic, exhaustive
  if (key in CANONICAL_STATUS) return CANONICAL_STATUS[key];

  // DB rules as supplement for project-specific overrides
  const rules = await getStatusNormalisationRules();
  if (key in rules) {
    const mapped = rules[key].toLowerCase().trim();
    // Re-run through canonical map in case DB rule points to a variant
    return CANONICAL_STATUS[mapped] ?? rules[key];
  }

  return raw;
}

function normaliseDate(raw: string | null): { value: string | null; confidence?: number; flagged: boolean; format?: string } {
  if (!raw) return { value: null, flagged: false };

  const cleaned = raw.trim().replace(/_/g, "-").replace(/\\/g, "/");

  // Already DD/MM/YYYY
  if (/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.test(cleaned)) {
    const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return { value: `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`, flagged: false, format: "DD/MM/YYYY" };
  }

  // DD/MM/YY → assume 2000s
  const dmyShort = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (dmyShort) return { value: `${dmyShort[1].padStart(2, "0")}/${dmyShort[2].padStart(2, "0")}/20${dmyShort[3]}`, flagged: false, format: "DD/MM/YY" };

  // DD.MM.YY or DD.MM.YYYY
  const dotFormat = cleaned.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotFormat) {
    const year = dotFormat[3].length === 2 ? `20${dotFormat[3]}` : dotFormat[3];
    const fmt = dotFormat[3].length === 2 ? "DD.MM.YY" : "DD.MM.YYYY";
    return { value: `${dotFormat[1].padStart(2, "0")}/${dotFormat[2].padStart(2, "0")}/${year}`, flagged: false, format: fmt };
  }

  // DD-MM-YYYY or DD-MM-YY
  const dashFormat = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dashFormat) {
    const year = dashFormat[3].length === 2 ? `20${dashFormat[3]}` : dashFormat[3];
    const fmt = dashFormat[3].length === 2 ? "DD-MM-YY" : "DD-MM-YYYY";
    return { value: `${dashFormat[1].padStart(2, "0")}/${dashFormat[2].padStart(2, "0")}/${year}`, flagged: false, format: fmt };
  }

  // YYYY-MM-DD or YYYY.MM.DD or YYYY/MM/DD
  const isoFormat = cleaned.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (isoFormat) {
    return { value: `${isoFormat[3].padStart(2, "0")}/${isoFormat[2].padStart(2, "0")}/${isoFormat[1]}`, flagged: false, format: "YYYY-MM-DD" };
  }

  // DD/MM only (no year)
  if (/^(\d{1,2})\/(\d{1,2})$/.test(cleaned)) {
    const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) return { value: `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}`, confidence: 0.6, flagged: false, format: "DD/MM" };
  }

  // Month YY (e.g. "Nov 25", "FEB 2026", "NOV 24", "Nov-25")
  const monthYear = cleaned.match(/^([A-Za-z]+)[\s-]+(\d{2,4})$/);
  if (monthYear) {
    const monthMap: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const mm = monthMap[monthYear[1].toLowerCase().slice(0, 3)];
    if (mm) {
      const yearRaw = monthYear[2];
      const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
      return { value: `01/${mm}/${year}`, confidence: 0.7, flagged: false, format: "Mon YY" };
    }
  }

  // Full month name + day + year (e.g. "January 15, 2025")
  const fullDate = new Date(cleaned);
  if (!isNaN(fullDate.getTime())) {
    const dd = String(fullDate.getDate()).padStart(2, "0");
    const mm = String(fullDate.getMonth() + 1).padStart(2, "0");
    const yyyy = fullDate.getFullYear();
    return { value: `${dd}/${mm}/${yyyy}`, flagged: false, format: "natural language" };
  }

  // Unparseable — strip alpha characters to get base date, but flag it
  const numericData = cleaned.replace(/[^0-9/.-]/g, "");
  if (numericData.length >= 6) {
    return { value: numericData, confidence: 0.4, flagged: true, format: "unknown" };
  }

  return { value: cleaned, flagged: true, format: "unknown" };
}

/** Normalize drawing title: collapse newlines to spaces, strip extra whitespace. */
function cleanDrawingTitle(title: string | null): string | null {
  if (!title) return null;
  const cleaned = title
    .replace(/[\r\n]+/g, " ") // newlines → single space
    .replace(/\s+/g, " ")     // collapse multiple spaces
    .trim();
  return cleaned || null;
}

/** Return true if a drawing number looks like a real identifier (not a title). */
function looksLikeDrawingNumber(drawingNumber: string | null): boolean {
  if (!drawingNumber) return false;
  // Drawing numbers must not contain newlines
  if (/[\r\n]/.test(drawingNumber)) return false;
  // Drawing numbers are short — if more than 30 chars it's probably a title
  if (drawingNumber.length > 30) return false;
  // If it contains more than 2 spaces, it reads like a sentence, not an identifier
  const spaceCount = (drawingNumber.match(/ /g) || []).length;
  if (spaceCount > 2) return false;
  return true;
}

function cleanDrawingNumber(
  drawingNumber: string | null,
  revision: string | null
): { drawingNumber: string | null; revision: string | null; bulletStripped: boolean } {
  if (!drawingNumber) return { drawingNumber, revision, bulletStripped: false };

  // Strip bullet suffix (e.g. A000•B → A000, revision: B)
  const bulletMatch = drawingNumber.match(/^(.+)[•·]([A-Z]\d*)$/);
  if (bulletMatch) {
    return {
      drawingNumber: bulletMatch[1].trim(),
      revision: revision || bulletMatch[2],
      bulletStripped: true,
    };
  }

  return { drawingNumber: drawingNumber.trim(), revision, bulletStripped: false };
}

// ═══════════════════════════════════════════════════════════════════
// CROSS-VALIDATION: Verify Gemini output against source text evidence
// ═══════════════════════════════════════════════════════════════════

/** Build a lowercase text corpus by joining all element texts. */
function buildCorpus(elements: TextElement[]): string {
  return elements.map((e) => e.text.toLowerCase().trim()).join(" ");
}

/**
 * Check if any known status vocabulary term appears in the source elements.
 * Returns the matching term if found, null otherwise.
 */
function findStatusInElements(elements: TextElement[]): string | null {
  if (elements.length === 0) return null;
  const corpus = buildCorpus(elements);

  // Check multi-word phrases first (longest match wins)
  const sortedKeys = Object.keys(CANONICAL_STATUS).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (key.length >= 3 && corpus.includes(key)) return key;
  }
  return null;
}

/**
 * Check if a specific text value appears in the source elements.
 * Tries exact match, then case-insensitive substring match.
 */
function valueExistsInElements(value: string | null, elements: TextElement[]): boolean {
  if (!value || elements.length === 0) return false;
  const needle = value.toLowerCase().trim();
  // Check individual elements first (exact match on a single element)
  for (const el of elements) {
    if (el.text.toLowerCase().trim() === needle) return true;
    if (el.text.toLowerCase().trim().includes(needle)) return true;
  }
  // Check corpus (value may span multiple elements)
  const corpus = buildCorpus(elements);
  return corpus.includes(needle);
}

/**
 * Returns true if the date value in elements is within close horizontal proximity
 * of a creation-date label (DATE:, DRAWN:, etc.) — meaning it's the drawing
 * creation date, not the revision date.
 *
 * Strategy: find the element(s) containing the date text, then check if any
 * creation-date label element is within 200pt horizontally on the same row (±20pt y).
 */
function isMatchedToCreationDateLabel(
  rawDate: string | null,
  normalisedDate: string | null,
  elements: TextElement[],
  creationLabels: string[]
): boolean {
  // Find all elements that contain the date text
  const candidates = [rawDate, normalisedDate].filter(Boolean) as string[];
  const dateElements: TextElement[] = [];
  for (const cand of candidates) {
    for (const el of elements) {
      if (el.text.trim().toLowerCase().includes(cand.toLowerCase()) ||
          el.text.trim().replace(/\s/g, "").toLowerCase() === cand.replace(/\s/g, "").toLowerCase()) {
        dateElements.push(el);
      }
    }
  }
  // Also try date variants (MM/DD/YY, DD/MM/YY, etc.)
  if (dateElements.length === 0 && (rawDate || normalisedDate)) {
    const dateStr = normalisedDate || rawDate!;
    const parts = dateStr.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
    if (parts) {
      const [, d, m, y] = parts;
      const year2 = y.length === 4 ? y.slice(2) : y;
      const variants = [
        `${d}/${m}/${y}`, `${m}/${d}/${y}`,
        `${d}/${m}/${year2}`, `${m}/${d}/${year2}`,
        `${d}.${m}.${y}`, `${m}.${d}.${y}`,
      ];
      for (const el of elements) {
        if (variants.some(v => el.text.trim() === v)) dateElements.push(el);
      }
    }
  }
  if (dateElements.length === 0) return false;

  // Check if any creation-date label is on the same row and within 200pt
  const labelElements = elements.filter(el => {
    const t = el.text.trim().toLowerCase();
    return creationLabels.some(lbl => t === lbl || t.startsWith(lbl));
  });
  if (labelElements.length === 0) return false;

  for (const dateEl of dateElements) {
    for (const labelEl of labelElements) {
      const sameRow = Math.abs(dateEl.y - labelEl.y) <= 20;
      const closeHoriz = Math.abs(dateEl.x - labelEl.x) <= 200;
      if (sameRow && closeHoriz) return true;
    }
  }
  return false;
}

/**
 * Check if a date string (in various formats) appears in elements.
 * Tries multiple zero-padding variants and separator styles.
 * Example: "01/06/2023" in Gemini output should match "1/6/2023" in elements.
 */
function dateExistsInElements(rawDate: string | null, normalisedDate: string | null, elements: TextElement[]): boolean {
  if (elements.length === 0) return false;
  // Try raw Gemini value and normalised value directly
  if (rawDate && valueExistsInElements(rawDate, elements)) return true;
  if (normalisedDate && valueExistsInElements(normalisedDate, elements)) return true;

  // Parse the date into day/month/year, then try all padding/separator variants
  const dateStr = normalisedDate || rawDate;
  if (!dateStr) return false;
  const parts = dateStr.match(/(\d{1,2})[/.\\-](\d{1,2})[/.\\-](\d{2,4})/);
  if (!parts) return false;

  const [, dayRaw, monthRaw, yearRaw] = parts;
  const dayNum = parseInt(dayRaw, 10);
  const monthNum = parseInt(monthRaw, 10);
  const dayUnpadded = String(dayNum);
  const dayPadded = String(dayNum).padStart(2, "0");
  const monthUnpadded = String(monthNum);
  const monthPadded = String(monthNum).padStart(2, "0");
  const year2 = yearRaw.length === 4 ? yearRaw.slice(2) : yearRaw;
  const year4 = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;

  const corpus = buildCorpus(elements);

  // Build all plausible date variants and check each against the corpus.
  // Try both DD/MM/YY (AU/EU) and MM/DD/YY (US) orderings since PDFs may store
  // the raw US format while Gemini normalises to DD/MM/YYYY.
  const separators = ["/", ".", "-"];
  const dayVariants = [dayUnpadded, dayPadded];
  const monthVariants = [monthUnpadded, monthPadded];
  const yearVariants = [year4, year2];

  for (const sep of separators) {
    for (const d of dayVariants) {
      for (const m of monthVariants) {
        for (const y of yearVariants) {
          // DD/MM/YY (normalised order)
          if (corpus.includes(`${d}${sep}${m}${sep}${y}`)) return true;
          // MM/DD/YY (US format — same numbers, swapped)
          if (corpus.includes(`${m}${sep}${d}${sep}${y}`)) return true;
        }
      }
    }
  }

  // Month name variants (e.g. "Jan 2023", "15 Jan 2023")
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthIdx = monthNum - 1;
  if (monthIdx >= 0 && monthIdx < 12) {
    const monName = monthNames[monthIdx];
    if (corpus.includes(`${monName} ${year4}`) || corpus.includes(`${monName} ${year2}`)) return true;
    if (corpus.includes(`${dayUnpadded} ${monName} ${year4}`)) return true;
    if (corpus.includes(`${dayPadded} ${monName} ${year4}`)) return true;
  }

  // Year-only fallback: PDFs sometimes store only the 4-digit year as text (day/month as graphics).
  // If the year exists as a standalone text element, accept the date — Gemini found a real anchor.
  if (year4 && elements.some(e => e.text.trim() === year4)) return true;

  return false;
}

/**
 * Detect suspiciously generic dates that suggest a creation date rather than a revision date.
 * Example: "01/01/2010" (first day of year) is often a drawing date, not a revision date.
 */
function isSuspiciousDate(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const [, day, month] = m;
  // First day of month is suspicious (often means only month+year were visible, day defaulted to 01)
  if (day === "01" && month === "01") return true; // Jan 1st — very suspicious
  return false;
}

/**
 * Cross-validate Gemini extraction output against source text elements.
 *
 * Rule: Every field value must have textual evidence in the raw extracted elements.
 * If a value is not supported by the source text, it is nulled out and flagged.
 *
 * For Vision-mode (no elements), applies confidence-based rules instead.
 *
 * Mutates `validated` in place.
 */
export function crossValidateWithElements(
  validated: ValidationResult,
  elements: TextElement[],
  raw: GeminiExtractionResult
): void {
  const isVisionMode = elements.length === 0;

  // ── STATUS ─────────────────────────────────────────────────────────
  if (validated.status) {
    if (!isVisionMode) {
      // Text mode: status must appear as vocabulary in elements
      const found = findStatusInElements(elements);
      if (!found) {
        validated.extractionRules.status.validation = "failed";
        validated.extractionRules.status.transforms.push("nulled_no_text_evidence");
        validated.flags.push("STATUS_NOT_IN_TEXT");
        validated.status = null;
        validated.confidenceStatus = 0;
      }
    } else {
      // Vision mode: require HIGH confidence — Gemini Vision confidently hallucinates status.
      // 0.9 threshold: only accept when Gemini is very sure (large clear stamp visible).
      if (validated.confidenceStatus < 0.9) {
        validated.extractionRules.status.validation = "failed";
        validated.extractionRules.status.transforms.push("nulled_low_confidence_vision");
        validated.flags.push("STATUS_LOW_CONFIDENCE_VISION");
        validated.status = null;
        validated.confidenceStatus = 0;
      }
    }
  }

  // ── REVISION DATE ──────────────────────────────────────────────────
  if (validated.revisionDate) {
    if (!isVisionMode) {
      // Text mode: date value must appear somewhere in the elements
      const dateFound = dateExistsInElements(raw.revision_date, validated.revisionDate, elements);
      if (!dateFound) {
        validated.extractionRules.revisionDate.validation = "failed";
        validated.extractionRules.revisionDate.transforms.push("nulled_no_text_evidence");
        validated.flags.push("REVISION_DATE_NOT_IN_TEXT");
        validated.revisionDate = null;
        validated.confidenceRevisionDate = 0;
      } else {
        // Hard rule: if a revision block is confirmed present (integrated or separate) AND
        // the date is found only adjacent to a creation-date label (DATE:, DRAWN:, SCALE:,
        // etc.) in the main title block — not the revision table — it is the drawing
        // creation date, NOT the revision date. Null it unconditionally.
        // Guard: only apply when revisionBlockLocation is not "none" — if there is truly no
        // revision block, a bare "DATE:" label may legitimately be the only date available.
        const revBlockPresent = validated.revisionBlockLocation &&
          validated.revisionBlockLocation !== "none" &&
          validated.revisionBlockLocation !== "unknown";
        if (revBlockPresent) {
          const CREATION_DATE_LABELS = [
            "date:", "drawn:", "drawn by:", "drawn date:", "date drawn:", "date of drawing:",
            "scale:", "checked:", "checked by:", "designed:", "designed by:",
            "authored:", "author:", "created:", "prepared:", "prepared by:",
            "draftsperson:", "draughtsperson:", "draughts person:",
          ];
          if (isMatchedToCreationDateLabel(raw.revision_date, validated.revisionDate, elements, CREATION_DATE_LABELS)) {
            validated.extractionRules.revisionDate.validation = "failed";
            validated.extractionRules.revisionDate.transforms.push("nulled_creation_date_label");
            validated.flags.push("REVISION_DATE_IS_CREATION_DATE");
            validated.revisionDate = null;
            validated.confidenceRevisionDate = 0;
          }
        }
      }
    } else {
      // Vision mode: require high confidence — Gemini Vision often reads creation date instead
      if (validated.confidenceRevisionDate < 0.9) {
        validated.extractionRules.revisionDate.validation = "failed";
        validated.extractionRules.revisionDate.transforms.push("nulled_low_confidence_vision");
        validated.flags.push("REVISION_DATE_LOW_CONFIDENCE_VISION");
        validated.revisionDate = null;
        validated.confidenceRevisionDate = 0;
      }
    }
    // Both modes: null suspiciously generic dates (01/01/YYYY — creation date, not revision date)
    if (validated.revisionDate && isSuspiciousDate(validated.revisionDate)) {
      validated.extractionRules.revisionDate.validation = "failed";
      validated.extractionRules.revisionDate.transforms.push("nulled_suspicious_generic_date");
      validated.flags.push("REVISION_DATE_SUSPICIOUS");
      validated.revisionDate = null;
      validated.confidenceRevisionDate = 0;
    }

    // Vision mode + revision conflict: can't verify which source is correct — null date
    if (isVisionMode && validated.revisionDate && validated.flags.includes("REVISION_CONFLICT")) {
      validated.extractionRules.revisionDate.validation = "failed";
      validated.extractionRules.revisionDate.transforms.push("nulled_conflict_vision");
      validated.flags.push("REVISION_DATE_CONFLICT_VISION");
      validated.revisionDate = null;
      validated.confidenceRevisionDate = 0;
    }
  }

  // ── REVISION ───────────────────────────────────────────────────────
  if (validated.revision) {
    if (!isVisionMode) {
      // Text mode: revision letter/number must appear in elements
      const revFound = valueExistsInElements(validated.revision, elements);
      if (!revFound) {
        validated.extractionRules.revision.validation = "failed";
        validated.extractionRules.revision.transforms.push("nulled_no_text_evidence");
        validated.flags.push("REVISION_NOT_IN_TEXT");
        validated.revision = null;
        validated.confidenceRevision = 0;
      }
    }
    // Vision mode: trust the revision value (it's usually a single letter and hard to hallucinate)
  }

  // ── DRAWING NUMBER ─────────────────────────────────────────────────
  if (validated.drawingNumber) {
    if (!isVisionMode) {
      const numFound = valueExistsInElements(validated.drawingNumber, elements);
      if (!numFound) {
        validated.extractionRules.drawingNumber.validation = "flagged";
        validated.extractionRules.drawingNumber.transforms.push("not_found_in_text");
        validated.flags.push("DRAWING_NUMBER_NOT_IN_TEXT");
        // Don't null — drawing number is critical, flag for review instead
      }
    }
  }

  // ── DRAWING TITLE ──────────────────────────────────────────────────
  if (validated.drawingTitle) {
    if (!isVisionMode) {
      // Check if at least the first significant word of the title appears
      const words = validated.drawingTitle.split(/\s+/).filter((w) => w.length > 3);
      const corpus = buildCorpus(elements);
      const matchCount = words.filter((w) => corpus.includes(w.toLowerCase())).length;
      if (words.length > 0 && matchCount === 0) {
        validated.extractionRules.drawingTitle.validation = "flagged";
        validated.extractionRules.drawingTitle.transforms.push("not_found_in_text");
        validated.flags.push("DRAWING_TITLE_NOT_IN_TEXT");
      }
    }
  }

  // Deduplicate flags
  validated.flags = [...new Set(validated.flags)];
}

export async function validateExtraction(
  raw: GeminiExtractionResult,
  confidenceThreshold: number = 0.7
): Promise<ValidationResult> {
  const flags: string[] = [];

  // Drawing number cleanup
  const { drawingNumber: rawDrawingNumber, revision: cleanedRevision, bulletStripped } = cleanDrawingNumber(
    raw.drawing_number,
    raw.revision
  );

  // Sanity-check: if the drawing number looks like a title sentence, null it out
  // and flag for review (this handles Gemini hallucinations where it confuses fields).
  const drawingNumber = looksLikeDrawingNumber(rawDrawingNumber) ? rawDrawingNumber : null;
  if (rawDrawingNumber && !drawingNumber) {
    flags.push("DRAWING_NUMBER_INVALID");
  }

  // Date normalisation
  const dateResult = normaliseDate(raw.revision_date);
  let revisionDate = dateResult.value;
  let dateConfidence = raw.confidence.revision_date;
  if (dateResult.flagged) {
    flags.push("DATE_FORMAT_UNKNOWN");
  }
  if (dateResult.confidence !== undefined) {
    dateConfidence = dateResult.confidence;
  }

  // REVISION DATE SOURCING — Priority hierarchy allows title-block fallback.
  // v2.1+ permits Gemini to source revision_date from a revision table first,
  // then revision-date-labelled title-block fields, then Drawn Date, then Plot Date
  // (each with descending confidence). The prior hard null rule is removed.
  // Downstream cross-validation still enforces textual evidence in elements.

  // Revision edge cases
  let revision = cleanedRevision;
  if (revision === "" || revision === null) {
    // Keep null — will be handled below
  }

  // Conflict detection
  if (raw.conflict_detected) {
    flags.push("REVISION_CONFLICT");
  }

  // Low confidence flags
  const confidences = {
    drawing_number: raw.confidence.drawing_number,
    drawing_title: raw.confidence.drawing_title,
    revision: raw.confidence.revision,
    revision_date: dateConfidence,
    status: raw.confidence.status,
  };

  const fieldLabels: Record<string, string> = {
    drawing_number: "DRAWING_NUMBER",
    drawing_title: "DRAWING_TITLE",
    revision: "REVISION",
    revision_date: "REVISION_DATE",
    status: "STATUS",
  };

  for (const [field, label] of Object.entries(fieldLabels)) {
    const conf = confidences[field as keyof typeof confidences];
    if (conf < confidenceThreshold) {
      flags.push(`LOW_CONFIDENCE_${label}`);
    }
  }

  // Null required fields
  if (!drawingNumber) flags.push("NEEDS_REVIEW");
  if (!revision && !revisionDate) flags.push("NEEDS_REVIEW");

  // Status normalisation
  const status = await normaliseStatus(raw.status);

  // ── Build per-field extraction rules audit trail ──────────────────
  // "source" is left undefined here — the extract route fills it in after
  // it knows whether crop / region / vision mode was used.
  const drawingNumberTransforms: string[] = [];
  if (bulletStripped) drawingNumberTransforms.push("bullet_suffix_stripped");

  const drawingTitleTransforms: string[] = [];
  const rawTitle = raw.drawing_title;
  if (rawTitle && /[\r\n]/.test(rawTitle)) drawingTitleTransforms.push("newlines_collapsed");

  const revisionTransforms: string[] = [];
  if (bulletStripped) revisionTransforms.push("revision_extracted_from_drawing_number");

  const revisionDateTransforms: string[] = [];
  const rawRevDate = raw.revision_date;
  if (rawRevDate && dateResult.format && dateResult.format !== "DD/MM/YYYY") {
    revisionDateTransforms.push("date_normalised");
  }

  const statusTransforms: string[] = [];
  const rawStatus = raw.status;
  const statusNormalised = status !== rawStatus && rawStatus != null;
  if (statusNormalised) statusTransforms.push("status_normalised");

  const extractionRules: ExtractionRules = {
    drawingNumber: {
      transforms: drawingNumberTransforms,
      validation: flags.includes("DRAWING_NUMBER_INVALID") ? "failed" : "passed",
      rawValue: raw.drawing_number ?? undefined,
    },
    drawingTitle: {
      transforms: drawingTitleTransforms,
      validation: "passed",
    },
    revision: {
      transforms: revisionTransforms,
      validation: flags.includes("REVISION_CONFLICT") ? "flagged" : "passed",
    },
    revisionDate: {
      transforms: revisionDateTransforms,
      validation: flags.includes("DATE_FORMAT_UNKNOWN") ? "flagged" : "passed",
      rawValue: rawRevDate ?? undefined,
      normalisedFormat: dateResult.format,
    },
    status: {
      transforms: statusTransforms,
      validation: "passed",
      rawValue: rawStatus ?? undefined,
      canonical: statusNormalised ? (status ?? undefined) : undefined,
    },
  };

  return {
    drawingNumber,
    drawingTitle: cleanDrawingTitle(raw.drawing_title),
    revision,
    revisionDate,
    status,
    location: raw.location ?? null,
    fieldCoordinates: raw.field_coordinates ?? null,
    confidenceDrawingNumber: raw.confidence.drawing_number,
    confidenceDrawingTitle: raw.confidence.drawing_title,
    confidenceRevision: raw.confidence.revision,
    confidenceRevisionDate: dateConfidence,
    confidenceStatus: raw.confidence.status,
    confidenceLocation: raw.confidence.location ?? 0,
    conflictDetected: raw.conflict_detected ?? false,
    conflictDetail: raw.conflict_detail ?? null,
    documentType: raw.document_type ?? "unknown",
    titleBlockLocation: raw.title_block_location ?? "unknown",
    revisionBlockLocation: raw.revision_block_location ?? "unknown",
    flags: [...new Set(flags)], // deduplicate
    notes: raw.notes ?? null,
    extractionRules,
  };
}
