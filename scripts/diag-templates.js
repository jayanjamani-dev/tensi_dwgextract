const path = require('path');
const { PrismaClient } = require(path.join(process.cwd(), 'src/generated/prisma'));
const p = new PrismaClient();

async function main() {
  // Check architects and templates
  const architects = await p.architect.findMany({
    include: {
      template: true,
      drawings: {
        select: {
          id: true,
          extractionStatus: true,
          architectId: true,
          drawingNumber: true,
          titleBlockLocation: true,
          flags: true,
        }
      }
    }
  });

  console.log('\n=== ARCHITECT TEMPLATE DIAGNOSTICS ===\n');
  for (const a of architects) {
    const extracted = a.drawings.filter(d => d.extractionStatus === 'extracted' || d.extractionStatus === 'reviewed' || d.extractionStatus === 'published');
    const withNumber = a.drawings.filter(d => d.drawingNumber);
    const pattern = a.template?.titleBlockPattern ? JSON.parse(a.template.titleBlockPattern) : null;

    console.log(`Architect: ${a.firmName} (${a.id})`);
    console.log(`  Template exists: ${!!a.template}`);
    console.log(`  Total drawings: ${a.drawings.length}`);
    console.log(`  Extracted drawings: ${extracted.length}`);
    console.log(`  Drawings with number: ${withNumber.length}`);
    if (pattern) {
      console.log(`  Pattern confirmedCount: ${pattern.confirmedDrawingCount}`);
      console.log(`  Pattern side: ${pattern.side}`);
      console.log(`  Pattern locked: ${pattern.confirmedDrawingCount >= 2}`);
    } else {
      console.log(`  No pattern stored`);
    }
    
    // Show flags for first 5 drawings
    for (const d of extracted.slice(0, 5)) {
      const flags = d.flags ? JSON.parse(d.flags) : [];
      console.log(`    Drawing ${d.id.slice(-6)}: number=${d.drawingNumber || 'NULL'}, flags=${flags.join(',') || 'none'}`);
    }
    console.log('');
  }

  // Check drawings without architect
  const drawingsNoArchitect = await p.drawing.count({ where: { architectId: null } });
  const drawingsTotal = await p.drawing.count();
  console.log(`=== DRAWINGS WITHOUT ARCHITECT: ${drawingsNoArchitect} / ${drawingsTotal} ===\n`);

  // Sample some drawings
  const samples = await p.drawing.findMany({
    take: 5,
    where: { architectId: null, extractionStatus: { in: ['extracted', 'reviewed'] }},
    select: { id: true, filename: true, drawingNumber: true, extractionStatus: true }
  });
  if (samples.length > 0) {
    console.log('Sample drawings with no architect:');
    for (const s of samples) {
      console.log(`  ${s.filename} - ${s.drawingNumber} (${s.extractionStatus})`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
