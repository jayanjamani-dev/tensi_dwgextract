import { GoogleGenerativeAI } from "@google/generative-ai";
import { TextElement } from "./pdfplumber";
import { GeminiUsage, GeminiCallMetrics, calculateCost } from "./api-metrics";
import { generateTerminologyPromptContext } from "./terminology";

export interface FieldCoordinate {
  x: number;
  y: number;
}

export interface GeminiExtractionResult {
  drawing_number: string | null;
  drawing_title: string | null;
  revision: string | null;
  revision_date: string | null;
  status: string | null;
  location: string | null;
  confidence: {
    drawing_number: number;
    drawing_title: number;
    revision: number;
    revision_date: number;
    status: number;
    location: number;
  };
  field_coordinates: {
    drawing_number: FieldCoordinate | null;
    drawing_title: FieldCoordinate | null;
    revision: FieldCoordinate | null;
    revision_date: FieldCoordinate | null;
    status: FieldCoordinate | null;
    location: FieldCoordinate | null;
  };
  conflict_detected: boolean;
  conflict_detail: string | null;
  document_type: "drawing" | "cover_sheet" | "specification" | "unknown";
  title_block_location: "bottom" | "bottom-right" | "right" | "left" | "unknown";
  revision_block_location: "top-left" | "left-of-title-block" | "integrated" | "none" | "unknown";
  notes: string | null;
}

export interface GeminiExtractionResponse {
  result: GeminiExtractionResult;
  metrics: GeminiCallMetrics;
}

const SYSTEM_PROMPT = `You are a construction drawing metadata extraction engine for an Australian document management platform called Tensi.

You will receive a JSON array of text elements extracted from a construction drawing PDF. Each element has:
- "text": the string content
- "x": horizontal position on the page (pixels from left)
- "y": vertical position on the page (pixels from top)
- "size": font size (larger = more prominent)
- "page_width": total page width in pixels
- "page_height": total page height in pixels

Your job is to extract exactly six fields from this drawing:
1. drawing_number
2. drawing_title
3. revision
4. revision_date
5. status
6. location

---

UNDERSTANDING THE DRAWING LAYOUT

Construction drawings have two key areas:

TITLE BLOCK: A bordered rectangular area — usually at the bottom, right side, or left side of the page. Contains fields like Drawing Number, Drawing Title, Project, Scale, Date, Drawn By, and current Revision. Use x/y coordinates to identify this cluster.

REVISION BLOCK: A separate table showing the history of all revisions issued for this drawing. May appear in the top-left corner, far left of the title block, or integrated into the title block. Contains one row per revision issued, with columns such as: Rev/Issue, Description/Amendment, Date, and optionally By/Initials. Column order varies — always read the header row first.

STATUS STAMP: A large bold text block that may appear anywhere on the page — often top-right or top-centre. Common values: PRELIMINARY, ISSUED FOR CONSTRUCTION, CONSTRUCTION ISSUE, TENDER ISSUE, FOR PRICING, NOT FOR CONSTRUCTION. These are valid status values even when they appear outside the title block. Identify them by their large font size relative to other text.

---

EXTRACTION RULES

DRAWING NUMBER
- Find the value associated with labels: Drawing No, Drawing Number, Drg No, Dwg No, Sheet No, Sheet Number, Drawing, DRG, Ref No
- Format varies: ME001, A101, 3049-WD-A401, 1357-M1-2, 0.A000, 30776
- If the drawing number ends with •B, •C or similar bullet+letter suffix, SEPARATE the suffix — it is the revision, not part of the drawing number. Return the clean number without the suffix.
- Do not confuse project number / job number with drawing number

DRAWING TITLE
- Find the value associated with labels: Title, Drawing Title, Sheet Title, Description
- May span multiple lines — combine into a single string
- Do not include project name or address in the title

REVISION
- This is the CURRENT revision — the most recent one issued
- Check BOTH the title block AND the revision block:
  TITLE BLOCK: Look for a field labelled: Rev, Revision, Rev No, Revision No, Issue, Issue No, Iss, Current Issue, Current Rev
  These all refer to the same field. Treat them as equivalent.
  REVISION BLOCK: Find the table with revision history. Read ALL rows. Determine the most recent row by DATE (do not assume top or bottom is latest — sort by date). The most recent row by date is the current revision.
- If title block and revision block disagree, ALWAYS take the revision block's most recent row — it is the source of truth
- If drawing number has a bullet suffix (e.g. A000•B), extract the suffix letter as the revision
- Revision formats: single letter (A, B, C), letter+number (T1, P1, C5, BP7, TA1), number only (1, 2, 3)
- If revision field shows "#" → return "#" exactly. This means first issue, no revision letter assigned yet. Do NOT convert to null.
- If revision field is completely blank or empty → return "-"
- "@A1" is a SCALE reference — never interpret this as a revision

REVISION DATE
- Extract the date from the MOST RECENT revision row (same row as the current revision identified above)
- Normalise ALL date formats to DD/MM/YYYY:
  DD/MM/YY → add century (assume 2000s)
  DD.MM.YY → convert separators
  DD/MM only (no year) → return as-is and set confidence to 0.6
  Month YY format (e.g. "Nov 25") → convert to 01/11/2025 and set confidence to 0.7
  Full text date → parse and convert
- Do not use the title block's general "Date" or "Date Drawn" field — that is the original drawing date, not the revision date

STATUS
- RULES FOR EXTRACTING 'STATUS':
  1. ALWAYS search the revision block FIRST. Identify the MOST RECENT/HIGHEST revision entry in chronological order (whether numeric like '02' or alphanumeric like 'C'). 
  2. Use the status explicitly associated with that highest revision entry (e.g. 'FOR CONSTRUCTION', 'TENDER').
  3. Only if the revision block is entirely empty or missing, fall back to extracting the status or 'purpose of issue' from the main title block. 
  4. Do not guess. If no explicit status is found anywhere, return null.
- Known status vocabulary to match against:
  Preliminary Issue, Preliminary, Tender Issue, For Tender, Tender Documentation, Tender Review,
  Construction Issue, Issued for Construction, For Construction,
  For Pricing, Not for Construction, For Building Approval, BPA,
  For Review, For Comment, Coordination Issue, Design Development,
  Superseded, Cancelled, Void
- IGNORE these — they look like status but are NOT:
  "THIS IS NOT AN INSTALLATION DOCUMENT"
  "TO BE PRINTED IN COLOUR"
  "DO NOT SCALE"
  "COPYRIGHT" text
  Any text containing "MUST NOT BE COPIED"
  Scale references containing "@A"

LOCATION
- Extract the site address, project address, or building location for this drawing
- Look for labels: Project Address, Site Address, Address, Location, Project Location, Site, Property
- This is a physical street address or suburb/site name — e.g. "123 Main Street, Sydney NSW 2000" or "Corner of Park & King St, Melbourne"
- Do NOT extract: project name, project number, client name, or architect address
- If no address is found, return null

CRITICAL: NEVER USE THESE AS FIELD VALUES
- @A1, @A0, @A3, @A2 → these are scale notations
- "REMIT VERSION" followed by a year → this is a file version, not a revision
- North point labels, compass bearings
- Grid reference letters/numbers at page borders
- ABN numbers, ACN numbers
- Phone numbers, email addresses, street addresses

---

RETURNING RESULTS

Return ONLY valid JSON. No markdown, no preamble, no explanation.

If a field cannot be found, return null — do not guess or fabricate.

Return confidence as 0.0–1.0 for each field:
- 1.0 = found with clear label and unambiguous value
- 0.8 = found with label but minor ambiguity
- 0.6 = inferred from context without explicit label
- 0.4 = best guess, low confidence
- null fields should have confidence 0.0

Set conflict_detected to true if title block revision ≠ revision block most recent revision.

For field_coordinates: for each field, return the {x, y} pixel position of the text element where you found the value. Use the x/y from the input element array. If a field is null or not found, set its coordinate to null.

{
  "drawing_number": "string | null",
  "drawing_title": "string | null",
  "revision": "string | null",
  "revision_date": "string | null",
  "status": "string | null",
  "location": "string | null",
  "confidence": {
    "drawing_number": 0.0,
    "drawing_title": 0.0,
    "revision": 0.0,
    "revision_date": 0.0,
    "status": 0.0,
    "location": 0.0
  },
  "field_coordinates": {
    "drawing_number": {"x": 0, "y": 0},
    "drawing_title": {"x": 0, "y": 0},
    "revision": {"x": 0, "y": 0},
    "revision_date": {"x": 0, "y": 0},
    "status": {"x": 0, "y": 0},
    "location": {"x": 0, "y": 0}
  },
  "conflict_detected": false,
  "conflict_detail": "string | null",
  "document_type": "drawing | cover_sheet | specification | unknown",
  "title_block_location": "bottom | bottom-right | right | left | unknown",
  "revision_block_location": "top-left | left-of-title-block | integrated | none | unknown",
  "notes": "string | null"
}

{{TERMINOLOGY_CONTEXT}}

{{TEMPLATE_CONTEXT}}`;

function buildPrompt(templateContext: string): string {
  const terminology = generateTerminologyPromptContext();
  return SYSTEM_PROMPT
    .replace("{{TERMINOLOGY_CONTEXT}}", terminology)
    .replace("{{TEMPLATE_CONTEXT}}", templateContext);
}

function extractUsage(response: { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number } }): GeminiUsage {
  const meta = response.usageMetadata ?? {};
  const inputTokens    = meta.promptTokenCount      ?? 0;
  const thinkingTokens = meta.thoughtsTokenCount    ?? 0;
  const outputTokens   = Math.max(0, (meta.candidatesTokenCount ?? 0) - thinkingTokens);
  const totalTokens    = meta.totalTokenCount        ?? (inputTokens + outputTokens + thinkingTokens);
  return { inputTokens, outputTokens, thinkingTokens, totalTokens };
}

export async function extractWithGemini(
  elements: TextElement[],
  templateContext: string = ""
): Promise<GeminiExtractionResponse> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY not set");

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({
    model,
    systemInstruction: buildPrompt(templateContext),
  });

  const userMessage = JSON.stringify(elements, null, 2);
  let retryCount = 0;
  const t0 = Date.now();

  const result = await geminiModel.generateContent(userMessage);
  const text = result.response.text().trim();
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as GeminiExtractionResult;
    const usage = extractUsage(result.response);
    const latencyMs = Date.now() - t0;
    const costUsd = calculateCost(usage);
    return {
      result: parsed,
      metrics: { usage, latencyMs, costUsd, retryCount, success: true },
    };
  } catch {
    // Retry once with explicit instruction
    retryCount = 1;
    const retryResult = await geminiModel.generateContent(
      `${userMessage}\n\nIMPORTANT: Return ONLY a valid JSON object. No markdown, no backticks, no explanation. Start your response with { and end with }`
    );
    const retryText = retryResult.response.text().trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    const latencyMs = Date.now() - t0;

    // Accumulate usage across both calls
    const usage1 = extractUsage(result.response);
    const usage2 = extractUsage(retryResult.response);
    const usage: GeminiUsage = {
      inputTokens:    usage1.inputTokens    + usage2.inputTokens,
      outputTokens:   usage1.outputTokens   + usage2.outputTokens,
      thinkingTokens: usage1.thinkingTokens + usage2.thinkingTokens,
      totalTokens:    usage1.totalTokens    + usage2.totalTokens,
    };
    const costUsd = calculateCost(usage);

    try {
      const parsed = JSON.parse(retryText) as GeminiExtractionResult;
      return {
        result: parsed,
        metrics: { usage, latencyMs, costUsd, retryCount, success: true },
      };
    } catch {
      const errorMessage = `Gemini returned unparseable JSON: ${text.slice(0, 300)}`;
      throw Object.assign(new Error(errorMessage), {
        metrics: { usage, latencyMs, costUsd, retryCount, success: false, errorMessage },
      });
    }
  }
}
