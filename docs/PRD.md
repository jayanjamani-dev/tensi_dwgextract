# Tensi Drawing Extraction — Product Requirements Document

**Product:** Tensi DWG Extract
**Platform:** Next.js 16 + Prisma 7 + SQLite
**Last updated:** 2026-04-05

---

## 1. Purpose

Tensi DWG Extract automates the extraction of structured metadata from construction drawing PDFs. It reduces manual data entry for document controllers by parsing the five core title block fields from each drawing and presenting them for review in a web UI.

---

## 2. Target Fields

The extraction pipeline targets exactly **five mandatory fields** and **two supporting fields** from each drawing's title block region.

### Mandatory (always extract)
| # | Field | DB Column | Notes |
|---|-------|-----------|-------|
| 1 | Drawing Number | `drawingNumber` | Unique identifier for the sheet |
| 2 | Drawing Title | `drawingTitle` | Sheet name/description |
| 3 | Revision | `revision` | Current revision letter or number |
| 4 | Revision Date | `revisionDate` | Date of the current revision (normalised DD/MM/YYYY) |
| 5 | Status | `status` | Issue purpose, e.g. "For Construction", "Tender" |

### Supporting (extract when present)
| # | Field | DB Column | Notes |
|---|-------|-----------|-------|
| 6 | Location | `location` | Site/project address |
| 7 | Architect Firm Name | _(template only)_ | Used for architect resolution and template learning |

---

## 3. Extraction Architecture

### 3.1 Input Scoping — pdfplumber Region Extraction

**Rule:** pdfplumber must ONLY extract text from the title block region. Full-page extraction is prohibited.

The title block region is defined as one of:
- **Region mode (default):** Bottom 25% of page + Right 30% of page (whichever has more text becomes the confirmed side)
- **Crop mode (pattern-locked):** Known bounding box `{x0, y0, x1, y1}` learned from prior confirmed drawings by the same architect
- **Vision mode (scanned PDFs):** Full page rendered as PNG → sent to Gemini Vision (no text layer available)

### 3.2 Extraction Modes

| Mode | Trigger | pdfplumber call | Gemini input |
|------|---------|-----------------|--------------|
| **Region** | Default (no locked pattern) | `--regions` → bottom 25% + right 30% | Scoped elements only |
| **Crop** | Architect has ≥ 2 confirmed drawings | `--crop x0 y0 x1 y1` | Elements from crop bbox only |
| **Vision** | Zero text elements (scanned PDF) | `--image [resolution]` → PNG | Base64 image of full page |
| **Crop+Vision** | Crop returns 0 elements | PNG render of crop region | Cropped image |

### 3.3 Pipeline Steps

```
PDF file
  │
  ├─ 1. pdfplumber extraction (scoped to title block region)
  │      ├─ Region mode OR Crop mode
  │      └─ Vision fallback if scanned (0 text elements)
  │
  ├─ 2. Cover sheet detection (skip non-drawing pages)
  │
  ├─ 3. Gemini inference
  │      Input: scoped JSON text elements OR base64 image
  │      Output: structured JSON with 7 fields + confidence scores
  │
  ├─ 4. Validation (confidence thresholds, format checks)
  │
  ├─ 5. Architect resolution + template learning
  │      └─ Pattern lock after 2 confirmed drawings
  │
  └─ 6. DB write (Drawing record updated)
```

### 3.4 Pattern Learning

After **2 confirmed drawings** from the same architect, the pipeline locks:
- Title block bounding box `{x0, y0, x1, y1}` (switches from region → crop mode)
- Confirmed title block side (`bottom` or `right`)
- Field coordinate positions (x, y per field)

Stored in: `Template.titleBlockPattern`, `Template.fieldPositions`

### 3.5 Manual Region Override (Cross-Check Region)

Users can manually draw a bounding box on the PDF viewer to correct a field value.

**Extraction priority:**
1. **Gemini Vision on canvas crop** (primary) — pixel-accurate, sees exactly what the user selected
2. **pdfplumber text layer** (fallback) — used only if Vision returns nothing

**Bulk apply:**
- Uses `pdfplumber --crop x0 y0 x1 y1` on each drawing — strict PDF crop, no margin
- No full-page fallback in bulk apply
- The triggering drawing's Vision-confirmed value is passed directly (`knownValue`)
- Cross-check scan of other drawings uses 15px margin in-memory (for match counting only, not value extraction)

---

## 4. Constraints

- Full-page pdfplumber extraction is **never** sent to the AI model
- Only title block region text is passed to Gemini
- Each field is extracted independently — no cross-field bleed
- Bulk-apply extraction uses PDF crop, not margin-based in-memory filtering
- The scanned PDF Vision fallback sends the full page image (no text layer exists to scope)

### 4.1 Revision Date / Revision Number Sourcing Rules

| Field | Source | Rule |
|-------|--------|------|
| `revision_date` | **Revision block only** | If the revision block is absent or empty, `revision_date` must be `null`. No title block date field may ever be mapped to `revision_date`. |
| `revision` | Revision block (primary), title block (fallback) | Use the revision block's most recent row. Fall back to the title block `Rev`/`Issue` field only if the revision block is absent. |

**Enforcement:**
- Gemini prompt contains an explicit ban on using title block date fields for `revision_date`, with no exceptions.
- `validate-extraction.ts` enforces this as a hard rule: if `revision_block_location === "none"` and `revision_date` is non-null, the date is nulled and the flag `REVISION_DATE_NULLED_NO_REV_BLOCK` is added.

**Rationale:** Title block date fields ("Date", "Date Drawn", "Issue Date") record the original drawing creation date, not the revision date. Conflating them produces incorrect revision history data and breaks compliance workflows.

---

## 5. Confidence Scoring

| Score | Meaning |
|-------|---------|
| 1.0 | Manually confirmed or bbox-override applied |
| 0.8–1.0 | High — clear label + unambiguous value |
| 0.6–0.8 | Medium — inferred from context |
| 0.4–0.6 | Low — best guess |
| 0.0 | Not found |

Threshold for flagging low-confidence fields: `CONFIDENCE_THRESHOLD` env var (default 0.7).

---

## 6. Key Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `GOOGLE_GEMINI_API_KEY` | _(required)_ | Gemini API authentication |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model used for extraction and Vision |
| `GEMINI_RATE_DELAY_MS` | `200` | Delay between Gemini calls in bulk extract |
| `CONFIDENCE_THRESHOLD` | `0.7` | Minimum confidence to suppress low-conf flag |
| `GEMINI_PRICE_INPUT_PER_1M` | — | Cost tracking for Pro model |
| `GEMINI_PRICE_OUTPUT_PER_1M` | — | Cost tracking for Pro model |
| `GEMINI_PRICE_THINKING_PER_1M` | — | Cost tracking for Pro model thinking tokens |

---

## 7. Key Files

| File | Role |
|------|------|
| `scripts/extract_text.py` | pdfplumber subprocess — region/crop/image modes |
| `src/lib/pdfplumber.ts` | Node wrapper for Python subprocess |
| `src/lib/gemini.ts` | Gemini API calls — text and Vision extraction |
| `src/lib/bbox-extraction.ts` | In-memory text element filtering by bounding box |
| `src/lib/templates.ts` | Architect resolution, pattern learning, template store |
| `src/lib/validate-extraction.ts` | Post-Gemini field validation and normalisation |
| `src/app/api/drawings/[id]/extract/route.ts` | Single drawing extraction pipeline |
| `src/app/api/projects/[id]/extract-all/route.ts` | Bulk extraction pipeline |
| `src/app/api/drawings/[id]/cross-check-region/route.ts` | Manual region selection + cross-check |
| `src/app/api/drawings/bulk-apply-region/route.ts` | Bulk field apply from manual region |

---

## 8. Change Log

All material changes to the extraction approach are recorded here with date and rationale.

---

### v1.8 — 2026-04-05

**Revision Date sourcing rule — strict enforcement**

**What changed:**
- Gemini system prompt (`gemini.ts`): The `REVISION DATE` section now contains an absolute sourcing ban. `revision_date` must come exclusively from the revision block. All title block date fields ("Date", "Date Drawn", "Issue Date", "Date Prepared", "Date of Issue", etc.) are explicitly prohibited as sources for `revision_date`. The previous soft "do not use" language has been replaced with an unambiguous hard rule with no exceptions.
- Gemini system prompt (`gemini.ts`): The `REVISION` section now clearly states the sourcing hierarchy: revision block is the primary source for the Revision Number; title block (`Rev`/`Issue` field) is a fallback used only when the revision block is absent.
- `validate-extraction.ts`: Added a hard enforcement rule — if `revision_block_location === "none"` (Gemini detected no revision block) and `revision_date` is non-null, the date is overwritten to `null`, `dateConfidence` is set to `0`, and the flag `REVISION_DATE_NULLED_NO_REV_BLOCK` is added. This catches any case where Gemini ignored the prompt and sourced a date from the title block.
- `docs/PRD.md` (§4.1): Added explicit field-sourcing rules table for `revision_date` and `revision`.

**Why:**
- Several drawings were returning a title block "Date Drawn" or "Issue Date" as the `revision_date`, producing incorrect revision history. The title block date records the original drawing creation date, not the current revision date.
- The previous prompt instruction ("do not use the title block's general Date field") was too soft and too easily overridden by strong spatial or contextual cues in the drawing data.

**Impact:**
- Drawings where the only date present is in the title block (no revision block) will now correctly return `null` for `revision_date` instead of a misleading title block date.
- Drawings with a populated revision block are unaffected — the revision date is still extracted from the revision block as intended.
- A new flag `REVISION_DATE_NULLED_NO_REV_BLOCK` surfaces when the safety net fires.

---

### v1.7 — 2026-04-04

**Title block scoping enforcement**

**What changed:**
- Removed `REGION_SPARSE_FALLBACK` from both `extract/route.ts` and `extract-all/route.ts`. Previously, when the region scan returned fewer than 5 elements, the pipeline fell back to `extractTextFromPdf` (full-page extraction) and sent the entire page's text to Gemini.
- Full-page extraction is now prohibited at all pipeline stages. If a region scan is sparse, the flag `REGION_SPARSE` is recorded and the pipeline proceeds with the sparse elements.
- Updated Gemini system prompt to accurately describe the input: scoped title block region text (bottom 25% or right 30%), not full-page text.
- Clarified the field taxonomy in the system prompt: 5 target fields (drawing_number, drawing_title, revision, revision_date, status) + 2 supporting fields (location, architect_firm_name).

**Why:**
- Full-page extraction caused Gemini to receive irrelevant text (general notes, specification text, drawing content) which degraded extraction accuracy and increased token usage.
- The design intent was always title-block-only extraction. The sparse fallback was a safety net that violated this constraint.

**Impact:**
- Drawings that previously triggered `REGION_SPARSE_FALLBACK` will now be flagged `REGION_SPARSE`. If their title block genuinely has fewer than 5 elements, extraction may return nulls — which is the correct behaviour (vs. hallucinating from full-page noise).
- Reduced token usage per extraction call.

---

### v1.6 — 2026-04-04

**Bulk-apply strict PDF crop + bbox accuracy fixes**

**What changed:**
- `bulk-apply-region` now uses `pdfplumber --crop x0 y0 x1 y1` (physical PDF crop) for each drawing instead of in-memory `extractTextFromBbox` with a 15px margin. This eliminates adjacent-field bleed (e.g. "AJ03 10 REV: NOV 7 ..." being returned for a Revision field that should return only "10").
- Cross-check scan of other drawings (for counting matches) retains 15px in-memory margin — acceptable because it's counting, not extracting values.
- `extractTextFromBbox` default margin reduced from 20px to 5px; overlap detection now uses element right-edge (`x1`) and bottom (`bottom`) fields when available.
- pdfplumber `extract_text.py` now emits `x1` and `bottom` for every word element.
- `cross-check-region` uses Gemini Vision on the canvas crop as **primary** extraction (not fallback). pdfplumber text layer is the fallback.
- Removed destructive `extractionStatus = "pending"` fallback in `bulk-apply-region` — skipped drawings are now silently skipped, preserving existing data.
- Vision-confirmed value (`knownValue`) for the triggering drawing passed directly to `bulk-apply-region`, avoiding re-extraction.

---

### v1.5 — 2026-04-04

**Vision fallback for scanned PDFs + pipeline parity**

**What changed:**
- Added `renderPageAsImage()` to `pdfplumber.ts` + `--image` mode to `extract_text.py` (uses `pdfplumber.page.to_image()` + Pillow).
- Added `extractWithGeminiVision()` to `gemini.ts` — sends full-page PNG to Gemini when text layer is absent.
- `extract/route.ts` and `extract-all/route.ts`: Vision fallback activates when `scanned = true` (0 text elements). Flag: `VISION_FALLBACK`. If rendering fails: `VISION_RENDER_FAILED`.
- `extract-all/route.ts` rewritten to use region mode (matching `extract/route.ts`) — previously used full-page extraction for all drawings.
- Added `confidenceLocation` to DB schema and validation pipeline.
- Fixed `cross-check-region` API key env var (`GEMINI_API_KEY` → `GOOGLE_GEMINI_API_KEY`) and hardcoded model → `GEMINI_MODEL`.

---

### v1.4 — 2026-04-04

**Status normalisation + template system fixes**

**What changed:**
- `rules/system/route.ts`: Changed `prisma.systemRule.update()` to `upsert()` — prevented crash on first save when no record existed.
- `rules/route.ts`: Auto-seeds 30+ default STATUS_NORMALISATION mappings on first GET.
- `templates/[id]/route.ts`: Added `valueReplacements` and `learnedRules` to updatable fields (supports null to clear).
- Added "Reset Corrections" button to templates page.
- Cleared corrupted `valueReplacements` data from Sgourakis Architects template (cross-field contamination from early experiments).

---

### v1.3 — 2026-04-03 (initial POC complete)

**Baseline architecture established**

- Next.js 16 App Router + Prisma 7 + SQLite
- pdfplumber region extraction (bottom 25% + right 30%)
- Gemini API extraction with structured JSON output schema
- Architect resolution and pattern locking (PATTERN_LOCK_THRESHOLD = 2)
- Template learning: `fieldPositions`, `titleBlockPattern`, `valueReplacements`
- Status normalisation matrix (`SystemRule` table)
- Crop mode extraction when pattern is locked
- Manual region selection (cross-check-region) with bulk apply
- PDF viewer with region selection overlay
- FinOps tracking (API call cost per drawing)
