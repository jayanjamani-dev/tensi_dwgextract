#!/usr/bin/env python3
"""
pdfplumber text extraction script.
Usage:
  python3 extract_text.py <pdf_path> [page_index]   -> extract words from page (default: 0)
  python3 extract_text.py <pdf_path> --count         -> output {"page_count": N}

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


def extract(pdf_path, page_index=0):
    import pdfplumber

    elements = []
    with pdfplumber.open(pdf_path) as pdf:
        if not pdf.pages or page_index >= len(pdf.pages):
            print(json.dumps([]))
            return

        page = pdf.pages[page_index]
        page_width = float(page.width)
        page_height = float(page.height)

        words = page.extract_words(
            x_tolerance=3,
            y_tolerance=3,
            keep_blank_chars=False,
            use_text_flow=False,
            extra_attrs=["size", "fontname"]
        )

        for w in words:
            text = w.get("text", "").strip()
            if not text:
                continue
            elements.append({
                "text": text,
                "x": round(float(w.get("x0", 0)), 2),
                "y": round(float(w.get("top", 0)), 2),
                "size": round(float(w.get("size", 0)), 2),
                "page_width": page_width,
                "page_height": page_height,
            })

    print(json.dumps(elements))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: extract_text.py <pdf_path> [page_index|--count]"}), file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]

    if not os.path.exists(pdf_path):
        print(json.dumps({"error": f"File not found: {pdf_path}"}), file=sys.stderr)
        sys.exit(1)

    try:
        if len(sys.argv) >= 3 and sys.argv[2] == "--count":
            get_page_count(pdf_path)
        else:
            page_index = int(sys.argv[2]) if len(sys.argv) >= 3 else 0
            extract(pdf_path, page_index)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
