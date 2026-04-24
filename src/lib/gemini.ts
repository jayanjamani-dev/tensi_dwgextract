import { GoogleGenerativeAI } from "@google/generative-ai";
import { TextElement } from "./pdfplumber";
import { GeminiUsage, GeminiCallMetrics, calculateCost } from "./api-metrics";
import { generateTerminologyPromptContext } from "./terminology";

export interface FieldCoordinate {
  x: number;
  y: number;
}

/** A single row from a drawing register table extracted from a cover sheet. */
export interface DrawingRegisterEntry {
  drawing_number: string | null;
  drawing_title: string | null;
  revision: string | null;
  revision_date: string | null;
  status: string | null;
}

export interface GeminiExtractionResult {
  drawing_number: string | null;
  drawing_title: string | null;
  revision: string | null;
  revision_date: string | null;
  status: string | null;
  location: string | null;
  architect_firm_name: string | null;
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
  /**
   * Extracted drawing register when a drawing list table is present on the page.
   * Always extracted in addition to the five standard fields — never replaces them.
   */
  drawing_register: DrawingRegisterEntry[] | null;
}

export interface GeminiExtractionResponse {
  result: GeminiExtractionResult;
  metrics: GeminiCallMetrics;
  /** True when the elements array was truncated before sending to stay under the token limit. */
  inputTruncated?: boolean;
}

// ── Input sizing ───────────────────────────────────────────────────────────

/**
 * Maximum elements sent to Gemini. Title blocks never need more than this —
 * excess comes from dense body text (notes, schedules) captured in the region.
 * We sort by font size descending so labels and values survive truncation.
 */
const MAX_ELEMENTS = 500;

/**
 * Maximum JSON character length for the user message (~250K tokens with 2-space
 * indentation). Gemini 2.5 Flash allows 1M input tokens; we cap at ~25% to
 * leave headroom for the system prompt (~6K tokens).
 */
const MAX_INPUT_CHARS = 1_000_000;

/**
 * Strip fields only used by the in-memory bbox filter (x1, bottom, region).
 * These are noise for Gemini and meaningfully inflate payload size.
 */
function stripInternalFields(
  elements: TextElement[]
): Array<Pick<TextElement, "text" | "x" | "y" | "size" | "page_width" | "page_height">> {
  return elements.map(({ text, x, y, size, page_width, page_height }) => ({
    text, x, y, size, page_width, page_height,
  }));
}

/**
 * Prepare elements for Gemini: strip internal fields, sort by font size
 * descending, cap at MAX_ELEMENTS, then guard on total JSON size.
 * Returns the capped array and whether any truncation occurred.
 */
function capElements(elements: TextElement[]): {
  stripped: ReturnType<typeof stripInternalFields>;
  truncated: boolean;
} {
  // Sort by font size descending — field labels/values are larger than body text
  const sorted = [...elements].sort((a, b) => b.size - a.size);
  let truncated = sorted.length > MAX_ELEMENTS;
  let working = truncated ? sorted.slice(0, MAX_ELEMENTS) : sorted;

  let stripped = stripInternalFields(working);

  // Secondary guard: JSON byte length
  let json = JSON.stringify(stripped, null, 2);
  while (json.length > MAX_INPUT_CHARS && stripped.length > 30) {
    stripped = stripped.slice(0, Math.floor(stripped.length * 0.75));
    json = JSON.stringify(stripped, null, 2);
    truncated = true;
  }

  return { stripped, truncated };
}

/** True when a Gemini error is a 400 token-limit rejection (not a transient failure). */
function isTokenLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("400") && msg.toLowerCase().includes("token");
}

/** True when the 429 error is a daily/project quota exhaustion (not retryable). */
function isDailyQuotaExhausted(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err));
  return msg.includes("429") && (
    msg.includes("free_tier") ||
    msg.includes("FreeTier") ||
    msg.includes("PerDay") ||
    msg.includes("per_day") ||
    msg.includes("daily") ||
    msg.includes("quota exceeded") ||
    msg.toLowerCase().includes("you exceeded your current quota")
  );
}

/** True when a Gemini error is a transient server/capacity issue worth retrying. */
function isRetryableServerError(err: unknown): boolean {
  // Daily quota exhaustion is permanent for the day — never retry it.
  if (isDailyQuotaExhausted(err)) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("overloaded") ||
    msg.includes("service unavailable") ||
    msg.includes("high demand") ||
    msg.includes("temporarily") ||
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound")
  );
}

/** Sleep for N milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap a Gemini generateContent call with exponential-backoff retry for
 * transient server errors (503 overloaded, 429 rate-limited, network blips).
 * Non-retryable errors (400 token limits, 401/403 auth) propagate immediately.
 *
 * Schedule: 2s → 5s → 12s (with ±20% jitter). Max 3 retries (4 attempts total).
 * Returns {result, serverRetries} so callers can record the retry count.
 */
async function generateContentWithRetry<T>(
  fn: () => Promise<T>,
  label: string
): Promise<{ result: T; serverRetries: number }> {
  const delays = [2000, 5000, 12000]; // ms
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const result = await fn();
      return { result, serverRetries: attempt };
    } catch (err) {
      lastErr = err;
      if (!isRetryableServerError(err)) throw err;
      if (attempt === delays.length) break; // out of retries
      const base = delays[attempt];
      const jitter = base * (0.8 + Math.random() * 0.4); // ±20%
      console.warn(
        `[gemini:${label}] ${(err as Error).message?.slice(0, 100)} — retrying in ${Math.round(jitter)}ms (attempt ${attempt + 1}/${delays.length})`
      );
      await sleep(jitter);
    }
  }
  throw lastErr;
}

const SYSTEM_PROMPT = `You are a construction drawing metadata extraction engine for an
Australian document management platform called Tensi.

You will receive a JSON array of text elements extracted from a
construction drawing PDF. Each element has:
- "text": the string content
- "x": horizontal position (pixels from left)
- "y": vertical position (pixels from top)
- "size": font size (larger = more prominent)
- "page_width": total page width in pixels
- "page_height": total page height in pixels

Extract exactly five fields from this drawing.

UNDERSTANDING THE DRAWING LAYOUT
_________________________________

TITLE BLOCK: A bordered area containing drawing metadata. May be at
the bottom, right side, or left side of the page. Contains: Drawing
Number, Drawing Title, Revision, Scale, Project, Firm details.

REVISION BLOCK: A table showing the history of all revisions issued.
May appear: top-left corner, far left of title block, integrated into
title block, top of vertical title block, right side of title block.
Column order ALWAYS varies – read the header row first. Never assume
column order. Known column orders include:
- REV / DATE / DESCRIPTION / CHK
- DATE / REV / DESCRIPTION / CHK ← date comes FIRST in some firms
- ISSUE / DESCRIPTION / DATE
- REV / DATE / REVISION / BY / CHK ← "NO" means revision number
- REVISION / ISSUE ← two separate columns, both needed
- AMENDMENTS / DATE / APPROVED ← AMENDMENTS = description

STATUS STAMP: Large bold text anywhere on the page. May appear:
top-right, top-centre, left margin (vertically oriented), or inside
title block as a dedicated field. Identify by large font size and
status vocabulary match. May also be in a field labelled: Status,
Drawing Status, Issued For, Project Stage, Work Stage, Phase,
Reason for Issue.

FIELD EXTRACTION RULES
______________________

DRAWING NUMBER
Labels: Drawing No, Drawing Number, Drg No, Dwg No, Sheet No,
Sheet Number, Drawing, DRG, Ref No, Drawing #, DWG NO, DWG.
Do not confuse with Project Number, Job Number, or Reference Number.
Formats: ME001, A101, 3049-WD-A401, 0.A000, VAS24048-M315,
0101020-GHDD-00-DRG-AR-00100, E.000502, 12112.B00, a/a008,
S002 (combined with sheet field), E2 (from "E2 OF 7").
Note: "X OF Y" format – extract only the base number before "OF".
Note: Drawing numbers may be lowercase (e.g. a/a008, c02).

DRAWING TITLE
Labels: Title, Drawing Title, Sheet Title, Description,
Title of Drawing, Drawing.
The drawing title is the drawing-specific label only. It typically consists
of a series label (e.g. "A03 GA PLANS") on one line and a specific title
(e.g. "Level 04 General Arrangement Plan") on the next — include BOTH lines.
Combine multiple lines into a single string, preserving top-to-bottom
reading order (topmost line first). Do not reorder or reverse lines.
NEVER include: project name, client name, address, or any building/site
header that appears ABOVE the drawing-specific title in the title block.
Street addresses (e.g. "280 LITTLE COLLINS ST"), client/company names
(e.g. "Omnicom Fitout", "ABC Corp"), and project descriptions must NEVER
appear in drawing_title. If the title block shows a project header above
the drawing title, ignore it completely.

REVISION
This is the CURRENT revision – the most recent one issued.

Step 1 – Check REVISION BLOCK first (source of truth):
- Read ALL rows with their dates
- Sort rows by DATE to find most recent – never trust row position
- The revision code from the most recent row by date is current
- Column order varies – always read headers first
- If table has REVISION + ISSUE columns, use REVISION column value

Step 2 – Cross-check TITLE BLOCK:
Labels: Rev, Revision, Rev No, Revision No, Issue, Issue No,
Iss, Issue, Current Rev – ALL mean the same field
If title block and revision block disagree → take revision block
Log disagreement in conflict_detail

Step 3 – Special cases:
"#" → return "#" exactly (first issue, no letter assigned)
"*", "-", blank present but empty → return "-"
Revision block present but empty → return "-"
Numeric revisions 0, 1, 2, 4 are valid – return as-is
Non-standard codes IA1, IA1, BP7, A0, amend are valid – return as-is
Revision embedded in drawing title text → extract the revision value
"@A1" → SCALE reference – never a revision
Status field content → NOT a revision

REVISION DATE
Follow this priority hierarchy strictly. Do not skip priorities.

PART A — UNDERSTANDING THE REVISION TABLE

A1. Identify the Table Header
The revision table header row contains labels matching revision date
terminology (Priority 2 label list below). Use terminology matching —
do not assume a fixed row position.

A2. Determine Table Orientation
- Header at top → latest revision is the BOTTOM row
- Header at bottom → latest revision is the TOP row

A3. Identify the Latest Revision Row
Do NOT rely on row position alone. Find the row with the HIGHEST
revision identifier in the sequence:
- Numeric (0, 1, 2, 3) → highest number
- Zero-padded numeric (00, 01, 02) → highest number
- Alpha (A, B, C, D) → latest letter
- Mixed → use the row with the most recent date if dates are present.
  If no dates, take the last non-empty row with a revision identifier.
Validate using chronological date progression:
- If dates increase logically → confirm candidate row
- If inconsistent → select the most recent valid date from the table

A4. Same-Row Rule — CRITICAL
Revision Date must ALWAYS come from the same row as the latest
Revision Number. Never combine values from different rows. Never
apply proximity logic inside the revision table.

PART B — PRIORITY HIERARCHY

PRIORITY 1 — Revision Table
Condition: Revision table exists AND latest row contains a valid date.
Action:    Extract from same row as latest Revision Number.
Confidence: 0.95-1.00

If the latest row has no date (it is a raster graphic or blank) → move to Priority 2.

CRITICAL RULE — Revision table present but dates are raster:
If you can read the revision number from a revision table but CANNOT read
the corresponding date (it is a graphic/image element with no text layer),
DO NOT use any other date from the title block as the revision date.
Return null for revision_date. The revision number from the table is valid;
the date must also come from the same table — never substitute a standalone
title block "DATE:", "DRAWN:", or similar field when the revision table's
date column is unreadable. This prevents confusing the drawing creation date
with the revision date.

PRIORITY 2 — Title Block Revision Date Label + Proximity Search
Condition: Revision table is confirmed absent (not just unreadable dates).
Action:    Search title block for a revision date label. Apply
           directional proximity search to find the date value.

Step 1 — Label anchors (use highest tier first):
  HIGH confidence labels:
    Revision Date, Rev Date, Rev. Date, Rev Dt, Rev. Dt,
    Date of Revision, Revision Issued Date,
    Issue Date, Date of Issue, Issued Date, Issue Dt,
    Amendment Date, Date of Amendment
  MEDIUM confidence labels:
    Issue Dte, Amended Date, Amendment Dt,
    Change Date, Date of Change, Updated Date,
    Last Updated, Modified Date
  LOW confidence labels (use only if near a revision field, or if a
  separate Drawn Date field also exists in the title block):
    Date, Dt, Dte
  IGNORE entirely — never treat as revision date label:
    Approved Date, Checked Date, Designed Date, Drawn Date

Step 2 — Directional proximity search (anchor = label/field center):
  1. Horizontal right
  2. Horizontal left
  3. Vertical below
  4. Vertical above
  5. Radial search from anchor center (if directional search fails)

Step 3 — Reject conflicting candidates if a date is more strongly
associated with: Drawn Date, Checked Date, Approved Date, Plot Date,
Printed Date, Designed Date.

Step 4 — Multiple candidates: prefer shortest distance to anchor,
strongest alignment, no conflicting nearby label.

Confidence:
  HIGH labels   → 0.85-0.95
  MEDIUM labels → 0.60-0.80
  LOW labels    → 0.40-0.60

Special case — bare "Date" label:
If only a bare "Date" or "Dt" field exists with no specific revision
date label, AND a separate Drawn Date field ALSO exists in the title
block, STILL use the bare "Date" field as revision date. The presence
of a separate Drawn Date field increases confidence that the bare
"Date" field is the revision date.

PRIORITY 3 — Drawn Date + Proximity Search
Condition: No revision date via Priority 1 or 2.
Action:    Search title block for a Drawn Date label. Same proximity
           and conflict rules as Priority 2.

  HIGH confidence labels:
    Drawn Date, Date Drawn, Drawn Dt, Drawn Dte,
    Drn Date, Drn Dt,
    Drawn By / Date, Drawn By & Date, Drawn / Date, Drn By / Dt
  MEDIUM confidence labels:
    Date of Drawing, Drawing Date, Drg Date, Drg Dt,
    Created Date, Creation Date, Drafted Date,
    Origination Date, Date Created, Authoring Date
  LOW confidence labels (use only if near Drawn context):
    Date, Dt, Dte, Draft Date, Model Creation Date, File Creation Date
  IGNORE: Checked Date, Approved Date, Designed Date, Verified Date

  Confidence: 0.60-0.75

PRIORITY 4 — Plot Date + Proximity Search
Condition: No Drawn Date via Priority 3.
Action:    Search title block for a Plot Date label. Same proximity
           and conflict rules.

  HIGH confidence labels:
    Plot Date, Date Plotted, Plotted Date, Plot Dt,
    Print Date, Printed Date, Date Printed, Printed On
  MEDIUM confidence labels:
    Plot Dte, Print Dt, Output Date, Output Dt,
    Generated Date, Generated On, Export Date, Exported On
  LOW confidence labels (use only if near plot/print context):
    Date, Dt, Dte, File Date, File Generated Date, System Date, Timestamp
  IGNORE: Revision Date, Drawn Date, Issue Date, Checked Date

  Confidence: 0.40-0.60

PRIORITY 5 — Null
Condition: Nothing found after Priorities 1-4.
Action:    Return null. Never guess. Never hallucinate a date.

PART C — DATE FORMAT NORMALISATION

Normalise the returned value to DD/MM/YYYY (Australian format — day
first). Confirmed input formats seen in Australian drawings:
  DD.MM.YYYY   → DD/MM/YYYY (convert separators)
  DD/MM/YYYY   → as-is
  DD.MM.YY     → DD/MM/20YY (2000s century)
  DD/MM/YY     → DD/MM/20YY
  DD-MM-YY     → DD/MM/20YY
  DD-MM-YYYY   → DD/MM/YYYY
  MMM YYYY     → 01/MM/YYYY (e.g. JUN 2023 → 01/06/2023)
  Mon-YY       → 01/MM/20YY (e.g. Nov-22 → 01/11/2022)
  MON. YYYY    → 01/MM/YYYY
  YYYY.MM.DD   → DD/MM/YYYY (only format where year comes first)
  D/MM/YYYY    → 0D/MM/YYYY (zero-pad)
  Sept YYYY    → 01/09/YYYY (Sept is a valid abbreviation for September)
Unparseable → return raw with confidence 0.5.

PART D — THINGS TO IGNORE (never extract as revision date)
- Copyright years (e.g. © 2024)
- Standard reference dates (e.g. AS 1735.1.1:2022)
- Survey dates labelled "Date of Survey"
- Scale references containing @A1 or @A3
- Dates inside general notes or specifications
- File timestamps in PDF metadata

STATUS
Check in this priority order:

1. Large font-size text anywhere on page matching status vocabulary.
Note: status stamp may run VERTICALLY along the left margin.

2. Dedicated field with these labels:
Status, Drawing Status, Issued For, Project Stage, Work Stage,
Phase, Reason for Issue, Issue, Drawing Status

3. Description/amendment text from most recent revision row.

Known status vocabulary (normalise to canonical values):
Preliminary: Preliminary, Preliminary Issue, Sketch Design,
Pre-Tender Issue, Draft, Preliminary D&C
Tender Issue: Tender, Tender Issue, For Tender, T,
Tender D&C, Tender Documentation, Revised Tender Issue,
Tenderable
Construction Issue: Construction Issue, Issued for Construction,
For Construction, Construction, Construction D&C, CD Issue
Preliminary Construction Issue: Preliminary Construction Issue
For Pricing: For Pricing
Not for Construction: Not for Construction, NOT FOR CONSTRUCTION
For Building Approval: Building Approval, For Building Approval
For Building Permit: Building Permit Issue, BP Issue, For Building Permit
For CDC Approval: CDC, CDC Approval, For CDC Approval, CDC Issue
(these three are LEGALLY DISTINCT — never merge them)
For Review: For Review, Issue for Review, Issue for MCC Review
For Information Only: For Information Only,
For Information Only Not for Construction
For Coordination: For Coordination, Coordination Issue
For Approval: For Approval, Approval
Design Development: Design Development
Working Drawing: Working Drawing
As Built: As Built, AS BUILT
As Installed: As Installed, AS INSTALLED
Issued for Tender: Issued for Tender, ISSUED FOR TENDER

IGNORE - never use as status values:
"THIS IS NOT AN INSTALLATION DOCUMENT"
"TO BE PRINTED IN COLOUR" / "DOCUMENTED IN COLOR"
"DO NOT SCALE" / "DO NOT SCALE DRAWING"
Copyright text / © / "MUST NOT BE COPIED"
Scale references containing "@A"
Plot dates and timestamps
"DIAL BEFORE YOU DIG"
Discipline labels: CIVIL DRAWING, STRUCTURAL DRAWING

NOISE - NEVER USE AS FIELD VALUES
@A1, @A0, @A3, @A2, @A4 | REMIT VERSION + year
North point / compass | Scale bar text
Grid references at page borders | ABN / ACN numbers
Phone, email, address | Plot dates and timestamps
File path text (C:\\Users\\...) | DIAL BEFORE YOU DIG
"X OF Y" page counts | ECO column values (Engineering Change Order)
DRAWING UNITS IN METRIC / IMPERIAL

COVER SHEETS
A cover sheet is a drawing whose own title block describes the index
or register for the project. Indicators: title contains "Cover Sheet",
"Drawing Index", "Drawing Register", "Drawing List", "Schedule of
Drawings", "Sheet Index", "Drawing Schedule"; OR the page contains a
structured table of drawing numbers and titles.

Cover sheets are STILL DRAWINGS. They have their own title block with
their own drawing number, drawing title, revision, revision date, and
status. Extract all five fields from the cover sheet's own title block
exactly as you would for any other drawing. NEVER return null for a
field just because the document is a cover sheet — return null only if
that specific field is genuinely absent from the cover sheet's title
block.

When a cover sheet is detected, ALSO extract the "drawing_register"
array containing one entry per row of the drawing list table. Each
entry includes the drawing_number, drawing_title, revision,
revision_date, and status for that listed drawing. The column order in
the register may vary — read the header row first to identify columns.
If revision_date or status columns are absent from the table, set
those fields to null within each entry.

Set document_type to "cover_sheet" when detected. For non-cover-sheet
drawings, set drawing_register to null.

OUTPUT FORMAT
Return ONLY valid JSON. No markdown, no preamble, no explanation.
Return null for any field not found - never guess.
Confidence: 1.0=unambiguous | 0.8=minor ambiguity |
0.6=inferred | 0.4=best guess

{
  "drawing_number": "string | null",
  "drawing_title": "string | null",
  "revision": "string | null",
  "revision_date": "string | null",
  "status": "string | null",
  "confidence": {
    "drawing_number": 0.0,
    "drawing_title": 0.0,
    "revision": 0.0,
    "revision_date": 0.0,
    "status": 0.0
  },
  "conflict_detected": false,
  "conflict_detail": "string | null",
  "document_type": "drawing | cover_sheet | specification | unknown",
  "title_block_location": "bottom | bottom-right | right | left | unknown",
  "revision_block_location": "top-left | left-of-title-block | integrated | top-of-title-block | right-of-title-block | none | empty | unknown",
  "notes": "string | null",
  "drawing_register": [
    {
      "drawing_number": "string | null",
      "drawing_title": "string | null",
      "revision": "string | null",
      "revision_date": "string | null",
      "status": "string | null"
    }
  ]
}

Set "drawing_register" to null for non-cover-sheet drawings.
Set "drawing_register" to [] if a cover sheet is detected but no rows
could be parsed from the register table.

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

  // ── Cap elements: strip internal fields + sort by prominence + size-guard ──
  const { stripped, truncated: inputTruncated } = capElements(elements);
  const userMessage = JSON.stringify(stripped, null, 2);
  let retryCount = 0;
  const t0 = Date.now();

  // If the input would still be rejected (token limit is a 400, not retryable), throw immediately.
  // Transient 503/429/network errors are retried with exponential backoff.
  let result;
  let serverRetries = 0;
  try {
    const r = await generateContentWithRetry(
      () => geminiModel.generateContent(userMessage),
      "text"
    );
    result = r.result;
    serverRetries = r.serverRetries;
  } catch (apiErr) {
    if (isTokenLimitError(apiErr)) {
      // Input is too large even after capping — do not retry (it will fail again).
      const errMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      throw Object.assign(new Error(errMsg), {
        metrics: {
          usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, totalTokens: 0 },
          latencyMs: Date.now() - t0,
          costUsd: 0,
          retryCount: 0,
          success: false,
          errorMessage: errMsg,
        },
      });
    }
    throw apiErr;
  }

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
      metrics: { usage, latencyMs, costUsd, retryCount: retryCount + serverRetries, success: true },
      inputTruncated,
    };
  } catch {
    // Retry once with explicit JSON formatting instruction (also wrapped in server-error retry)
    retryCount = 1;
    const { result: retryResult, serverRetries: retryServerRetries } = await generateContentWithRetry(
      () => geminiModel.generateContent(
        `${userMessage}\n\nIMPORTANT: Return ONLY a valid JSON object. No markdown, no backticks, no explanation. Start your response with { and end with }`
      ),
      "text-json-retry"
    );
    serverRetries += retryServerRetries;
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
        metrics: { usage, latencyMs, costUsd, retryCount: retryCount + serverRetries, success: true },
        inputTruncated,
      };
    } catch {
      const errorMessage = `Gemini returned unparseable JSON: ${text.slice(0, 300)}`;
      throw Object.assign(new Error(errorMessage), {
        metrics: { usage, latencyMs, costUsd, retryCount: retryCount + serverRetries, success: false, errorMessage },
      });
    }
  }
}

/**
 * Vision-based extraction for scanned PDFs with no text layer.
 * Sends a page image to Gemini instead of JSON text elements.
 * The same system prompt and JSON output schema are used.
 */
export async function extractWithGeminiVision(
  imageBase64: string,
  mimeType: "image/png" | "image/jpeg" = "image/png",
  templateContext: string = ""
): Promise<GeminiExtractionResponse> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GEMINI_API_KEY not set");

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const genAI = new GoogleGenerativeAI(apiKey);

  // Adapt the system prompt for image input
  const visionSystemPrompt = buildPrompt(templateContext)
    .replace(
      "You will receive a JSON array of text elements extracted from a construction drawing PDF. Each element has:\n- \"text\": the string content\n- \"x\": horizontal position on the page (pixels from left)\n- \"y\": vertical position on the page (pixels from top)\n- \"size\": font size (larger = more prominent)\n- \"page_width\": total page width in pixels\n- \"page_height\": total page height in pixels",
      "You will receive an image of a construction drawing page (scanned or photographed). Use visual analysis to identify the title block, revision block, and any status stamps. For field_coordinates, return estimated pixel coordinates based on visible element positions in the image."
    );

  const geminiModel = genAI.getGenerativeModel({
    model,
    systemInstruction: visionSystemPrompt,
  });

  const t0 = Date.now();
  let retryCount = 0;

  const { result, serverRetries: initialServerRetries } = await generateContentWithRetry(
    () => geminiModel.generateContent([
      "Extract all required construction drawing metadata from this image. Return only valid JSON.",
      { inlineData: { data: imageBase64, mimeType } },
    ]),
    "vision"
  );
  let serverRetries = initialServerRetries;
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
      metrics: { usage, latencyMs, costUsd, retryCount: retryCount + serverRetries, success: true },
    };
  } catch {
    retryCount = 1;
    const { result: retryResult, serverRetries: retryServerRetries } = await generateContentWithRetry(
      () => geminiModel.generateContent([
        `Extract construction drawing metadata from this image.\n\nIMPORTANT: Return ONLY a valid JSON object. No markdown, no backticks, no explanation. Start with { and end with }`,
        { inlineData: { data: imageBase64, mimeType } },
      ]),
      "vision-json-retry"
    );
    serverRetries += retryServerRetries;
    const retryText = retryResult.response.text().trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    const latencyMs = Date.now() - t0;
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
        metrics: { usage, latencyMs, costUsd, retryCount: retryCount + serverRetries, success: true },
      };
    } catch {
      const errorMessage = `Gemini Vision returned unparseable JSON: ${text.slice(0, 300)}`;
      throw Object.assign(new Error(errorMessage), {
        metrics: { usage, latencyMs, costUsd, retryCount: retryCount + serverRetries, success: false, errorMessage },
      });
    }
  }
}
