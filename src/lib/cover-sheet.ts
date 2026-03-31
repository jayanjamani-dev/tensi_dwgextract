import { TextElement } from "./pdfplumber";

const COVER_SHEET_TITLE_PATTERNS = [
  "cover sheet",
  "drawing index",
  "drawing register",
  "drawing list",
  "schedule of drawings",
  "legend of symbols",
  "general notes",
  "drawing schedule",
  "sheet index",
];

// Common cover sheet drawing number patterns (often no meaningful drawing number)
const COVER_SHEET_NUMBER_PATTERNS = /^(0\.A000|A0{3,4}|M0{3,4}|A000|M000)$/i;

// Patterns suggesting a drawing list table (column headers for a register)
const REGISTER_COLUMN_PATTERNS = ["drawing number", "sheet number", "sheet name", "sheet title", "drawing title", "drg no", "dwg no"];

export function detectCoverSheet(
  elements: TextElement[],
  filename?: string
): boolean {
  const allText = elements.map((e) => e.text.toLowerCase()).join(" ");
  const allTextsLower = elements.map((e) => e.text.toLowerCase());

  let signalCount = 0;

  // Signal 1: Title contains cover sheet / drawing index patterns
  for (const pattern of COVER_SHEET_TITLE_PATTERNS) {
    if (allText.includes(pattern)) {
      signalCount++;
      break;
    }
  }

  // Signal 2: Drawing number matches typical cover sheet numbers
  // Look for drawing number near label "Drawing No" or similar
  const drawingNumberLabelIdx = allTextsLower.findIndex(
    (t) =>
      t === "drawing" ||
      t === "drg" ||
      t === "dwg" ||
      t.includes("dwg no") ||
      t.includes("drg no") ||
      t.includes("drawing no")
  );
  if (drawingNumberLabelIdx !== -1) {
    // Look at nearby elements for the value
    const nearby = elements.slice(
      Math.max(0, drawingNumberLabelIdx - 2),
      drawingNumberLabelIdx + 5
    );
    for (const el of nearby) {
      if (COVER_SHEET_NUMBER_PATTERNS.test(el.text.trim())) {
        signalCount++;
        break;
      }
    }
  }

  // Signal 3: Contains register-like column headers (drawing list table)
  let registerColumnHits = 0;
  for (const col of REGISTER_COLUMN_PATTERNS) {
    if (allText.includes(col)) registerColumnHits++;
  }
  if (registerColumnHits >= 2) signalCount++;

  // Signal 4: Filename hints
  if (filename) {
    const fn = filename.toLowerCase();
    if (
      fn.includes("cover") ||
      fn.includes("index") ||
      fn.includes("register") ||
      fn.includes("a000") ||
      fn.includes("m000") ||
      fn.includes("a0000")
    ) {
      signalCount++;
    }
  }

  return signalCount >= 2;
}
