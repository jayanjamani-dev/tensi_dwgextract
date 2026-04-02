import { prisma } from "../src/lib/db";

const STATUS_NORMALISATION: Record<string, string> = {
  "preliminary issue": "Preliminary Issue",
  "preliminary": "Preliminary Issue",
  "prelim": "Preliminary Issue",
  "tender issue": "Tender Issue",
  "for tender": "Tender Issue",
  "tender documentation": "Tender Issue",
  "tender review": "Tender Issue",
  "construction issue": "Construction Issue",
  "issued for construction": "Construction Issue",
  "for construction": "Construction Issue",
  "construction": "Construction Issue",
  "for pricing": "For Pricing",
  "not for construction": "Not for Construction",
  "for building approval": "For Building Approval",
  "bpa": "For Building Approval",
  "building permit issue": "For Building Approval",
  "for review": "For Review",
  "for comment": "For Review",
  "coordination issue": "Coordination Issue",
  "design development": "Design Development",
  "superseded": "Superseded",
  "cancelled": "Cancelled",
  "void": "Cancelled",
  "drawing issue": "Construction Issue",
};

async function main() {
  const existing = await prisma.systemRule.findUnique({
    where: { ruleType: "STATUS_NORMALISATION" },
  });

  if (!existing) {
    await prisma.systemRule.create({
      data: {
        ruleType: "STATUS_NORMALISATION",
        content: JSON.stringify(STATUS_NORMALISATION),
        description: "Global mapping for extracted status strings to canonical status strings",
      },
    });
    console.log("Seeded STATUS_NORMALISATION");
  } else {
    console.log("STATUS_NORMALISATION already seeded");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
