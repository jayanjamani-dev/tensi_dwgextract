#!/usr/bin/env python3
"""
pdfplumber text extraction script.
Usage: python3 extract_text.py <pdf_path>
Outputs JSON array to stdout: [{text, x, y, size, page_width, page_height}]
Exit code 0 = success (even if no text found)
Exit code 1 = error (file not found, not a PDF, etc.)
"""

import sys
import json

def extract(pdf_path):
    import pdfplumber

    elements = []
    with pdfplumber.open(pdf_path) as pdf:
        if not pdf.pages:
            print(json.dumps([]))
            return

        page = pdf.pages[0]
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
        print(json.dumps({"error": "Usage: extract_text.py <pdf_path>"}), file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]

    import os
    if not os.path.exists(pdf_path):
        print(json.dumps({"error": f"File not found: {pdf_path}"}), file=sys.stderr)
        sys.exit(1)

    try:
        extract(pdf_path)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
