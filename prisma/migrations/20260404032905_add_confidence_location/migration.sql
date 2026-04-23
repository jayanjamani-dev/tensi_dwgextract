-- AlterTable
ALTER TABLE "Drawing" ADD COLUMN "confidenceLocation" REAL;

-- AlterTable
ALTER TABLE "Template" ADD COLUMN "fieldPositions" TEXT;
ALTER TABLE "Template" ADD COLUMN "learnedRules" TEXT;
ALTER TABLE "Template" ADD COLUMN "titleBlockPattern" TEXT;
ALTER TABLE "Template" ADD COLUMN "valueReplacements" TEXT;

-- CreateTable
CREATE TABLE "SystemRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "description" TEXT,
    "lastUpdated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Correction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "drawingId" TEXT NOT NULL,
    "architectId" TEXT,
    "fieldName" TEXT NOT NULL,
    "originalValue" TEXT,
    "correctedValue" TEXT,
    "pattern" TEXT,
    "correctedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Correction_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Correction_architectId_fkey" FOREIGN KEY ("architectId") REFERENCES "Architect" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Correction" ("correctedAt", "correctedValue", "drawingId", "fieldName", "id", "originalValue") SELECT "correctedAt", "correctedValue", "drawingId", "fieldName", "id", "originalValue" FROM "Correction";
DROP TABLE "Correction";
ALTER TABLE "new_Correction" RENAME TO "Correction";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SystemRule_ruleType_key" ON "SystemRule"("ruleType");
