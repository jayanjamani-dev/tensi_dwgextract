-- Drop bbox-related columns from Template table.
-- titleBlockPattern stored the firm-specific crop bbox (no longer used —
-- replaced by universal three-zone extraction).
-- fieldPositions stored per-field coordinate overrides (no longer used).

-- SQLite does not support DROP COLUMN directly in older versions,
-- so we recreate the table without those two columns.

PRAGMA foreign_keys=OFF;

CREATE TABLE "Template_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "architectId" TEXT NOT NULL UNIQUE,
    "titleBlockLocation" TEXT,
    "revisionBlockLocation" TEXT,
    "revisionColumnOrder" TEXT,
    "revisionReadingDirection" TEXT,
    "fieldLabelMap" TEXT,
    "valueReplacements" TEXT,
    "learnedRules" TEXT,
    "sampleDrawingId" TEXT,
    "lastUpdated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "drawingNumberFormatDesc" TEXT,
    "drawingTitleConventions" TEXT,
    "revisionNumberFormat" TEXT,
    "revisionDateFormat" TEXT,
    "statusTerminology" TEXT,
    CONSTRAINT "Template_architectId_fkey" FOREIGN KEY ("architectId") REFERENCES "Architect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "Template_new" (
    "id", "architectId", "titleBlockLocation", "revisionBlockLocation",
    "revisionColumnOrder", "revisionReadingDirection", "fieldLabelMap",
    "valueReplacements", "learnedRules", "sampleDrawingId", "lastUpdated",
    "drawingNumberFormatDesc", "drawingTitleConventions", "revisionNumberFormat",
    "revisionDateFormat", "statusTerminology"
)
SELECT
    "id", "architectId", "titleBlockLocation", "revisionBlockLocation",
    "revisionColumnOrder", "revisionReadingDirection", "fieldLabelMap",
    "valueReplacements", "learnedRules", "sampleDrawingId", "lastUpdated",
    "drawingNumberFormatDesc", "drawingTitleConventions", "revisionNumberFormat",
    "revisionDateFormat", "statusTerminology"
FROM "Template";

DROP TABLE "Template";
ALTER TABLE "Template_new" RENAME TO "Template";

PRAGMA foreign_keys=ON;
