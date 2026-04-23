import { PrismaClient } from "./src/generated/prisma";

const prisma = new PrismaClient();

async function main() {
  const drawing = await prisma.drawing.findFirst({
    where: { filename: { contains: "Arch Combined 5" } }
  });
  
  if (!drawing) {
    console.log("No drawing found");
    return;
  }
  
  const raw = JSON.parse(drawing.pdfplumberRaw || "[]");
  console.log(`Found ${raw.length} elements in pdfplumberRaw caching for ${drawing.filename}`);
  if (raw.length > 0) {
    console.log("Sample elements:");
    // Find elements near the bottom right to see what coordinate space they are in
    const sortedByYDesc = [...raw].sort((a,b) => b.y - a.y);
    console.log("High Y elements (bottom of page?):", sortedByYDesc.slice(0, 5));
    
    // Find the word 'A.101' if it exists to see its coordinates
    const a101 = raw.filter((el: any) => el.text.includes("A.101") || el.text.includes("A.") || el.text.includes("101"));
    console.log("Elements containing 'A.101':", a101);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
