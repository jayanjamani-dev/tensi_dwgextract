import { GeminiExtractionResult, FieldCoordinate } from "./gemini";

export interface FieldCoordinates {
  drawing_number: FieldCoordinate | null;
  drawing_title: FieldCoordinate | null;
  revision: FieldCoordinate | null;
  revision_date: FieldCoordinate | null;
  status: FieldCoordinate | null;
  location: FieldCoordinate | null;
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
  conflictDetected: boolean;
  conflictDetail: string | null;
  documentType: string;
  titleBlockLocation: string;
  revisionBlockLocation: string;
  flags: string[];
  notes: string | null;
}

const STATUS_NORMALISATION: Record<string, string> = {
  "preliminary issue": "Preliminary Issue",
  "preliminary": "Preliminary Issue",
  "prelim": "Preliminary Issue",
  "tender issue": "Tender Issue",
  "for tender": "Tender Issue",
  "tender documentation": "Tender Issue",
  "tender review": "Tender Issue",
  "construction issue": "Construction Issue",
  "issued for construction": "Construction Issue",
  "for construction": "Construction Issue",
  "construction": "Construction Issue",
  "for pricing": "For Pricing",
  "not for construction": "Not for Construction",
  "for building approval": "For Building Approval",
  "bpa": "For Building Approval",
  "building permit issue": "For Building Approval",
  "for review": "For Review",
  "for comment": "For Review",
  "coordination issue": "Coordination Issue",
  "design development": "Design Development",
  "superseded": "Superseded",
  "cancelled": "Cancelled",
  "void": "Cancelled",
  "drawing issue": "Construction Issue",
};

function normaliseStatus(raw: string | null): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  return STATUS_NORMALISATION[key] ?? raw;
}

function normaliseDate(raw: string | null): { value: string | null; confidence?: number; flagged: boolean } {
  if (!raw) return { value: null, flagged: false };

  const cleaned = raw.trim().replace(/_/g, "-").replace(/\\/g, "/");

  // Already DD/MM/YYYY
  if (/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.test(cleaned)) {
    const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return { value: `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`, flagged: false };
  }

  // DD/MM/YY → assume 2000s
  const dmyShort = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (dmyShort) return { value: `${dmyShort[1].padStart(2, "0")}/${dmyShort[2].padStart(2, "0")}/20${dmyShort[3]}`, flagged: false };

  // DD.MM.YY or DD.MM.YYYY
  const dotFormat = cleaned.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotFormat) {
    const year = dotFormat[3].length === 2 ? `20${dotFormat[3]}` : dotFormat[3];
    return { value: `${dotFormat[1].padStart(2, "0")}/${dotFormat[2].padStart(2, "0")}/${year}`, flagged: false };
  }

  // DD-MM-YYYY or DD-MM-YY
  const dashFormat = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dashFormat) {
    const year = dashFormat[3].length === 2 ? `20${dashFormat[3]}` : dashFormat[3];
    return { value: `${dashFormat[1].padStart(2, "0")}/${dashFormat[2].padStart(2, "0")}/${year}`, flagged: false };
  }

  // YYYY-MM-DD or YYYY.MM.DD or YYYY/MM/DD
  const isoFormat = cleaned.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (isoFormat) {
    return { value: `${isoFormat[3].padStart(2, "0")}/${isoFormat[2].padStart(2, "0")}/${isoFormat[1]}`, flagged: false };
  }

  // DD/MM only (no year)
  if (/^(\d{1,2})\/(\d{1,2})$/.test(cleaned)) {
    const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) return { value: `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}`, confidence: 0.6, flagged: false };
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
      return { value: `01/${mm}/${year}`, confidence: 0.7, flagged: false };
    }
  }

  // Full month name + day + year (e.g. "January 15, 2025")
  const fullDate = new Date(cleaned);
  if (!isNaN(fullDate.getTime())) {
    const dd = String(fullDate.getDate()).padStart(2, "0");
    const mm = String(fullDate.getMonth() + 1).padStart(2, "0");
    const yyyy = fullDate.getFullYear();
    return { value: `${dd}/${mm}/${yyyy}`, flagged: false };
  }

  // Unparseable — strip alpha characters to get base date, but flag it
  const numericData = cleaned.replace(/[^0-9/.-]/g, "");
  if (numericData.length >= 6) {
    return { value: numericData, confidence: 0.4, flagged: true };
  }

  return { value: cleaned, flagged: true };
}

function cleanDrawingNumber(
  drawingNumber: string | null,
  revision: string | null
): { drawingNumber: string | null; revision: string | null } {
  if (!drawingNumber) return { drawingNumber, revision };

  // Strip bullet suffix (e.g. A000•B → A000, revision: B)
  const bulletMatch = drawingNumber.match(/^(.+)[•·]([A-Z]\d*)$/);
  if (bulletMatch) {
    return {
      drawingNumber: bulletMatch[1].trim(),
      revision: revision || bulletMatch[2],
    };
  }

  return { drawingNumber: drawingNumber.trim(), revision };
}

export function validateExtraction(
  raw: GeminiExtractionResult,
  confidenceThreshold: number = 0.7
): ValidationResult {
  const flags: string[] = [];

  // Drawing number cleanup
  const { drawingNumber, revision: cleanedRevision } = cleanDrawingNumber(
    raw.drawing_number,
    raw.revision
  );

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
  const status = normaliseStatus(raw.status);

  return {
    drawingNumber,
    drawingTitle: raw.drawing_title,
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
    conflictDetected: raw.conflict_detected ?? false,
    conflictDetail: raw.conflict_detail ?? null,
    documentType: raw.document_type ?? "unknown",
    titleBlockLocation: raw.title_block_location ?? "unknown",
    revisionBlockLocation: raw.revision_block_location ?? "unknown",
    flags: [...new Set(flags)], // deduplicate
    notes: raw.notes ?? null,
  };
}
