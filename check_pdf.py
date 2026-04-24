import pdfplumber
import sys
import os

def extract_all_text(pdf_path):
    print(f"\n{'='*60}")
    print(f"FILE: {os.path.basename(pdf_path)}")
    print(f"{'='*60}")

    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            print(f"\n--- PAGE {page_num + 1} ---")
            print(f"Page size: {page.width:.0f} x {page.height:.0f} points")

            words = page.extract_words(
                x_tolerance=3,
                y_tolerance=3,
                keep_blank_chars=False,
                use_text_flow=False,
                extra_attrs=["fontname", "size"]
            )

            print(f"Total text elements found: {len(words)}")
            print()

            if not words:
                print("⚠️  NO TEXT FOUND — likely fully rasterised/scanned PDF")
                continue

            import re
            date_patterns = [
                r'\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}',
                r'\d{4}[./\-]\d{2}[./\-]\d{2}',
                r'(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]\d{4}',
                r'\d{4}',
            ]

            print("--- DATE PATTERN SEARCH ---")
            date_hits = []
            for word in words:
                text = word.get('text', '')
                for pattern in date_patterns:
                    if re.search(pattern, text, re.IGNORECASE):
                        date_hits.append(word)
                        break

            if date_hits:
                print(f"Found {len(date_hits)} potential date elements:")
                for hit in date_hits:
                    print(f"  TEXT: '{hit['text']:<20}' | "
                          f"x0={hit['x0']:>6.1f} y0={hit['top']:>6.1f} | "
                          f"font={hit.get('fontname','?')} "
                          f"size={hit.get('size','?'):.1f}")
            else:
                print("⚠️  ZERO date patterns found in text layer")

            print()
            print("--- REVISION TERM SEARCH ---")
            revision_terms = [
                'rev', 'revision', 'issue', 'amendment', 'amend',
                'date', 'description', 'drawn', 'checked', 'approved'
            ]
            rev_hits = []
            for word in words:
                text = word.get('text', '').lower()
                for term in revision_terms:
                    if term in text:
                        rev_hits.append(word)
                        break

            if rev_hits:
                print(f"Found {len(rev_hits)} revision-related elements:")
                for hit in rev_hits:
                    print(f"  TEXT: '{hit['text']:<20}' | "
                          f"x0={hit['x0']:>6.1f} y0={hit['top']:>6.1f} | "
                          f"font={hit.get('fontname','?')} "
                          f"size={hit.get('size','?'):.1f}")
            else:
                print("⚠️  ZERO revision terms found in text layer")

            print()
            print("--- TITLE BLOCK ZONE (bottom 20% of page) ---")
            title_block_threshold = page.height * 0.80
            title_block_words = [w for w in words if w['top'] >= title_block_threshold]
            print(f"Text elements in bottom 20%: {len(title_block_words)}")
            for word in title_block_words:
                print(f"  TEXT: '{word['text']:<20}' | "
                      f"x0={word['x0']:>6.1f} y0={word['top']:>6.1f} | "
                      f"font={word.get('fontname','?')} "
                      f"size={word.get('size','?'):.1f}")

            print()
            print("--- VERTICAL STRIP ZONE (right 20% of page) ---")
            right_threshold = page.width * 0.80
            right_words = [w for w in words if w['x0'] >= right_threshold]
            print(f"Text elements in right 20%: {len(right_words)}")
            for word in right_words:
                print(f"  TEXT: '{word['text']:<20}' | "
                      f"x0={word['x0']:>6.1f} y0={word['top']:>6.1f} | "
                      f"font={word.get('fontname','?')} "
                      f"size={word.get('size','?'):.1f}")


def check_form_fields(pdf_path):
    print(f"\n--- FORM FIELDS CHECK ---")
    try:
        import pypdf
        reader = pypdf.PdfReader(pdf_path)
        fields = reader.get_fields()
        if fields:
            print(f"Found {len(fields)} form fields:")
            for name, field in fields.items():
                print(f"  Field: '{name}' = '{field.value}'")
        else:
            print("No form fields found")
    except ImportError:
        print("pypdf not installed — skipping form field check")
    except Exception as e:
        print(f"Form field check failed: {e}")


def check_annotations(pdf_path):
    print(f"\n--- ANNOTATIONS CHECK ---")
    try:
        import pypdf
        reader = pypdf.PdfReader(pdf_path)
        for page_num, page in enumerate(reader.pages):
            if "/Annots" in page:
                annots = page["/Annots"]
                print(f"Page {page_num + 1}: {len(annots)} annotations found")
                for annot in annots:
                    obj = annot.get_object()
                    print(f"  Type: {obj.get('/Subtype', '?')} | "
                          f"Contents: {obj.get('/Contents', '?')}")
            else:
                print(f"Page {page_num + 1}: No annotations")
    except ImportError:
        print("pypdf not installed — skipping annotation check")
    except Exception as e:
        print(f"Annotation check failed: {e}")


if __name__ == "__main__":
    pdf_files = sys.argv[1:] if len(sys.argv) > 1 else []
    if not pdf_files:
        print("Usage: python check_pdf.py <pdf_file> [pdf_file2] ...")
        sys.exit(1)
    for pdf_path in pdf_files:
        if not os.path.exists(pdf_path):
            print(f"File not found: {pdf_path}")
            continue
        extract_all_text(pdf_path)
        check_form_fields(pdf_path)
        check_annotations(pdf_path)
    print(f"\n{'='*60}")
    print("EXTRACTION COMPLETE")
    print(f"{'='*60}")
