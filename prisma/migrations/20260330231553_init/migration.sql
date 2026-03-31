-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Architect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "firmName" TEXT NOT NULL,
    "firmAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Drawing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "architectId" TEXT,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "Correction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "drawingId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "originalValue" TEXT,
    "correctedValue" TEXT,
    "correctedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Correction_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "architectId" TEXT NOT NULL,
    "titleBlockLocation" TEXT,
    "revisionBlockLocation" TEXT,
    "revisionColumnOrder" TEXT,
    "revisionReadingDirection" TEXT,
    "fieldLabelMap" TEXT,
    "sampleDrawingId" TEXT,
    "lastUpdated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Template_architectId_fkey" FOREIGN KEY ("architectId") REFERENCES "Architect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Template_architectId_key" ON "Template"("architectId");
