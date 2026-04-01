import { prisma } from "./src/lib/db";

async function main() {
  try {
    const projects = await prisma.project.findMany();
    console.log("Success:", projects);
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
