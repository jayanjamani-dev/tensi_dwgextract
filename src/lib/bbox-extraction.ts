import { TextElement } from "./pdfplumber";

export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Extracts text from a collection of TextElements that fall within a specified bounding box.
 * Includes a margin of error (+/- 10px by default) to account for slight shifts in drawings.
 */
export function extractTextFromBbox(
  elements: TextElement[],
  bbox: BoundingBox,
  marginPx = 20
): string | null {
  if (!elements || elements.length === 0) return null;

  const { x0, y0, x1, y1 } = bbox;

  // Filter elements that fall within the expanded bounding box
  const matched = elements.filter((el) => {
    // If the element's start x/y is inside our bounding box (plus margin), we include it.
    // Note: We don't have exact element width, so we rely on the starting x coordinate
    // and rely on the fact that pdfplumber generally breaks words or lines into discrete elements.
    return (
      el.x >= x0 - marginPx &&
      el.x <= x1 + marginPx &&
      el.y >= y0 - marginPx &&
      el.y <= y1 + marginPx
    );
  });

  if (matched.length === 0) return null;

  // Sort them loosely by Y (top-to-bottom) then by X (left-to-right) to ensure readable reading order
  // We use a tolerance for Y to group words on the same visual line together
  matched.sort((a, b) => {
    const yDiff = a.y - b.y;
    // If they are on roughly the same line (within half the average font size), sort by X
    if (Math.abs(yDiff) < Math.max(a.size, b.size) * 0.5) {
      return a.x - b.x;
    }
    return yDiff;
  });

  // Combine text. Wait, we should probably just join with space. If Y is quite different, join with a newline?
  let resultText = "";
  let lastEl: TextElement | null = null;

  for (const el of matched) {
    if (!lastEl) {
      resultText = el.text;
    } else {
      const yDiff = Math.abs(el.y - lastEl.y);
      // New line if y difference is significant
      if (yDiff > Math.max(el.size, lastEl.size) * 0.8) {
        resultText += "\n" + el.text;
      } else {
        // Space if x difference suggests a space (x diff is wider than a simple contiguous character)
        // If elements are extremely close, they might be part of the same word that was split.
        // As a heuristic, we'll join with a space.
        resultText += " " + el.text;
      }
    }
    lastEl = el;
  }

  // Remove trailing/leading spaces and return
  const clean = resultText.trim();
  return clean.length > 0 ? clean : null;
}
