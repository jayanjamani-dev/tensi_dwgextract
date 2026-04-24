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


def _page_origin(page):
    """Return the (x0, y0) origin of a page's internal coordinate system.

    For non-rotated pages this is always (0, 0). For rotated or offset pages
    pdfplumber exposes the raw PDF MediaBox / CropBox which may have a non-zero
    origin. All element coordinates from extract_words() are in the internal
    system, so we subtract the origin to produce consistent 0-based coordinates.
    """
    bbox = page.bbox  # (x0, y0, x1, y1) in internal PDF coords
    return float(bbox[0]), float(bbox[1])


def _words_to_elements(words, page_width, page_height, region=None, px0=0.0, py0=0.0):
    """Convert pdfplumber word dicts to our element format.

    px0/py0: page origin offset (from _page_origin). Subtracted from every
    coordinate so the output is always in 0-based page space regardless of
    whether the PDF has a rotation or non-zero MediaBox origin.
    """
    elements = []
    for w in words:
        text = w.get("text", "").strip()
        if not text:
            continue
        el = {
            "text": text,
            "x":      round(float(w.get("x0",     0)) - px0, 2),
            "y":      round(float(w.get("top",     0)) - py0, 2),
            "x1":     round(float(w.get("x1",      0)) - px0, 2),
            "bottom": round(float(w.get("bottom",  0)) - py0, 2),
            "size":   round(float(w.get("size",    0)), 2),
            "page_width":  page_width,
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
        page_width  = float(page.width)
        page_height = float(page.height)
        px0, py0 = _page_origin(page)

        words = _extract_words(page)
        elements = _words_to_elements(words, page_width, page_height, px0=px0, py0=py0)

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
        px0, py0 = _page_origin(page)  # internal page origin

        # Convert 0-based fractions to internal page coordinates for cropping
        # Bottom strip: bottom 45% of page, full width
        # Expanded from 25% to 45% to ensure full revision block + title block captured
        # regardless of architect-specific layout variations.
        bottom_norm_y0 = ph * 0.55                            # 0-based
        bottom_bbox_internal = (px0,             py0 + bottom_norm_y0,
                                px0 + pw,        py0 + ph)
        bottom_crop = page.crop(bottom_bbox_internal)
        bottom_words = _extract_words(bottom_crop)
        bottom_elements = _words_to_elements(
            bottom_words, pw, ph, region="bottom", px0=px0, py0=py0)

        # Right column: right 45% of page, full height
        # Expanded from 30% to 45% for right-side title blocks.
        right_norm_x0 = pw * 0.55                             # 0-based
        right_bbox_internal = (px0 + right_norm_x0, py0,
                               px0 + pw,            py0 + ph)
        right_crop = page.crop(right_bbox_internal)
        right_words = _extract_words(right_crop)
        right_elements = _words_to_elements(
            right_words, pw, ph, region="right", px0=px0, py0=py0)

        # Determine which region has more text → likely title block side
        bottom_count = len(bottom_elements)
        right_count  = len(right_elements)

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
            "page_width":  pw,
            "page_height": ph,
            "title_block_side": side,
            "bottom_bbox": [0, round(bottom_norm_y0, 2), round(pw, 2), round(ph, 2)],
            "right_bbox":  [round(right_norm_x0, 2), 0,  round(pw, 2), round(ph, 2)],
        }
        print(json.dumps(result))


def extract_crop(pdf_path, page_index, x0, y0, x1, y1):
    """Extract from a fixed bounding box plus permanent supplemental zones.

    Input coordinates (x0, y0, x1, y1) are in 0-based page space — i.e. origin
    at top-left with x in [0, page_width] and y in [0, page_height].  This
    matches how template bboxes are stored regardless of PDF rotation.

    Three zones are always extracted and merged (deduplicated):
      1. Template crop bbox  — the locked title block area
      2. Full-width bottom 25% strip — captures left-side revision tables
         (e.g. Wanda Terraces: revision table at x≈650, title stamp at x>1668)
      3. Full-height right 25% strip — captures right-side title blocks and
         revision blocks for firms like O'Neill, Cera Stribley, Ascot, MAC
         where the title block runs the full height of the right margin

    All zones are unconditional. Deduplication is always applied so text in
    overlapping zones is never sent to Gemini twice.

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
        px0, py0 = _page_origin(page)  # internal page origin

        # Clamp 0-based input coords to valid page dimensions
        nx0 = max(0.0, min(float(x0), pw))
        ny0 = max(0.0, min(float(y0), ph))
        nx1 = max(nx0,  min(float(x1), pw))
        ny1 = max(ny0,  min(float(y1), ph))

        # Translate from 0-based space to internal page coordinate space
        cx0 = px0 + nx0
        cy0 = py0 + ny0
        cx1 = px0 + nx1
        cy1 = py0 + ny1

        # Zone 1: template crop bbox
        crop_words = _extract_words(page.crop((cx0, cy0, cx1, cy1)))
        crop_elements = _words_to_elements(crop_words, pw, ph, region="crop", px0=px0, py0=py0)

        # Zone 2: full-width bottom 25% strip (always)
        # Captures revision tables positioned anywhere horizontally in the lower page area.
        bottom_y0 = ph * 0.75
        bottom_words = _extract_words(page.crop((px0, py0 + bottom_y0, px0 + pw, py0 + ph)))
        bottom_elements = _words_to_elements(bottom_words, pw, ph, region="bottom_supp", px0=px0, py0=py0)

        # Zone 3: full-height right 25% strip (always)
        # Captures right-margin title blocks that span the full page height.
        right_x0 = pw * 0.75
        right_words = _extract_words(page.crop((px0 + right_x0, py0, px0 + pw, py0 + ph)))
        right_elements = _words_to_elements(right_words, pw, ph, region="right_supp", px0=px0, py0=py0)

        # Merge all zones with deduplication — always applied
        seen = set()
        merged = []
        for el in crop_elements + bottom_elements + right_elements:
            key = (el["text"], round(el["x"], 1), round(el["y"], 1))
            if key not in seen:
                seen.add(key)
                merged.append(el)

        result = {
            "elements": merged,
            "page_width":  pw,
            "page_height": ph,
            "crop_bbox": [round(nx0, 2), round(ny0, 2), round(nx1, 2), round(ny1, 2)],
        }
        print(json.dumps(result))


def render_page(pdf_path, page_index=0, resolution=150):
    """Render a PDF page to a base64-encoded PNG for Gemini Vision fallback.

    Returns JSON:
    {
      "image_base64": "...",
      "width": int,
      "height": int
    }
    """
    import pdfplumber
    import io
    import base64

    with pdfplumber.open(pdf_path) as pdf:
        if not pdf.pages or page_index >= len(pdf.pages):
            print(json.dumps({"error": f"Page {page_index} not found in PDF"}), file=sys.stderr)
            sys.exit(1)

        page = pdf.pages[page_index]
        try:
            img = page.to_image(resolution=resolution)
        except Exception as e:
            print(json.dumps({"error": f"Image rendering failed: {str(e)}. Try: pip install Pillow"}), file=sys.stderr)
            sys.exit(1)

        buf = io.BytesIO()
        img.original.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        print(json.dumps({
            "image_base64": b64,
            "width":  img.original.width,
            "height": img.original.height,
        }))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: extract_text.py <pdf_path> [page_index|--count] [--regions|--crop x0 y0 x1 y1|--image [resolution]]"}), file=sys.stderr)
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
        elif "--image" in sys.argv:
            # extract_text.py <pdf_path> <page_index> --image [resolution]
            img_idx = sys.argv.index("--image")
            page_index = int(sys.argv[2]) if img_idx > 2 else 0
            resolution = int(sys.argv[img_idx + 1]) if img_idx + 1 < len(sys.argv) else 150
            render_page(pdf_path, page_index, resolution)
        else:
            page_index = int(sys.argv[2]) if len(sys.argv) >= 3 else 0
            extract(pdf_path, page_index)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
