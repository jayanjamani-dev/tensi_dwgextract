# Tensi Drawing Extraction — Product Requirements Document

**Product:** Tensi DWG Extract
**Platform:** Next.js 16 (App Router, Turbopack) · Prisma 7 · SQLite (libsql) · Python 3 subprocess · Gemini API
**Latest version:** v2.1 (2026-04-26)

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Target Fields](#2-target-fields)
3. [Tech Stack & Architecture](#3-tech-stack--architecture)
4. [Extraction Pipeline — Step-by-Step](#4-extraction-pipeline--step-by-step)
5. [Per-Field Extraction Rules](#5-per-field-extraction-rules)
6. [System Prompt (Gemini)](#6-system-prompt-gemini)
7. [Evidence-Based Cross-Validation](#7-evidence-based-cross-validation)
8. [Template Learning & Pattern Locking](#8-template-learning--pattern-locking)
9. [Scanned PDF Vision Fallback](#9-scanned-pdf-vision-fallback)
10. [Rotated PDF Support](#10-rotated-pdf-support)
11. [Status Canonical Map](#11-status-canonical-map)
12. [Date Normalisation](#12-date-normalisation)
13. [Extraction Rules Audit Trail](#13-extraction-rules-audit-trail)
14. [Database Schema](#14-database-schema)
15. [API Routes](#15-api-routes)
16. [Key Files](#16-key-files)
17. [Environment Variables](#17-environment-variables)
18. [Flag Taxonomy](#18-flag-taxonomy)
19. [Change Log](#19-change-log)

---

## 1. Purpose & Scope

Tensi DWG Extract automates structured metadata extraction from construction drawing PDFs so document controllers stop manually keying data into registers. For each drawing, the pipeline extracts the five core title-block fields (drawing number, title, revision, revision date, status) plus supporting fields (location, architect firm), then presents them for review/edit in a web UI with a live PDF viewer.

The system is optimised for Australian construction drawings (A0/A1/A3 landscape, NSW/VIC title block conventions, Australian date formats) but the rules are data-driven.

### Non-Goals
- Rendering engineering content (gridlines, dimensions, annotations)
- OCR of non-title-block regions
- Real-time collaboration on the same drawing
- Replacing a full DMS (Aconex, Procore) — Tensi is the extraction layer that feeds one

---

## 2. Target Fields

### Mandatory
| # | Field | DB Column | Notes |
|---|-------|-----------|-------|
| 1 | Drawing Number | `drawingNumber` | Unique sheet identifier (A101, ME001, E_000502, 3049-WD-A401) |
| 2 | Drawing Title | `drawingTitle` | Sheet name; multi-line combined with spaces |
| 3 | Revision | `revision` | Letter (A, B, C1, T2) or number (0, 1, 2) |
| 4 | Revision Date | `revisionDate` | Date of current revision, normalised to `DD/MM/YYYY` |
| 5 | Status | `status` | Canonical issue purpose (see §11) |

### Supporting
| # | Field | DB Column | Notes |
|---|-------|-----------|-------|
| 6 | Location | `location` | Site/project address when printed on the drawing |
| 7 | Architect Firm Name | _(template only)_ | Drives architect resolution + template learning |

### Confidence & Coordinates
Every mandatory field gets:
- A confidence score `[0..1]` from Gemini, adjusted by validation
- A `{x, y}` coordinate pair pointing back into the PDF (stored in `fieldCoordinates` JSON)
- An audit-trail entry in `extractionRules` JSON recording source, transforms, and validation outcome

---

## 3. Tech Stack & Architecture

### Stack
- **Runtime:** Node.js 20+ (Next.js 16 App Router, Turbopack)
- **ORM:** Prisma 7 · client generated at `src/generated/prisma` (not the default `@prisma/client` path)
- **DB:** SQLite via `@prisma/adapter-libsql` (file: `dev.db`)
- **PDF text extraction:** Python 3 subprocess (`scripts/extract_text.py`) using `pdfplumber` — invoked via `child_process.spawn` with a 240s timeout
- **PDF image rendering:** `pdfplumber.page.to_image()` + Pillow → PNG base64 for Gemini Vision
- **AI:** `@google/generative-ai` — model configurable via `GEMINI_MODEL` (default `gemini-2.5-flash`)
- **PDF viewer:** `pdfjs-dist` via `react-pdf`, with drag-to-pan + region-select overlay
- **UI:** React 19, Tailwind CSS

### High-Level Flow
```
┌──────────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐
│  PDF upload  │───▶│ pdfplumber  │───▶│   Gemini    │───▶│ Validate │
│   (web UI)   │    │ subprocess  │    │  (text/vis) │    │ + cross- │
└──────────────┘    └─────────────┘    └─────────────┘    │  check   │
                                                           └─────┬────┘
                                       ┌─────────────┐           │
                                       │  Prisma DB  │◀──────────┘
                                       │  (SQLite)   │
                                       └─────────────┘
```

### Why this split
- **Python for pdfplumber** — the library is Python-only; subprocess isolation prevents its memory footprint from affecting the Node server.
- **Gemini for semantic extraction** — LLMs handle label variance (Drawing No vs Drg No vs Sheet No) far better than regex.
- **Validation layer** — catches Gemini hallucinations deterministically by cross-referencing source text.
- **Template learning** — after a few confirmed drawings per architect, the system locks a crop bbox so subsequent drawings extract in ~5× less time/tokens.

---

## 4. Extraction Pipeline — Step-by-Step

The extract route (`POST /api/drawings/[id]/extract`) executes six steps in sequence. Single extraction and bulk extraction share the same pipeline.

```
 ┌────────────────────────────────────────────────────────┐
 │ Step 0  Pre-resolve architect from sibling drawings    │
 ├────────────────────────────────────────────────────────┤
 │ Step 1  pdfplumber three-zone extraction               │
 │         Zone 2 — full-width bottom 25% of page         │
 │         Zone 3 — right 25% vertical strip, full height │
 │         Zone 4 — left 15% width, bottom 30% height     │
 │         Cover sheets: full-page extraction             │
 │         Deduplication by (text + x + y)                │
 ├────────────────────────────────────────────────────────┤
 │ Step 2  Cover sheet detection                          │
 ├────────────────────────────────────────────────────────┤
 │ Step 2.5 Vision fallback (scanned PDFs — 0 elements)   │
 ├────────────────────────────────────────────────────────┤
 │ Step 3  Gemini inference                               │
 │         extractWithGemini()  OR  extractWithGeminiVision│
 ├────────────────────────────────────────────────────────┤
 │ Step 4  Validation (validateExtraction)                │
 │         • Date normalisation                           │
 │         • Drawing-number sanity                        │
 │         • Status canonical map                         │
 │         • Title cleanup (newline collapse)             │
 │         • Low-confidence flagging                      │
 ├────────────────────────────────────────────────────────┤
 │ Step 4.1 crossValidateWithElements                     │
 │         Evidence check: value must appear in elements  │
 │         Vision mode: stricter confidence thresholds    │
 ├────────────────────────────────────────────────────────┤
 │ Step 4.5 Inject pipeline source into extractionRules   │
 ├────────────────────────────────────────────────────────┤
 │ Step 5  Architect resolution + template learning       │
 ├────────────────────────────────────────────────────────┤
 │ Step 6  DB write                                       │
 └────────────────────────────────────────────────────────┘
```

### Extraction Modes

| Mode | Trigger | pdfplumber call | Elements sent to Gemini |
|------|---------|-----------------|-------------------------|
| **Three-Zone Region** | Default for all drawings | `--regions` → bottom 25% + right 25% + left-15%/bottom-30% | Deduped elements, large-font (≥14pt) sorted first, capped at 1500 |
| **Full-Page** | Filename matches cover sheet pattern | `extract()` → full page | Same capping |
| **Vision** | Zero text elements (scanned PDF) | `--image [dpi]` → base64 PNG | Image payload + text prompt |

### Three-Zone Extraction

Three zones are extracted unconditionally and deduplicated by `(text + x + y)`:

- **Zone 2** — Full-width bottom 25% of page: captures the title block on bottom-strip layouts
- **Zone 3** — Right 25% vertical strip, full page height: captures right-side vertical title blocks
- **Zone 4** — Left 15% width, bottom 30% height: captures left-side revision tables (common on some NSW firms)

Cover sheets detected by filename use full-page extraction so the drawing list table in the centre of the page is visible to Gemini.

---

## 5. Per-Field Extraction Rules

Each field has a **hierarchical** extraction rule enforced in three layers: (a) the Gemini system prompt instructs the model, (b) `validateExtraction()` normalises and sanity-checks, (c) `crossValidateWithElements()` verifies textual evidence.

### 5.1 Drawing Number
**Labels recognised:** Drawing No · Drawing Number · Drg No · Dwg No · Sheet No · Sheet Number · Drawing · DRG · Ref No · Drawing # · DWG NO · DWG.

**Not confused with:** Project Number · Job Number · Reference Number.

**Known formats:** `ME001`, `A101`, `3049-WD-A401`, `0.A000`, `VAS24048-M315`, `0101020-GHDD-00-DRG-AR-00100`, `E.000502`, `12112.B00`, `a/a008`, `S002`, `E2` (from "E2 OF 7"). Lowercase allowed.

**Transforms applied (validate-extraction.ts):**
- Bullet-suffix strip: `A000•B` → `{ drawingNumber: "A000", revision: "B" }` (also promotes the revision if missing)
- Sanity filter via `looksLikeDrawingNumber()` — rejects values with newlines, >30 chars, or >2 spaces. Sets flag `DRAWING_NUMBER_INVALID`.

**Cross-validation:** value must appear as a substring in at least one element. If missing in text mode → flag `DRAWING_NUMBER_NOT_IN_TEXT` (flag only, value kept for review).

### 5.2 Drawing Title
**Labels:** Title · Drawing Title · Sheet Title · Description · Title of Drawing · Drawing.

**Rules:**
- **Drawing-specific label only.** Typically a two-line structure: a series label (e.g. "A03 GA PLANS") + specific title (e.g. "Level 04 General Arrangement Plan") — include BOTH lines.
- Combine multi-line with spaces, preserve top-to-bottom reading order.
- **Never include:** project name, client name, address, building/site headers that appear above the drawing-specific title. Street addresses, company names, project descriptions are strictly excluded.

**Transforms:**
- `newlines_collapsed` — `\r\n+` collapsed to single space; extra whitespace normalised.

**Cross-validation:** at least one significant word (length > 3) must appear in elements. Otherwise flag `DRAWING_TITLE_NOT_IN_TEXT`.

### 5.3 Revision

The revision extraction follows an 11-step master rule enforced entirely in the Gemini system prompt.

**Step summary:**
1. **STEP 0 — Input zones** — Three-zone extraction has already been applied; input is the combined deduplicated output.
2. **STEP 1 — Detect revision table** — requires ≥1 revision identifier header + ≥1 date header in same horizontal band. **Minimum 2 data rows** — a single-row block is a title block field, not a revision table. Blank REV cells are valid data rows (counted in total, skipped in sequence analysis).
3. **STEP 2 — Multiple tables** — if two+ tables exist, prefer the one with more data rows when dates are equal; otherwise the table with the most recent date wins. Flag: `TWO_TABLES_DETECTED`.
4. **STEP 3 — Orientation** — header at top → latest = bottom row; header at bottom → latest = top row.
5. **STEP 4 — Date comparison (unconditional)** — when valid dates exist, the row with the most recent date IS the latest revision row, regardless of orientation. Flag: `DATE_OVERRIDES_ORIENTATION` (replaces `ORIENTATION_DATE_CONFLICT`). When no dates exist: flag `TABLE_NO_DATES`, use orientation row.
6. **STEP 4-FALLBACK** — fires ONLY when zero valid dates in table: match table Rev code against title block REV field.
7. **STEP 5–6 — Row band mapping** — define ± tolerance band, map elements to columns by x-center alignment.
8. **STEP 7 — Extract revision number** — from REV-identifier column only; never from Drawn/Checked/Approved/Description/Date columns.
9. **STEP 8 — Table always overrides** — any value from the table row band beats the title block REV field.
10. **STEP 9 — Field fallback** — used only if Steps 7–8 produce nothing. Flag: `FIELD_FALLBACK_USED`.
11. **STEP 10 — Same-row lock** — revision number and revision date MUST come from the same row band.
12. **STEP 11 — Null rule** — return null if nothing found.

**Mixed sequence recognition:** `A B C … I C1 C2` is a valid ANZ construction sequence. Single alpha revisions precede stage-prefixed codes (C1 C2 < T1 T2 < BP1 BP2). Never trigger Step 4-FALLBACK for this pattern.

**Special values:**
- `"#"` → first issue, no letter yet → return `"#"`
- `"*"`, `"-"`, blank → return `"-"`
- `"@A1"` → SCALE reference, never a revision
- Status field content → NOT a revision
- Blank REV cell on latest row → return the date, return null for revision, flag `LATEST_ROW_HAS_BLANK_REVISION`

**Cross-validation (text mode):** revision letter/number must appear in elements. If missing → null + flag `REVISION_NOT_IN_TEXT`. **Vision mode:** trusted (single letters rarely hallucinated).

### 5.4 Revision Date

**Hard rule (absolute):** `revision_date` must come **exclusively** from the revision block. Title block "Date" / "Date Drawn" / "Issue Date" / "Date Prepared" is strictly prohibited as a source.

**Enforcement layers:**
1. Gemini system prompt — explicit ban on title block date for revision_date.
2. `validateExtraction()` — if `revision_block_location === "none"` and a date was returned, null it and flag `REVISION_DATE_NULLED_NO_REV_BLOCK`.
3. `crossValidateWithElements()`:
   - Text mode: date string (or any zero-padding/separator variant) must appear in elements. If missing → null + flag `REVISION_DATE_NOT_IN_TEXT`.
   - Vision mode: requires ≥ 0.9 confidence. Below → null + `REVISION_DATE_LOW_CONFIDENCE_VISION`.
   - Both modes: suspicious `01/01/YYYY` (Jan 1st) pattern → null + `REVISION_DATE_SUSPICIOUS` (usually a creation date).
   - Vision mode + `REVISION_CONFLICT` → null + `REVISION_DATE_CONFLICT_VISION` (cannot verify source).

**Normalisation:** all variants → `DD/MM/YYYY` (see §12).

### 5.5 Status

The status engine follows a three-priority Parts A–K rule enforced in the Gemini system prompt. Priority order: **stamp (entire page) → label (title block zones) → revision description → null**.

**Part D — Priority 1: Status stamp** — large-font text anywhere on page, may be rotated (left margin watermark). Vocabulary covers ~60 terms across Restriction, Construction, Manufacture, Procurement, Approval, Building Permit, Coordination, Contract, Design/Tender, Final/Record categories.

**Part E — NOT-prefix guard (critical):** before accepting any value containing CONSTRUCTION, TENDER, APPROVAL, ISSUE, or PROCUREMENT — scan all elements within **30pt vertically AND 100pt horizontally** for the word NOT. If found, the full phrase is NOT FOR [WORD] — treat as restriction. This prevents split-line "NOT FOR CONSTRUCTION" being read as "FOR CONSTRUCTION" when NOT appears at a smaller font size on a separate line.

**Part F — Dual stamp logic:** when two status candidates are in close proximity (≤20pt vertical or ≤50pt horizontal), a conflict priority table determines the winner (Final/record > Construction > Manufacture > Contract > Approval/permit > Coordination > Design/tender).

**Part G — Priority 2: Label in title block** — high/medium/low confidence labels; directional proximity search (right → left → below → above → radial).

**Part H — Priority 3: Revision description (unconditional):** when both Priority 1 and Priority 2 return nothing AND the latest revision row is positively confirmed by BOTH revision number AND revision date — return the full description column text exactly as written, with no vocabulary match required, no truncation, no normalisation. Confidence: high (both number+date confirm), medium (only one confirms). Edge cases: empty description → `LATEST_ROW_DESCRIPTION_EMPTY`; 1–2 char description (initials) → `LATEST_ROW_DESCRIPTION_IS_INITIALS`.

**Part I — Candidate comparison:** when BOTH a Priority 2 label value AND a nearby vocabulary match exist, score both against the conflict priority tier and return the higher-scoring candidate. Prevents label values (e.g. "SD" = tier 7) from silently overriding nearby stamps (e.g. "ISSUE FOR REVIEW" = tier 6).

**Normalisation:** raw values pass through `CANONICAL_STATUS` map (§11). Unknown terms (from revision description fallback) are stored as-is.

**Cross-validation:**
- Text mode: at least one canonical status vocabulary phrase must appear in elements corpus. If none → null + flag `STATUS_NOT_IN_TEXT`. (Note: Priority 3 description values are not cross-validated against the vocabulary — they are already taken directly from elements.)
- Vision mode: requires ≥ 0.9 confidence. Below → null + `STATUS_LOW_CONFIDENCE_VISION`.

### 5.6 Location (supporting)
Site/project address when stamped on the drawing. No special validation beyond what Gemini returns.

### 5.7 Architect Firm Name (supporting, template-only)
Drives architect resolution. Not surfaced in the per-drawing UI fields.

---

## 6. System Prompt (Gemini)

The full system prompt lives in `src/lib/gemini.ts` (~200 lines). Summary of its structure:

```
You are a construction drawing metadata extraction engine for an
Australian document management platform called Tensi.

You will receive a JSON array of text elements with text, x, y, size,
page_width, page_height.

Extract exactly five fields from this drawing.

UNDERSTANDING THE DRAWING LAYOUT
  TITLE BLOCK       — bordered area, metadata fields
  REVISION BLOCK    — table of revisions; column order varies
  STATUS STAMP      — large bold text, may be vertical

FIELD EXTRACTION RULES
  DRAWING NUMBER    — labels + format examples + ban on project/job number
  DRAWING TITLE     — series + specific title; no project/client text
  REVISION          — 3-step hierarchy: revision block → title block → special cases
  REVISION DATE     — revision block ONLY; never title block date
  STATUS            — stamp > label > revision description

KNOWN STATUS VOCABULARY (canonical values)
  ... full list, see §11 ...
  For Building Approval / For Building Permit / For CDC Approval
  are LEGALLY DISTINCT — never merge them.

IGNORE (never as status)
  "THIS IS NOT AN INSTALLATION DOCUMENT", "DO NOT SCALE", copyright,
  "@A1", plot timestamps, "DIAL BEFORE YOU DIG", discipline labels.

NOISE (never as field values)
  @A1/@A0/@A3, REMIT VERSION, north point, scale bar, grid references,
  ABN/ACN, phone/email/address, plot dates, file paths,
  "X OF Y" page counts, ECO columns.

COVER SHEET DETECTION
  Title contains "Cover Sheet", "Drawing Index", etc. → return nulls
  and set document_type = "cover_sheet".

OUTPUT FORMAT
  JSON only. Confidence 0-1. Never guess; return null if not found.

  {
    "drawing_number": "string | null",
    "drawing_title":  "string | null",
    "revision":       "string | null",
    "revision_date":  "string | null",
    "status":         "string | null",
    "location":       "string | null",
    "architect_firm_name": "string | null",
    "confidence": { ... },
    "field_coordinates": { drawing_number: {x,y}, ... },
    "conflict_detected": false,
    "conflict_detail": null,
    "document_type": "drawing | cover_sheet | specification | unknown",
    "title_block_location": "bottom | bottom-right | right | left | unknown",
    "revision_block_location":
      "top-left | left-of-title-block | integrated | top-of-title-block |
       right-of-title-block | none | empty | unknown",
    "notes": "string | null"
  }

{{TEMPLATE_CONTEXT}}
```

### Template Context Injection
When a template is locked for the drawing's architect, the `{{TEMPLATE_CONTEXT}}` placeholder is replaced with architect-specific hints:
- Expected drawing number format (regex)
- Known field label conventions
- Observed revision date format
- Known status terminology for this firm
- Field positions `{x, y}` learned from prior drawings

This biases Gemini toward the firm's conventions without forcing them.

### Input Capping (`capElements()`)

Elements are prepared in two-tier order before capping:

1. **Large-font elements (≥14pt) sorted first unconditionally** — status stamps, title block headings, and drawing numbers are always large font. Promoting them ensures they reach Gemini regardless of their x/y position, preventing truncation of large-font stamps at the bottom of the sort.
2. **Within each tier, sorted by bottom-right proximity** — score = `(page_height - y) + (page_width - x)` ascending (lower = closer to bottom-right corner). Keeps title block and revision table content ahead of body text.

Cap: `MAX_ELEMENTS = 1500` (raised from 500 to accommodate large A0 drawings where three-zone extraction can exceed 800 elements).

JSON payload secondary guard: `MAX_INPUT_CHARS = 1_000_000` (~25% of Gemini 2.5 Flash's 1M token context). If exceeded, iteratively trim to 75% until under limit.

Truncation → flag `INPUT_TRUNCATED`.

---

## 7. Evidence-Based Cross-Validation

Post-Gemini, `crossValidateWithElements()` enforces: **every field value must have textual evidence in the raw extracted elements**. If it doesn't, null it and flag it.

### Text Mode (elements available)

| Field | Rule | On miss |
|-------|------|---------|
| Status | Any `CANONICAL_STATUS` key must appear as substring in corpus | null + `STATUS_NOT_IN_TEXT` |
| Revision Date | Date (any padding/separator variant) must appear in elements | null + `REVISION_DATE_NOT_IN_TEXT` |
| Revision | Revision letter/number must appear in elements | null + `REVISION_NOT_IN_TEXT` |
| Drawing Number | Value must appear as substring | flag `DRAWING_NUMBER_NOT_IN_TEXT` (kept for review) |
| Drawing Title | ≥1 word (length > 3) must appear | flag `DRAWING_TITLE_NOT_IN_TEXT` (kept) |

### Vision Mode (no elements — scanned PDF)

Cross-validation against elements is impossible. Falls back to confidence thresholds and structural rules.

| Field | Rule |
|-------|------|
| Status | Require ≥ 0.9 confidence; else null + `STATUS_LOW_CONFIDENCE_VISION` |
| Revision Date | Require ≥ 0.9 confidence; else null + `REVISION_DATE_LOW_CONFIDENCE_VISION` |
| Revision | Trust Gemini (single letters/digits rarely hallucinated) |
| Both | `01/01/YYYY` pattern → null + `REVISION_DATE_SUSPICIOUS` |
| Vision + `REVISION_CONFLICT` | null the date + `REVISION_DATE_CONFLICT_VISION` |

### Date Variant Matcher

`dateExistsInElements()` generates all plausible variants before declaring a date absent:
- Padding: `1/6/2023`, `01/6/2023`, `1/06/2023`, `01/06/2023`
- Separators: `/`, `.`, `-`
- Year: 2-digit and 4-digit
- Month names: "Jan 2023", "15 Jan 2023", etc.

This fixes a class of false negatives where Gemini returns a zero-padded date but the PDF renders unpadded (or vice versa).

---

## 8. Template Learning

### Goal
Associate drawings with their architect firm to enable correction learning and context injection into future Gemini calls.

### Architect Resolution
- First drawing: architect unknown → Gemini identifies `architect_firm_name`, `resolveArchitectAndLearnTemplate()` creates or matches an Architect record.
- Subsequent drawings in same project: `preResolveArchitectFromSibling()` inherits the architectId from an already-extracted sibling drawing → Gemini receives template context from the first call onward. Flag: `ARCH_PRE_RESOLVED_FROM_SIBLING`.
- If Gemini-returned firm name doesn't match the pre-resolved architect: conflict handled, may fall back to `"Unknown (project X)"`. Flag: `ARCH_FALLBACK_UNKNOWN`.

### Template Context Injection
When an Architect has an associated Template record, `getTemplateContext()` formats architect-specific hints injected into the `{{TEMPLATE_CONTEXT}}` section of the system prompt:
- Expected drawing number format
- Known field label conventions (`fieldLabelMap`)
- Observed revision date format
- Known status terminology

This biases Gemini toward the firm's conventions without hardcoding them.

### Value Replacements (Correction Learning)
When a user corrects a field value via the UI, the edit is stored in `Template.valueReplacements` as `{ fieldName: { originalValue: correctedValue } }`. Future drawings with the same original value auto-apply the correction. Patterns (prefix/suffix/regex) detected via `detectPattern()` are stored in `Template.learnedRules` and matched globally across the architect.

---

## 9. Scanned PDF Vision Fallback

### Trigger
`scanned = true` when pdfplumber returns 0 text elements (no text layer, pure raster PDF).

### Flow
```
pdfplumber returns 0 elements
  ↓
renderPageAsImage(pdfPath, pageIndex, dpi=150)
  ↓
Returns { imageBase64, width, height }
  ↓
extractWithGeminiVision(imageBase64, mimeType, templateContext)
  ↓
Same system prompt, but image input instead of JSON elements
  ↓
Same validation + cross-validation (Vision mode path)
```

### Failure Modes
- Image render fails → flag `VISION_RENDER_FAILED`, drawing marked extracted with null fields.
- Crop returns 0 elements but full page is scanned → flag `CROP_EMPTY_SCANNED`, falls through to Vision fallback.

### Confidence Posture
Gemini Vision tends to be overconfident on status and revision date fields — it will "see" a status stamp that isn't actually there. Vision mode therefore requires **0.9 confidence** for these fields (not the default 0.7).

---

## 10. Rotated PDF Support

### The Problem
Rotated PDFs (portrait source rotated 90° to landscape for display) have `page.bbox` with a **non-zero origin**. For example, A3 rotated:
- Visual page: 2383.92 × 1683.72
- `page.bbox`: `(-1191.96, 841.86, 1191.96, 2525.58)` — origin is NOT `(0, 0)`

If we pass a 0-based crop `(0, 1262, 2383, 1683)` to `page.crop()`, pdfplumber raises: *"Bounding box is not fully within parent page bounding box"*.

### The Fix (scripts/extract_text.py)
All extraction functions now:
1. Read `page.bbox` → compute `(px0, py0)` internal origin
2. Translate 0-based input coordinates to internal space: `cx0 = px0 + nx0`
3. Translate internal word coordinates back to 0-based in the returned elements (subtract `px0, py0`)

This means all inputs and outputs throughout the Node layer use 0-based coordinates; the translation is invisible above the Python layer.

---

## 11. Status Canonical Map

Hardcoded in `src/lib/validate-extraction.ts` as `CANONICAL_STATUS`. Keys are lowercase trimmed variants; values are canonical display strings. **DB `STATUS_NORMALISATION` rules can supplement but never override this map.**

### Construction Issue
`construction issue`, `issued for construction`, `issue for construction`, `for construction`, `for construction (fc)`, `construction`, `ifc`, `fc`, `cd issue`, `construction d&c`, `issued construction` → **Construction Issue**

### Preliminary Construction Issue
`preliminary construction issue`, `pci`, `preliminary ifc` → **Preliminary Construction Issue**

### Tender Issue
`tender issue`, `issued for tender`, `for tender`, `ift`, `tender`, `tender d&c`, `tender documentation`, `revised tender issue`, `tenderable`, `pre-tender issue` → **Tender Issue**

### Preliminary
`preliminary`, `preliminary issue`, `sketch design`, `draft`, `preliminary d&c` → **Preliminary**

### Design Development
`design development`, `dd` → **Design Development**

### For Approval
`for approval`, `approval`, `ifa`, `approved`, `approved as noted`, `aan` → **For Approval**

### For Review
`for review`, `issue for review`, `issued for review`, `ifr` → **For Review**

### For Information Only
`for information only`, `for information`, `for info`, `fi`, `for information only not for construction` → **For Information Only**

### For Coordination
`for coordination`, `coordination issue` → **For Coordination**

### For Pricing
`for pricing` → **For Pricing**

### For Building Approval (generic council approval)
`for building approval`, `building approval` → **For Building Approval**

### For Building Permit (BP Issue — distinct jurisdiction)
`building permit issue`, `bp issue`, `for building permit` → **For Building Permit**

### For CDC Approval (NSW Complying Development Certificate — legally distinct)
`for cdc approval`, `cdc approval`, `cdc`, `cdc issue` → **For CDC Approval**

> **⚠ Critical: For Building Approval, For Building Permit, and For CDC Approval are legally distinct approval pathways. They must never collapse into the same canonical value. CDC is a fast-track private-certifier path under NSW Part 4A EP&A Act; Building Approval is a general council approval; BP Issue is yet another permit class.**

### Not for Construction
`not for construction`, `nfc` → **Not for Construction**

### As Built / As Installed
`as built`, `as-built` → **As Built**
`as installed`, `as-installed` → **As Installed**

### Working Drawing · Superseded · Void · Schematic Design
`working drawing` → **Working Drawing**
`superseded` → **Superseded**
`void` → **Void**
`schematic design`, `sd` → **Schematic Design**

---

## 12. Date Normalisation

Target canonical format: `DD/MM/YYYY`. Implemented in `normaliseDate()` in `validate-extraction.ts`.

| Input Format | Example | Output | Notes |
|--------------|---------|--------|-------|
| DD/MM/YYYY | `15/01/2025` | `15/01/2025` | Zero-padded if unpadded |
| DD/MM/YY | `15/01/25` | `15/01/2025` | Year → 2000s |
| DD.MM.YY / DD.MM.YYYY | `15.01.25` | `15/01/2025` | Separator converted |
| DD-MM-YY / DD-MM-YYYY | `15-01-2025` | `15/01/2025` | Separator converted |
| YYYY-MM-DD | `2025-01-15` | `15/01/2025` | Reorder |
| DD/MM (no year) | `15/01` | `15/01` (conf 0.6) | Flagged for review |
| Mon YY | `Jan 25` | `01/01/2025` (conf 0.7) | Day defaults to 01 |
| Month YYYY | `JAN 2025` | `01/01/2025` (conf 0.7) | — |
| Natural language | `January 15, 2025` | `15/01/2025` | via `new Date()` |
| Unparseable | `TBC 2025` | raw string (conf 0.4) | Flag `DATE_FORMAT_UNKNOWN` |

The detected input format is recorded in `extractionRules.revisionDate.normalisedFormat` for audit.

---

## 13. Extraction Rules Audit Trail

Every extraction writes a per-field audit object to `Drawing.extractionRules` (JSON string). Retrieved via `GET /api/drawings/[id]` as a parsed object.

### Schema
```typescript
interface ExtractionFieldRule {
  source?: string;             // "crop_bbox" | "region" | "vision" | "revision_block" | "bbox_override"
  blockLocation?: string;      // revisionBlockLocation (integrated | bottom-left | right | none | unknown)
  transforms: string[];        // e.g. ["newlines_collapsed", "date_normalised", "status_normalised"]
  validation: "passed" | "failed" | "flagged";
  rawValue?: string;           // pre-normalisation Gemini value
  normalisedFormat?: string;   // revisionDate: detected input format
  canonical?: string;          // status: the canonical value mapped to
}

interface ExtractionRules {
  drawingNumber: ExtractionFieldRule;
  drawingTitle:  ExtractionFieldRule;
  revision:      ExtractionFieldRule;
  revisionDate:  ExtractionFieldRule;
  status:        ExtractionFieldRule;
}
```

### Where Populated
- Built in `validateExtraction()` — transforms, validation outcome, raw values
- `source` and `blockLocation` injected in Step 4.6 of the extract route (needs pipeline context)
- `transforms` may gain entries from cross-validation (e.g. `nulled_no_text_evidence`, `nulled_suspicious_generic_date`)

### Surfaced In UI
The drawing detail page (`src/app/projects/[id]/drawings/[drawingId]/page.tsx`) renders an "Extraction Rules" section showing, per field:
- Source (with block location if applicable)
- Format transformation (for dates: `DD/MM/YY → DD/MM/YYYY`)
- Canonical mapping (for status: `For Construction → Construction Issue`)
- Transform pills (Newlines Collapsed, Date Normalised, etc.)
- Validation outcome with coloured dot (green = passed, amber = flagged, red = failed)

---

## 14. Database Schema

Prisma schema at `prisma/schema.prisma`. Client generated to `src/generated/prisma` (custom output path).

### Project
`id, name, description?, createdAt, drawings[]`

### Architect
`id, firmName, firmAddress?, createdAt, drawings[], template?, corrections[]`

### Drawing
```
id, projectId, architectId?, filename, filepath, pageNumber
drawingNumber?, drawingTitle?, revision?, revisionDate?, status?, location?
fieldCoordinates?     JSON — per-field {x, y}
extractionRules?      JSON — per-field audit trail (§13)
drawingRegister?      JSON — array of register entries from cover sheet drawing list table
                       [{drawing_number, drawing_title, revision, revision_date, status}]
confidenceDrawingNumber/Title/Revision/RevisionDate/Status/Location  Float?
conflictDetected      Boolean
conflictDetail?       String
documentType?, titleBlockLocation?, revisionBlockLocation?
extractionModel?, pdfplumberRaw?  JSON — full text elements
flags?                JSON — string[]
notes?                String
processingTimeMs?, pdfplumberTimeMs?
totalInputTokens?, totalOutputTokens?, totalCostUsd?
extractionStatus      "pending | processing | extracted | cover_sheet | reviewed | published"
extractedAt?, reviewedAt?, publishedAt?, createdAt
corrections[], apiCalls[]
```

### ApiCall (FinOps tracking)
`id, drawingId, model, callType, inputTokens, outputTokens, thinkingTokens, totalTokens, latencyMs, costUsd, success, errorMessage?, retryCount, createdAt`

### Correction
`id, drawingId, architectId?, fieldName, originalValue?, correctedValue?, pattern? (JSON), correctedAt`

### Template
```
id, architectId (unique), titleBlockLocation?, revisionBlockLocation?
revisionColumnOrder?, revisionReadingDirection?, fieldLabelMap?
titleBlockPattern?    JSON — {side, bbox:{x0,y0,x1,y1}, confirmedDrawingCount, architectFirmName, drawingNumberFormat}
fieldPositions?       JSON — {fieldName: {x, y}}
valueReplacements?    JSON — correction history
learnedRules?         JSON — [{type, field, value, ...}]
sampleDrawingId?, lastUpdated
drawingNumberFormatDesc?, drawingTitleConventions?
revisionNumberFormat?, revisionDateFormat?, statusTerminology?
```

### SystemRule
`id, ruleType (unique), content (JSON), description?, lastUpdated`

Current `ruleType` values: `STATUS_NORMALISATION` (supplemental mappings on top of the hardcoded canonical map).

---

## 15. API Routes

| Method + Path | Purpose |
|---|---|
| `POST /api/drawings/[id]/extract` | Single drawing extraction pipeline |
| `GET  /api/drawings/[id]` | Fetch drawing with parsed `extractionRules` |
| `PATCH /api/drawings/[id]` | Update fields (creates Corrections + learns patterns) |
| `POST /api/drawings/[id]/cross-check-region` | Manual region selection — Vision primary, pdfplumber fallback |
| `POST /api/drawings/bulk-apply-region` | Apply learned region to other drawings in project |
| `POST /api/projects/[id]/extract-all` | Bulk extraction (same pipeline, sequential) |
| `GET/POST /api/rules` | Status normalisation + other system rules |
| `GET/POST /api/rules/system` | System-level rule CRUD |
| `GET/PATCH /api/templates/[id]` | Template inspection + editing |

---

## 16. Key Files

### Extraction Core
| File | Role |
|------|------|
| `scripts/extract_text.py` | pdfplumber subprocess — `extract()` full page, `extract_regions()`, `extract_crop()`, `render_image()`, `--count`. Handles rotated PDFs via page-origin translation. 240s timeout. |
| `src/lib/pdfplumber.ts` | Node wrapper around Python subprocess. Exposes `extractTextFromPdf`, `extractTextFromRegions`, `extractTextFromCrop`, `renderPageAsImage`, `getPageCount`. |
| `src/lib/gemini.ts` | Gemini API wrapper + system prompt. `extractWithGemini()` (text), `extractWithGeminiVision()` (image). Input capping, token usage metrics, retry logic. |
| `src/lib/validate-extraction.ts` | `validateExtraction()` normalises Gemini output + builds extraction rules. `crossValidateWithElements()` enforces evidence check. `CANONICAL_STATUS` map. Date normaliser. |
| `src/lib/templates.ts` | Architect resolution, pattern locking, template learning. `getTemplatePattern`, `resolveArchitectAndLearnTemplate`, `getLearnedBboxRegions`. |
| `src/lib/bbox-extraction.ts` | In-memory element filtering by bounding box (for cross-check region). |

### API Routes
| File | Role |
|------|------|
| `src/app/api/drawings/[id]/extract/route.ts` | Single extraction pipeline (6 steps). ~470 lines. |
| `src/app/api/projects/[id]/extract-all/route.ts` | Bulk extraction — same pipeline, sequential. |
| `src/app/api/drawings/[id]/cross-check-region/route.ts` | Manual region extraction (Vision primary). |
| `src/app/api/drawings/bulk-apply-region/route.ts` | Apply learned bbox to siblings. |
| `src/app/api/drawings/[id]/route.ts` | GET/PATCH drawing — parses `extractionRules`, creates Correction + template learning on PATCH. |

### UI
| File | Role |
|------|------|
| `src/app/projects/[id]/drawings/[drawingId]/page.tsx` | Drawing detail view with PDF viewer + Extracted Data panel + Extraction Rules audit table. |
| `src/components/PDFViewer.tsx` | PDF renderer with drag-to-pan, unrestricted zoom, region selection overlay. |
| `src/app/projects/[id]/page.tsx` | Project view with drawings list, states, bulk extraction. |
| `src/app/rules/page.tsx` | Rules dashboard — status normalisation, learned patterns. |
| `src/app/templates/page.tsx` | Template inspector per architect. |

---

## 17. Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `GOOGLE_GEMINI_API_KEY` | _(required)_ | Gemini API auth |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model for text extraction + Vision |
| `GEMINI_RATE_DELAY_MS` | `200` | Delay between Gemini calls in bulk |
| `CONFIDENCE_THRESHOLD` | `0.7` | Threshold below which a field is flagged LOW_CONFIDENCE (text mode) |
| `GEMINI_PRICE_INPUT_PER_1M` | — | $/1M input tokens (for Pro) |
| `GEMINI_PRICE_OUTPUT_PER_1M` | — | $/1M output tokens |
| `GEMINI_PRICE_THINKING_PER_1M` | — | $/1M thinking tokens |

Vision mode uses a hardcoded 0.9 confidence threshold (not configurable via env) — reflects Gemini Vision's tendency to hallucinate.

---

## 18. Flag Taxonomy

Flags are stored in `Drawing.flags` as a JSON string array. They're the single source of truth for what happened during extraction.

### Pipeline Flags
| Flag | Meaning |
|------|---------|
| `ARCH_PRE_RESOLVED_FROM_SIBLING` | Architect inherited from another drawing in same project |
| `ARCH_FALLBACK_UNKNOWN` | Architect could not be resolved, used "Unknown (project X)" |
| `COVER_SHEET_FULL_PAGE` | Cover sheet detected by filename → full-page extraction used |
| `COVER_SHEET` | Drawing identified as cover sheet by content detection |
| `REGION_SPARSE` | Three-zone region scan returned < 5 elements |
| `SCANNED` | pdfplumber returned 0 elements |
| `VISION_FALLBACK` | Extraction used Gemini Vision instead of text |
| `VISION_RENDER_FAILED` | Could not render page image for Vision |
| `INPUT_TRUNCATED` | Elements array truncated before sending to Gemini |

### Revision Engine Flags (set by Gemini, stored in flags array)
| Flag | Meaning |
|------|---------|
| `TWO_TABLES_DETECTED` | Multiple revision tables found; most-data-rows/most-recent-date table used |
| `TABLE_NO_DATES` | Revision table exists but contains no valid dates; orientation used |
| `DATE_OVERRIDES_ORIENTATION` | Most-recent-date row differed from orientation row; date wins |
| `FIELD_FALLBACK_USED` | No table value found; title block REV field used |
| `REVISION_NUMBER_COLUMN_HEADER_ABSENT` | Leftmost non-date, non-description value used |
| `LATEST_ROW_HAS_BLANK_REVISION` | Latest row (by date) has blank REV cell; date returned, revision null |
| `LATEST_ROW_CONFIRMED_BY_DATE_ONLY` | Latest row confirmed by date only (no revision number in row) |
| `LATEST_ROW_CONFIRMED_BY_REVISION_NUMBER_ONLY` | Latest row confirmed by revision number only (no date) |

### Status Engine Flags (set by Gemini, stored in flags array)
| Flag | Meaning |
|------|---------|
| `LATEST_ROW_DESCRIPTION_EMPTY` | Priority 3 revision description fallback: description column empty |
| `LATEST_ROW_DESCRIPTION_IS_INITIALS` | Priority 3: description is 1–2 chars (initials); skipped |
| `SURVEY_DRAWING_NO_STATUS` | Survey drawing exception; status returned null |

### Validation Flags
| Flag | Meaning |
|------|---------|
| `DRAWING_NUMBER_INVALID` | Value looked like a title/sentence; nulled |
| `DATE_FORMAT_UNKNOWN` | Date couldn't be parsed; raw value kept with low confidence |
| `REVISION_DATE_NULLED_NO_REV_BLOCK` | Date returned but no revision block exists; nulled |
| `REVISION_CONFLICT` | Title block and revision block disagree on revision |
| `LOW_CONFIDENCE_<FIELD>` | Field confidence < threshold |
| `NEEDS_REVIEW` | Missing required fields |

### Cross-Validation Flags
| Flag | Meaning |
|------|---------|
| `STATUS_NOT_IN_TEXT` | Text mode: status value has no evidence in elements; nulled |
| `STATUS_LOW_CONFIDENCE_VISION` | Vision mode: status confidence < 0.9; nulled |
| `REVISION_DATE_NOT_IN_TEXT` | Text mode: date has no evidence; nulled |
| `REVISION_DATE_LOW_CONFIDENCE_VISION` | Vision mode: date confidence < 0.9; nulled |
| `REVISION_DATE_SUSPICIOUS` | `01/01/YYYY` pattern (likely creation date); nulled |
| `REVISION_DATE_CONFLICT_VISION` | Vision mode + revision conflict; can't verify; nulled |
| `REVISION_NOT_IN_TEXT` | Text mode: revision letter absent from elements; nulled |
| `DRAWING_NUMBER_NOT_IN_TEXT` | Text mode: drawing number absent; flagged only (not nulled) |
| `DRAWING_TITLE_NOT_IN_TEXT` | Text mode: no significant title word found; flagged |

### Error Flags
| Flag | Meaning |
|------|---------|
| `PDF_EXTRACTION_ERROR` | pdfplumber subprocess failed (includes timeout) |
| `GEMINI_API_ERROR` | Gemini API error (non-parse) |
| `GEMINI_PARSE_ERROR` | Gemini returned unparseable JSON |
| `EXTRACTION_ERROR` | Catch-all pipeline error |

---

## 19. Change Log

All material changes to the extraction approach recorded here.

---

### v2.1 — 2026-04-26

**Revision engine v2, status engine v2, cover sheet field extraction, drawing register, element sort overhaul**

**What changed**

1. **Large-font promotion in `capElements()`** — elements ≥14pt are sorted to the front of the Gemini input unconditionally (before proximity sort). Status stamps are always large font; this prevents them from being displaced past the 1500-element cap by dense body text regardless of position. `MAX_ELEMENTS` raised 500→1500 to accommodate large A0 three-zone extractions.

2. **Three-zone extraction** — bottom 45%/right 45% replaced with three discrete zones: full-width bottom 25%, right 25% full height, left 15%/bottom 30%. Deduplicated by (text + x + y). Cover sheets use full-page extraction.

3. **Revision master rule Steps 0–11** — complete rewrite replacing the previous 3-step hierarchy:
   - **Minimum 2 data rows** to qualify as a revision table. Single-row Rev+Date blocks are title block fields, not revision tables.
   - **Blank REV cell rule** — valid data row; skipped in sequence analysis but counted in total row count. If latest row has blank REV cell → return date, return null for revision, flag `LATEST_ROW_HAS_BLANK_REVISION`.
   - **Unconditional date comparison** — when dates exist, the most-recent-date row is always the latest revision row, regardless of orientation. Replaces `ORIENTATION_DATE_CONFLICT` with `DATE_OVERRIDES_ORIENTATION`. No longer falls through to title block field matching when dates are present.
   - **Mixed sequence recognition** — A B C…I C1 C2 is a valid ANZ construction sequence; single letters precede stage-prefixed codes. Never triggers Step 4-FALLBACK.
   - **Step 4-FALLBACK** fires only when zero valid dates exist in the table.

4. **Status engine Parts A–K** — complete rewrite replacing the previous 50-line status section:
   - **Part E — NOT-prefix guard** — scans 30pt vertical/100pt horizontal for "NOT" before accepting any value containing CONSTRUCTION, TENDER, APPROVAL, ISSUE, or PROCUREMENT. Prevents split-line "NOT FOR CONSTRUCTION" being misread as "FOR CONSTRUCTION".
   - **Part H — Unconditional revision description fallback** — when both Priority 1 (stamp) and Priority 2 (label) return nothing, and the latest revision row is confirmed by both number and date, the full description column text is returned exactly as written with no vocabulary match required. Eliminates dependency on a known-terms list for status captured in the revision description.
   - **Part I — Candidate comparison** — when a Priority 2 label value and a nearby stamp both exist, both are scored against the conflict priority tier table; the higher-scoring candidate wins. Prevents lower-tier label values (e.g. "SD" = tier 7) from overriding higher-tier nearby stamps (e.g. "ISSUE FOR REVIEW" = tier 6).

5. **Cover sheet field extraction** — removed the UI guard that suppressed all field values for cover sheets. Cover sheets now extract all five mandatory fields plus the `drawing_register` array from their title block, identical to any other drawing. `extractionStatus = "cover_sheet"` is set but fields are populated.

6. **Drawing register** — new DB column `Drawing.drawingRegister` (JSON string). When a cover sheet is detected, Gemini extracts a structured array of all rows from the drawing list table: `[{drawing_number, drawing_title, revision, revision_date, status}]`. Surfaced in the drawing detail UI below the five main fields.

7. **Template fast-path removed** — CROP mode, `TEMPLATE_FAST_PATH`, `CROP_EXPANDED`, and related flags are removed. All drawings use three-zone region extraction. Template records still exist for correction learning and context injection, but no longer control extraction crop bboxes.

**Why**

- A501 (24pt "FOR CONSTRUCTION" stamp): with old sort (proximity-only), the stamp ranked 1528/1724 and was cut off at the 1500 cap. Large-font promotion: rank 1 → correctly extracted as "Construction Issue" at 100% confidence.
- 7.pdf (SD label vs ISSUE FOR REVIEW stamp): old engine chose the SD label. Candidate comparison + NOT-prefix guard → "For Review" at 90% confidence.
- A.1093 (A/19/04/2023 vs C2/14/03/2024): blank REV cell in first row disrupted orientation; mixed C1/C2 sequence triggered wrong fallback. Three fixes → C2/14/03/2024 at 100% confidence, no conflict flags.
- E10 Level 6 (CONTRACT ISSUE in description, no status label/stamp): old Part H required vocabulary substring match — "CONTRACT ISSUE" not in list. Unconditional description rule → "CONTRACT ISSUE" at 95% confidence.

---

### v2.0 — 2026-04-23

**Evidence-based cross-validation, rotated PDF support, extraction rules audit trail, status split, PDF viewer rebuild**

**What changed**

1. **`crossValidateWithElements()` (new)** in `validate-extraction.ts`. Every field value must have textual evidence in the pdfplumber elements. Text-mode fields are nulled if missing; Vision-mode fields require ≥ 0.9 confidence. Suspicious `01/01/YYYY` dates are nulled. Vision + `REVISION_CONFLICT` nulls the date.

2. **Template bbox is a guide, not a boundary.** On every CROP_MODE extraction, the template bbox is expanded 300 points in the direction opposite the title block side (upward for bottom, leftward for right). This captures revision rows that grew outside the learned bbox. New flag: `CROP_EXPANDED`.

3. **Region extraction expanded** from bottom 25% + right 30% → **bottom 45% + right 45%** in `scripts/extract_text.py`. Prevents title-block cutoff on architect layouts with larger-than-typical title blocks.

4. **Rotated PDF support.** `scripts/extract_text.py` now reads `page.bbox` origin and translates between 0-based and internal PDF coordinates. Fixes `"Bounding box is not fully within parent page"` errors on rotated pages.

5. **Status canonical split.** `For Building Approval`, `For Building Permit`, and `For CDC Approval` are now three distinct canonical values (previously all collapsed into "For Building Approval"). Reflects legal distinction between NSW Complying Development Certificates, generic council approvals, and Building Permit Issues.

6. **Extraction Rules audit trail.** New DB column `Drawing.extractionRules` (JSON) records per-field source, transforms, raw value, canonical mapping, and validation outcome. Surfaced in the drawing detail UI as a dedicated "Extraction Rules" section.

7. **Date zero-padding fix.** `crossValidateWithElements` now generates all plausible date variants (padded/unpadded, `/` `.` `-` separators, 2-digit and 4-digit years, month names) before declaring a date absent. Eliminates false `REVISION_DATE_NOT_IN_TEXT` nullings when Gemini zero-pads but the PDF doesn't (or vice versa).

8. **`looksLikeDrawingNumber()` sanity filter.** Drawing numbers with newlines, > 30 chars, or > 2 spaces are rejected (they're titles, not numbers). Flag `DRAWING_NUMBER_INVALID`.

9. **`cleanDrawingTitle()`.** Multi-line titles have newlines collapsed to spaces, redundant whitespace stripped.

10. **System prompt strengthened** on DRAWING TITLE: explicit ban on including project name, client name, address, or any header above the drawing-specific title in the title block.

11. **PDF viewer rebuild.** Unrestricted pan after zoom (both axes, full page reach). Added drag-to-pan with mouse/trackpad. Replaced flexbox-centering layout that clipped the left edge at high zoom with `fit-content + min-width: 100%`.

12. **pdfplumber subprocess timeout** raised from 30s → 240s. A 29MB scanned PDF takes ~2 minutes to parse; 30s was causing false `PDF_EXTRACTION_ERROR` failures.

13. **`CANONICAL_STATUS` map** (hardcoded, exhaustive). DB `STATUS_NORMALISATION` rules are now a supplement for project-specific overrides, never an override of the hardcoded canonical values.

**Why**

The v1.x pipeline trusted Gemini output without verifying it existed in the source text. On scanned PDFs and drawings with empty revision blocks, Gemini would confidently hallucinate statuses and revision dates that weren't on the page. System prompts and validation rules could be overridden by strong contextual cues. Users had no visibility into which rules fired per field.

**Impact**

- Merrifield project (13 drawings): Rev was showing T2/T4/T1 because template crop cut off the C1 row at y=1068. After bbox expansion, all 13 drawings correctly show Rev C1 / 02/05/2024.
- Maxim Electrical project (10 scanned drawings): Before — 6/10 had hallucinated statuses, 5/10 had fake `01/01/2010` dates. After — 0/10 have hallucinated statuses, all suspicious dates correctly nulled.
- DD05.3 drawing: now correctly returns "For CDC Approval" instead of the misleading "For Building Approval".
- Zero false positives on text-based drawings — cross-validation only nulls values without textual evidence.

---

### v1.8 — 2026-04-05

**Revision Date sourcing rule — strict enforcement**

- Gemini system prompt: absolute ban on title-block date fields as `revision_date` source.
- `validate-extraction.ts`: hard enforcement — if `revision_block_location === "none"` and date non-null, null it + flag `REVISION_DATE_NULLED_NO_REV_BLOCK`.

---

### v1.7 — 2026-04-04

**Title block scoping enforcement**

- Removed `REGION_SPARSE_FALLBACK`. Full-page extraction no longer sent to Gemini under any circumstance.
- Clarified 5-field + 2-supporting taxonomy in the system prompt.

---

### v1.6 — 2026-04-04

**Bulk-apply strict PDF crop + bbox accuracy fixes**

- `bulk-apply-region` uses `pdfplumber --crop` (physical PDF crop) instead of in-memory bbox filter with margin — eliminates adjacent-field bleed.
- Cross-check counting scan retains 15px in-memory margin (counting only).
- Default `extractTextFromBbox` margin reduced 20px → 5px; overlap detection uses `x1` and `bottom`.
- pdfplumber now emits `x1` and `bottom` per word.
- `cross-check-region` uses Gemini Vision as primary; pdfplumber as fallback.
- Removed destructive `extractionStatus = "pending"` fallback in bulk-apply.

---

### v1.5 — 2026-04-04

**Vision fallback for scanned PDFs + pipeline parity**

- Added `renderPageAsImage()` + Pillow dependency + `extractWithGeminiVision()`.
- Vision fallback activates on 0 text elements. Flags: `VISION_FALLBACK`, `VISION_RENDER_FAILED`.
- `extract-all` rewritten to match `extract` (previously used full-page extraction).
- Added `confidenceLocation` column.
- Fixed `cross-check-region` env var (`GEMINI_API_KEY` → `GOOGLE_GEMINI_API_KEY`) and hardcoded model.

---

### v1.4 — 2026-04-04

**Status normalisation + template system fixes**

- `rules/system` upserts (previously crashed on first save).
- `rules` auto-seeds 30+ default STATUS_NORMALISATION mappings.
- Templates editable for `valueReplacements` + `learnedRules`.
- "Reset Corrections" button.

---

### v1.3 — 2026-04-03 (initial POC complete)

**Baseline architecture established**

- Next.js 16 + Prisma 7 + SQLite
- pdfplumber region extraction
- Gemini API structured output
- Architect resolution and pattern locking
- Template learning (fieldPositions, titleBlockPattern, valueReplacements)
- Status normalisation (`SystemRule`)
- Crop mode on pattern lock
- Manual region selection + bulk apply
- PDF viewer with selection overlay
- FinOps tracking (API cost per drawing)
