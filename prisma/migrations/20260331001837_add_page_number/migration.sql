-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Drawing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "architectId" TEXT,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL DEFAULT 0,
    "drawingNumber" TEXT,
    "drawingTitle" TEXT,
    "revision" TEXT,
    "revisionDate" TEXT,
    "status" TEXT,
    "confidenceDrawingNumber" REAL,
    "confidenceDrawingTitle" REAL,
    "confidenceRevision" REAL,
    "confidenceRevisionDate" REAL,
    "confidenceStatus" REAL,
    "conflictDetected" BOOLEAN NOT NULL DEFAULT false,
    "conflictDetail" TEXT,
    "documentType" TEXT,
    "titleBlockLocation" TEXT,
    "revisionBlockLocation" TEXT,
    "extractionModel" TEXT,
    "pdfplumberRaw" TEXT,
    "flags" TEXT,
    "notes" TEXT,
    "extractionStatus" TEXT NOT NULL DEFAULT 'pending',
    "extractedAt" DATETIME,
    "reviewedAt" DATETIME,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Drawing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Drawing_architectId_fkey" FOREIGN KEY ("architectId") REFERENCES "Architect" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Drawing" ("architectId", "confidenceDrawingNumber", "confidenceDrawingTitle", "confidenceRevision", "confidenceRevisionDate", "confidenceStatus", "conflictDetail", "conflictDetected", "createdAt", "documentType", "drawingNumber", "drawingTitle", "extractedAt", "extractionModel", "extractionStatus", "filename", "filepath", "flags", "id", "notes", "pdfplumberRaw", "projectId", "publishedAt", "reviewedAt", "revision", "revisionBlockLocation", "revisionDate", "status", "titleBlockLocation") SELECT "architectId", "confidenceDrawingNumber", "confidenceDrawingTitle", "confidenceRevision", "confidenceRevisionDate", "confidenceStatus", "conflictDetail", "conflictDetected", "createdAt", "documentType", "drawingNumber", "drawingTitle", "extractedAt", "extractionModel", "extractionStatus", "filename", "filepath", "flags", "id", "notes", "pdfplumberRaw", "projectId", "publishedAt", "reviewedAt", "revision", "revisionBlockLocation", "revisionDate", "status", "titleBlockLocation" FROM "Drawing";
DROP TABLE "Drawing";
ALTER TABLE "new_Drawing" RENAME TO "Drawing";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
