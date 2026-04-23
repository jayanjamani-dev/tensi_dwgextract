import { TextElement } from "./pdfplumber";

export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Extracts text from TextElements that overlap with a specified bounding box.
 *
 * Uses the element's right edge (x1) and bottom edge if available (from pdfplumber ≥ v2
 * extractions). Falls back to estimating from font size for older records.
 *
 * Default margin is 5px — tight enough to avoid adjacent title block columns while still
 * tolerating minor coordinate shifts between drawings from the same architect.
 */
export function extractTextFromBbox(
  elements: TextElement[],
  bbox: BoundingBox,
  marginPx = 5
): string | null {
  if (!elements || elements.length === 0) return null;

  const { x0, y0, x1, y1 } = bbox;

  const matched = elements.filter((el) => {
    // Determine the element's right and bottom edges.
    // If x1/bottom were stored by pdfplumber (new format), use them directly.
    // Otherwise estimate: assume each character is ~0.6× font-size wide, minimum 4px.
    const elX1 = el.x1 !== undefined && el.x1 > el.x
      ? el.x1
      : el.x + Math.max(el.size * 0.6 * Math.max(el.text.length, 1), 4);
    const elBottom = el.bottom !== undefined && el.bottom > el.y
      ? el.bottom
      : el.y + Math.max(el.size, 4);

    // Overlap test: element bbox must overlap with query bbox (plus small margin).
    const overlapX = el.x <= x1 + marginPx && elX1 >= x0 - marginPx;
    const overlapY = el.y <= y1 + marginPx && elBottom >= y0 - marginPx;

    return overlapX && overlapY;
  });

  if (matched.length === 0) return null;

  // Sort top-to-bottom, then left-to-right within the same visual line.
  matched.sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) < Math.max(a.size, b.size) * 0.5) {
      return a.x - b.x;
    }
    return yDiff;
  });

  // Join elements. Use newline when the next element is on a clearly different line.
  let resultText = "";
  let lastEl: TextElement | null = null;

  for (const el of matched) {
    if (!lastEl) {
      resultText = el.text;
    } else {
      const yDiff = Math.abs(el.y - lastEl.y);
      if (yDiff > Math.max(el.size, lastEl.size) * 0.8) {
        resultText += "\n" + el.text;
      } else {
        resultText += " " + el.text;
      }
    }
    lastEl = el;
  }

  const clean = resultText.trim();
  return clean.length > 0 ? clean : null;
}
