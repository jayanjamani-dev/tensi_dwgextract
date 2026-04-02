import sqlite3, json

con = sqlite3.connect('dev.db')
con.row_factory = sqlite3.Row
cur = con.cursor()

print('=== ARCHITECTS ===')
architects = cur.execute('SELECT * FROM Architect').fetchall()
for a in architects:
    print(f"  id={dict(a)['id'][:8]}... firmName={dict(a)['firmName']}")

print()
print('=== TEMPLATES ===')
templates = cur.execute('SELECT * FROM Template').fetchall()
if not templates:
    print('  [NONE - template table is empty!]')
for t in templates:
    td = dict(t)
    pattern = json.loads(td['titleBlockPattern']) if td['titleBlockPattern'] else None
    print(f"  architectId={td['architectId'][:8]}...")
    print(f"  confirmedCount={pattern['confirmedDrawingCount'] if pattern else 'N/A'}")
    print(f"  side={pattern['side'] if pattern else 'N/A'}")
    print(f"  fieldPositions={'YES' if td['fieldPositions'] else 'NO'}")

print()
print('=== EXTRACTED DRAWINGS (sample 20) ===')
rows = cur.execute("""
  SELECT id, filename, extractionStatus, architectId, drawingNumber, titleBlockLocation, flags
  FROM Drawing 
  WHERE extractionStatus IN ('extracted','reviewed','published')
  LIMIT 20
""").fetchall()
print(f'Count: {len(rows)}')
for r in rows:
    rd = dict(r)
    flags = json.loads(rd['flags']) if rd['flags'] else []
    has_arch = rd['architectId'] is not None
    print(f"  {rd['filename'][:28]:28s} | drawingNum={str(rd['drawingNumber'] or ''):10s} | hasArch={has_arch} | loc={rd['titleBlockLocation']} | flags={','.join(flags)}")

print()
print('=== ARCHITECT LINKING SUMMARY ===')
c = cur.execute("SELECT COUNT(*) as cnt FROM Drawing WHERE architectId IS NULL").fetchone()
total = cur.execute("SELECT COUNT(*) as cnt FROM Drawing").fetchone()
print(f"  Drawings with no architect: {dict(c)['cnt']} / {dict(total)['cnt']}")

extracted_no_arch = cur.execute("""
  SELECT COUNT(*) as cnt FROM Drawing 
  WHERE architectId IS NULL AND extractionStatus IN ('extracted','reviewed','published')
""").fetchone()
print(f"  Extracted drawings with no architect: {dict(extracted_no_arch)['cnt']}")

con.close()
