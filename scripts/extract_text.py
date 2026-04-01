#!/usr/bin/env python3
"""
pdfplumber text extraction script.
Usage:
  python3 extract_text.py <pdf_path> [page_index]      -> extract words from page (default: 0)
  python3 extract_text.py <pdf_path> --count            -> output {"page_count": N}
  python3 extract_text.py <pdf_path> <page_index> --regions
      -> extract from bottom strip (bottom 25%) + right column (right 30%) only
  python3 extract_text.py <pdf_path> <page_index> --crop <x0> <y0> <x1> <y1>
      -> extract from a fixed bounding box

Outputs JSON to stdout.
Exit code 0 = success, Exit code 1 = error
"""

import sys
import json
import os


def get_page_count(pdf_path):
    import pdfplumber
    with pdfplumber.open(pdf_path) as pdf:
        print(json.dumps({"page_count": len(pdf.pages)}))


def _extract_words(page):
    """Extract words from a pdfplumber page object."""
    return page.extract_words(
        x_tolerance=3,
        y_tolerance=3,
        keep_blank_chars=False,
        use_text_flow=False,
        extra_attrs=["size", "fontname"]
    )


def _words_to_elements(words, page_width, page_height, region=None):
    """Convert pdfplumber word dicts to our element format."""
    elements = []
    for w in words:
        text = w.get("text", "").strip()
        if not text:
            continue
        el = {
            "text": text,
            "x": round(float(w.get("x0", 0)), 2),
            "y": round(float(w.get("top", 0)), 2),
            "size": round(float(w.get("size", 0)), 2),
            "page_width": page_width,
            "page_height": page_height,
        }
        if region:
            el["region"] = region
        elements.append(el)
    return elements


def extract(pdf_path, page_index=0):
    """Full-page extraction (original behaviour)."""
    import pdfplumber

    elements = []
    with pdfplumber.open(pdf_path) as pdf:
        if not pdf.pages or page_index >= len(pdf.pages):
            print(json.dumps([]))
            return

        page = pdf.pages[page_index]
        page_width = float(page.width)
        page_height = float(page.height)

        words = _extract_words(page)
        elements = _words_to_elements(words, page_width, page_height)

    print(json.dumps(elements))


def extract_regions(pdf_path, page_index=0):
    """Extract from bottom strip (bottom 25%) + right column (right 30%) only.

    Returns JSON:
    {
      "elements": [...],
      "page_width": float,
      "page_height": float,
      "title_block_side": "bottom" | "right" | "unknown",
      "bottom_bbox": [x0, y0, x1, y1],
      "right_bbox": [x0, y0, x1, y1]
    }
    """
    import pdfplumber

    with pdfplumber.open(pdf_path) as pdf:
        if not pdf.pages or page_index >= len(pdf.pages):
            print(json.dumps({
                "elements": [],
                "page_width": 0,
                "page_height": 0,
                "title_block_side": "unknown",
                "bottom_bbox": [0, 0, 0, 0],
                "right_bbox": [0, 0, 0, 0],
            }))
            return

        page = pdf.pages[page_index]
        pw = float(page.width)
        ph = float(page.height)

        # Bottom strip: bottom 25% of page, full width
        bottom_y0 = ph * 0.75
        bottom_bbox = (0, bottom_y0, pw, ph)
        bottom_crop = page.crop(bottom_bbox)
        bottom_words = _extract_words(bottom_crop)
        bottom_elements = _words_to_elements(bottom_words, pw, ph, region="bottom")

        # Right column: right 30% of page, full height
        right_x0 = pw * 0.70
        right_bbox = (right_x0, 0, pw, ph)
        right_crop = page.crop(right_bbox)
        right_words = _extract_words(right_crop)
        right_elements = _words_to_elements(right_words, pw, ph, region="right")

        # Determine which region has more text → likely title block side
        bottom_count = len(bottom_elements)
        right_count = len(right_elements)

        if bottom_count == 0 and right_count == 0:
            side = "unknown"
        elif bottom_count >= right_count:
            side = "bottom"
        else:
            side = "right"

        # Merge elements (deduplicated — some elements may appear in both regions)
        seen = set()
        merged = []
        for el in bottom_elements + right_elements:
            key = (el["text"], el["x"], el["y"])
            if key not in seen:
                seen.add(key)
                merged.append(el)

        result = {
            "elements": merged,
            "page_width": pw,
            "page_height": ph,
            "title_block_side": side,
            "bottom_bbox": [0, round(bottom_y0, 2), round(pw, 2), round(ph, 2)],
            "right_bbox": [round(right_x0, 2), 0, round(pw, 2), round(ph, 2)],
        }
        print(json.dumps(result))


def extract_crop(pdf_path, page_index, x0, y0, x1, y1):
    """Extract from a fixed bounding box.

    Returns JSON:
    {
      "elements": [...],
      "page_width": float,
      "page_height": float,
      "crop_bbox": [x0, y0, x1, y1]
    }
    """
    import pdfplumber

    with pdfplumber.open(pdf_path) as pdf:
        if not pdf.pages or page_index >= len(pdf.pages):
            print(json.dumps({
                "elements": [],
                "page_width": 0,
                "page_height": 0,
                "crop_bbox": [x0, y0, x1, y1],
            }))
            return

        page = pdf.pages[page_index]
        pw = float(page.width)
        ph = float(page.height)

        # Clamp bbox to page bounds
        cx0 = max(0, min(x0, pw))
        cy0 = max(0, min(y0, ph))
        cx1 = max(cx0, min(x1, pw))
        cy1 = max(cy0, min(y1, ph))

        cropped = page.crop((cx0, cy0, cx1, cy1))
        words = _extract_words(cropped)
        elements = _words_to_elements(words, pw, ph)

        result = {
            "elements": elements,
            "page_width": pw,
            "page_height": ph,
            "crop_bbox": [round(cx0, 2), round(cy0, 2), round(cx1, 2), round(cy1, 2)],
        }
        print(json.dumps(result))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: extract_text.py <pdf_path> [page_index|--count] [--regions|--crop x0 y0 x1 y1]"}), file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]

    if not os.path.exists(pdf_path):
        print(json.dumps({"error": f"File not found: {pdf_path}"}), file=sys.stderr)
        sys.exit(1)

    try:
        if len(sys.argv) >= 3 and sys.argv[2] == "--count":
            get_page_count(pdf_path)
        elif "--regions" in sys.argv:
            # extract_text.py <pdf_path> <page_index> --regions
            page_index = 0
            for i, arg in enumerate(sys.argv[2:], start=2):
                if arg == "--regions":
                    break
                page_index = int(arg)
            extract_regions(pdf_path, page_index)
        elif "--crop" in sys.argv:
            # extract_text.py <pdf_path> <page_index> --crop x0 y0 x1 y1
            crop_idx = sys.argv.index("--crop")
            page_index = int(sys.argv[2]) if crop_idx > 2 else 0
            x0 = float(sys.argv[crop_idx + 1])
            y0 = float(sys.argv[crop_idx + 2])
            x1 = float(sys.argv[crop_idx + 3])
            y1 = float(sys.argv[crop_idx + 4])
            extract_crop(pdf_path, page_index, x0, y0, x1, y1)
        else:
            page_index = int(sys.argv[2]) if len(sys.argv) >= 3 else 0
            extract(pdf_path, page_index)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
