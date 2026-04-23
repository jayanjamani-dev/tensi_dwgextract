import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Default construction document status mappings (seeded once on first load)
const DEFAULT_STATUS_MAPPINGS: Record<string, string> = {
  "for construction": "For Construction",
  "for construction (fc)": "For Construction",
  "fc": "For Construction",
  "issued for construction": "For Construction",
  "ifc": "For Construction",
  "for tender": "For Tender",
  "issued for tender": "For Tender",
  "ift": "For Tender",
  "for information": "For Information",
  "for info": "For Information",
  "fi": "For Information",
  "for coordination": "For Coordination",
  "for approval": "For Approval",
  "ifa": "For Approval",
  "approved": "Approved",
  "approved as noted": "Approved As Noted",
  "aan": "Approved As Noted",
  "revise and resubmit": "Revise and Resubmit",
  "r&r": "Revise and Resubmit",
  "preliminary": "Preliminary",
  "sketch design": "Sketch Design",
  "design development": "Design Development",
  "dd": "Design Development",
  "schematic design": "Schematic Design",
  "sd": "Schematic Design",
  "for planning": "For Planning",
  "draft": "Draft",
  "superseded": "Superseded",
  "void": "Void",
  "not for construction": "Not For Construction",
  "nfc": "Not For Construction",
};

// Default extraction rules — comprehensive PRD + system behaviour rules
export const DEFAULT_EXTRACTION_RULES = [
  { id: 1,  field: "Drawing Number", rule: "Source labels: Drawing No, Drawing Number, Drg No, Dwg No, Sheet No, Sheet Number, Drawing, DRG, Ref No" },
  { id: 2,  field: "Drawing Number", rule: "Accepted formats: free-form alphanumeric — ME001, A101, 3049-WD-A401, 1357-M1-2, 0.A000, 30776" },
  { id: 3,  field: "Drawing Number", rule: "Bullet suffix rule: if drawing number ends with •B, •C, etc. (bullet+letter), strip the suffix — it is the revision, not part of the drawing number" },
  { id: 4,  field: "Drawing Number", rule: "Never confuse project number or job number with drawing number — they are distinct fields" },
  { id: 5,  field: "Drawing Number", rule: "Flag LOW_CONFIDENCE_DRAWING_NUMBER when confidence is below the configured threshold (default 0.7)" },
  { id: 6,  field: "Drawing Number", rule: "Flag NEEDS_REVIEW when drawing number is null after extraction" },
  { id: 7,  field: "Drawing Title",  rule: "Source labels: Title, Drawing Title, Sheet Title, Description" },
  { id: 8,  field: "Drawing Title",  rule: "Multi-line titles must be combined into a single string" },
  { id: 9,  field: "Drawing Title",  rule: "Exclude project name and project address from the title value" },
  { id: 10, field: "Drawing Title",  rule: "Flag LOW_CONFIDENCE_DRAWING_TITLE when confidence is below the configured threshold" },
  { id: 11, field: "Revision",       rule: "PRIMARY SOURCE: revision block — most recent row sorted by date. Title block is FALLBACK only when revision block is absent or has no rows" },
  { id: 12, field: "Revision",       rule: "Conflict rule: if title block value ≠ revision block most recent row, ALWAYS use the revision block — it is the definitive source of truth" },
  { id: 13, field: "Revision",       rule: "Title block labels all treated as equivalent: Rev, Revision, Rev No, Revision No, Issue, Issue No, Iss, Current Issue, Current Rev" },
  { id: 14, field: "Revision",       rule: "Bullet suffix rule: if drawing number has a •B suffix, extract that suffix letter as the revision value" },
  { id: 15, field: "Revision",       rule: "If revision field shows '#' → return '#' exactly. This means first issue. Do NOT convert to null" },
  { id: 16, field: "Revision",       rule: "If revision field is blank or empty → return '-'" },
  { id: 17, field: "Revision",       rule: "'@A1', '@A0' are scale notations — never interpret as a revision value" },
  { id: 18, field: "Revision",       rule: "Accepted formats: single letter (A, B, C), letter+number (T1, P1, C5, BP7, TA1), numeric only (1, 2, 3)" },
  { id: 19, field: "Revision",       rule: "Set conflict_detected = true and flag REVISION_CONFLICT when title block revision ≠ revision block most recent row" },
  { id: 20, field: "Revision",       rule: "Flag LOW_CONFIDENCE_REVISION when confidence is below the configured threshold" },
  { id: 21, field: "Revision Date",  rule: "SOURCE — ABSOLUTE: revision date must be extracted EXCLUSIVELY from the revision block. No exceptions whatsoever" },
  { id: 22, field: "Revision Date",  rule: "Use the date column from the most recent revision row — the same row identified as the current revision" },
  { id: 23, field: "Revision Date",  rule: "TITLE BLOCK BAN — CRITICAL: No date from the title block may ever be mapped to revision_date. Fields labelled Date, Date Drawn, Issue Date, Date of Issue, Date Prepared, or Revision Date in the title block are categorically prohibited" },
  { id: 24, field: "Revision Date",  rule: "If revision block is absent, has no rows, or date column is blank → return null. Do not substitute a date from anywhere else" },
  { id: 25, field: "Revision Date",  rule: "System forces null when revision_block_location is 'none'; sets flag REVISION_DATE_NULLED_NO_REV_BLOCK" },
  { id: 26, field: "Revision Date",  rule: "Normalise DD/MM/YYYY → return as-is (zero-pad day and month)" },
  { id: 27, field: "Revision Date",  rule: "Normalise DD/MM/YY → DD/MM/20YY (always assume 2000s for two-digit years)" },
  { id: 28, field: "Revision Date",  rule: "Normalise DD.MM.YY or DD.MM.YYYY → convert dot separators to slashes" },
  { id: 29, field: "Revision Date",  rule: "Normalise DD-MM-YYYY or DD-MM-YY → convert dash separators to slashes" },
  { id: 30, field: "Revision Date",  rule: "Normalise YYYY-MM-DD (ISO 8601) → reformat to DD/MM/YYYY" },
  { id: 31, field: "Revision Date",  rule: "Normalise DD/MM only (no year) → return as-is, set confidence to 0.6" },
  { id: 32, field: "Revision Date",  rule: "Normalise Month YY format (e.g. 'Nov 25') → convert to 01/MM/YYYY, set confidence to 0.7" },
  { id: 33, field: "Revision Date",  rule: "Flag DATE_FORMAT_UNKNOWN when date string cannot be parsed; return stripped numeric data at confidence 0.4" },
  { id: 34, field: "Revision Date",  rule: "Flag LOW_CONFIDENCE_REVISION_DATE when confidence is below the configured threshold" },
  { id: 35, field: "Status",         rule: "PRIMARY SOURCE: revision block — use status from the most recent/highest revision entry in chronological order" },
  { id: 36, field: "Status",         rule: "FALLBACK: title block — only if revision block is entirely empty or absent" },
  { id: 37, field: "Status",         rule: "Never guess — return null if no explicit status is found anywhere" },
  { id: 38, field: "Status",         rule: "Known vocabulary: Preliminary Issue, Tender Issue, For Tender, Tender Documentation, Construction Issue, Issued for Construction, For Construction, For Pricing, Not for Construction, For Building Approval, BPA, For Review, For Comment, Coordination Issue, Design Development, Superseded, Cancelled, Void" },
  { id: 39, field: "Status",         rule: "Status stamps outside the title block are valid if they are large bold text: PRELIMINARY, ISSUED FOR CONSTRUCTION, TENDER ISSUE, FOR PRICING, NOT FOR CONSTRUCTION" },
  { id: 40, field: "Status",         rule: "Ignore noise — not status values: 'THIS IS NOT AN INSTALLATION DOCUMENT', 'TO BE PRINTED IN COLOUR', 'DO NOT SCALE', 'COPYRIGHT', 'MUST NOT BE COPIED', scale references containing '@A'" },
  { id: 41, field: "Status",         rule: "STATUS_NORMALISATION rule applies after extraction: raw string is mapped to canonical value via the normalisation matrix (case-insensitive)" },
  { id: 42, field: "Status",         rule: "Flag LOW_CONFIDENCE_STATUS when confidence is below the configured threshold" },
  { id: 43, field: "Location",       rule: "Extract site address, project address, or building location" },
  { id: 44, field: "Location",       rule: "Source labels: Project Address, Site Address, Address, Location, Project Location, Site, Property" },
  { id: 45, field: "Location",       rule: "Format: physical street address or suburb/site name (e.g. '123 Main Street, Sydney NSW 2000')" },
  { id: 46, field: "Location",       rule: "Exclusions: do not extract project name, project number, client name, or architect address" },
  { id: 47, field: "Location",       rule: "Return null if no address found — location is not required (does not trigger NEEDS_REVIEW flag)" },
  { id: 48, field: "Coordinates",    rule: "Return {x, y} pixel position of the text element where each field value was found" },
  { id: 49, field: "Coordinates",    rule: "All coordinates are relative to full page dimensions — not to any crop region" },
  { id: 50, field: "Coordinates",    rule: "Return null coordinate when the corresponding field is null or not found" },
  { id: 51, field: "All Fields",     rule: "Confidence scale: 1.0 = clear label + unambiguous value; 0.8 = minor ambiguity; 0.6 = inferred without explicit label; 0.4 = best guess; 0.0 = null field" },
  { id: 52, field: "All Fields",     rule: "Default confidence threshold: 0.7 (configurable via CONFIDENCE_THRESHOLD env var). Fields below threshold receive a LOW_CONFIDENCE flag" },
  { id: 53, field: "All Fields",     rule: "Never use as values: @A0/A1/A2/A3 scale notations, 'REMIT VERSION' + year (file version), north point labels, grid references, ABN/ACN numbers, phone numbers, email addresses" },
  { id: 54, field: "All Fields",     rule: "Manual BBox override: if an architect has a learned bounding box for a field, that override replaces Gemini extraction at confidence 1.0; flag BBOX_OVERRIDE_{FIELD}" },
  { id: 55, field: "All Fields",     rule: "Flag NEEDS_REVIEW when drawing number is null, OR when both revision AND revision date are null" },
  { id: 56, field: "All Fields",     rule: "Bulk correction: editing a field triggers a check for matching drawings across the project or globally per architect, offering batch application" },
  { id: 57, field: "All Fields",     rule: "Cover sheet documents (Drawing Index, Drawing Register, Table of Contents) skip field extraction and are flagged as document_type='cover_sheet'" },
  { id: 58, field: "All Fields",     rule: "Scanned PDFs with zero text layer elements automatically trigger Vision API fallback; flag VISION_FALLBACK. If image rendering fails, flag VISION_RENDER_FAILED" },
  { id: 59, field: "All Fields",     rule: "Gemini input capped at 500 elements sorted by font size descending to prioritise title block labels; flag INPUT_TRUNCATED if truncation occurs" },
  { id: 60, field: "All Fields",     rule: "Return JSON only — no markdown, no preamble. If a field cannot be found, return null rather than guessing or fabricating a value" },
];

export async function GET() {
  try {
    // Auto-seed STATUS_NORMALISATION if it doesn't exist yet
    const existingStatus = await prisma.systemRule.findUnique({ where: { ruleType: "STATUS_NORMALISATION" } });
    if (!existingStatus) {
      await prisma.systemRule.create({
        data: {
          ruleType: "STATUS_NORMALISATION",
          content: JSON.stringify(DEFAULT_STATUS_MAPPINGS),
          description: "Maps raw extracted status strings to canonical values (case-insensitive key matching)",
        },
      });
    }

    // Auto-seed EXTRACTION_RULES if they don't exist yet
    const existingExtraction = await prisma.systemRule.findUnique({ where: { ruleType: "EXTRACTION_RULES" } });
    if (!existingExtraction) {
      await prisma.systemRule.create({
        data: {
          ruleType: "EXTRACTION_RULES",
          content: JSON.stringify(DEFAULT_EXTRACTION_RULES),
          description: "Full extraction and business logic rules per field — editable in System Rules tab",
        },
      });
    }

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

    // Extract extraction rules for the UI
    const extractionRulesRecord = systemRules.find(r => r.ruleType === "EXTRACTION_RULES");
    let extractionRules = DEFAULT_EXTRACTION_RULES;
    if (extractionRulesRecord) {
      try { extractionRules = JSON.parse(extractionRulesRecord.content); } catch {}
    }

    return NextResponse.json({
      systemRules,
      learnedVocabulary,
      learnedPatterns,
      extractionRules,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
