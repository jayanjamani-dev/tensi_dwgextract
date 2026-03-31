-- AlterTable
ALTER TABLE "Drawing" ADD COLUMN "pdfplumberTimeMs" INTEGER;
ALTER TABLE "Drawing" ADD COLUMN "processingTimeMs" INTEGER;
ALTER TABLE "Drawing" ADD COLUMN "totalCostUsd" REAL;
ALTER TABLE "Drawing" ADD COLUMN "totalInputTokens" INTEGER;
ALTER TABLE "Drawing" ADD COLUMN "totalOutputTokens" INTEGER;

-- CreateTable
CREATE TABLE "ApiCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "drawingId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "callType" TEXT NOT NULL DEFAULT 'extract',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "thinkingTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiCall_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
