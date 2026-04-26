"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";

const PDFViewer = dynamic(() => import("@/components/PDFViewer"), { ssr: false });

interface FieldCoordinate {
  x: number;
  y: number;
}

interface ExtractionFieldRule {
  source?: string;
  blockLocation?: string;
  transforms: string[];
  validation: "passed" | "failed" | "flagged";
  rawValue?: string;
  normalisedFormat?: string;
  canonical?: string;
}

interface DrawingRegisterEntry {
  drawing_number: string | null;
  drawing_title:  string | null;
  revision:       string | null;
  revision_date:  string | null;
  status:         string | null;
}

interface ExtractionRules {
  drawingNumber: ExtractionFieldRule;
  drawingTitle:  ExtractionFieldRule;
  revision:      ExtractionFieldRule;
  revisionDate:  ExtractionFieldRule;
  status:        ExtractionFieldRule;
}

interface FieldCoordinates {
  drawing_number: FieldCoordinate | null;
  drawing_title:  FieldCoordinate | null;
  revision:       FieldCoordinate | null;
  revision_date:  FieldCoordinate | null;
  status:         FieldCoordinate | null;
  location:       FieldCoordinate | null;
}

interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Drawing {
  id: string;
  filename: string;
  pageNumber: number;
  drawingNumber:  string | null;
  drawingTitle:   string | null;
  revision:       string | null;
  revisionDate:   string | null;
  status:         string | null;
  location:       string | null;
  fieldCoordinates: string | null; // JSON
  extractionRules: ExtractionRules | null;
  drawingRegister: DrawingRegisterEntry[] | null;
  confidenceDrawingNumber:  number | null;
  confidenceDrawingTitle:   number | null;
  confidenceRevision:       number | null;
  confidenceRevisionDate:   number | null;
  confidenceStatus:         number | null;
  conflictDetected: boolean;
  conflictDetail:   string | null;
  extractionStatus: string;
  documentType:         string | null;
  titleBlockLocation:   string | null;
  revisionBlockLocation: string | null;
  extractionModel: string | null;
  flags:           string | null;
  notes:           string | null;
  extractedAt:     string | null;
}

interface FieldRow {
  num:        number;
  label:      string;
  field:      string;   // key on Drawing
  coordKey:   keyof FieldCoordinates;
  confKey:    keyof Drawing | null;
}

const FIELD_ROWS: FieldRow[] = [
  { num: 1, label: "Drawing Number", field: "drawingNumber",  coordKey: "drawing_number", confKey: "confidenceDrawingNumber"  },
  { num: 2, label: "Drawing Title",  field: "drawingTitle",   coordKey: "drawing_title",  confKey: "confidenceDrawingTitle"   },
  { num: 3, label: "Revision",       field: "revision",       coordKey: "revision",       confKey: "confidenceRevision"       },
  { num: 4, label: "Revision Date",  field: "revisionDate",   coordKey: "revision_date",  confKey: "confidenceRevisionDate"   },
  { num: 5, label: "Status",         field: "status",         coordKey: "status",         confKey: "confidenceStatus"         },
  { num: 6, label: "Location",       field: "location",       coordKey: "location",       confKey: null                       },
];


function ConfidenceBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-gray-300">—</span>;
  const pct = (value * 100).toFixed(0);
  if (value >= 0.7) return <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{pct}%</span>;
  if (value >= 0.4) return <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">{pct}%</span>;
  return <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{pct}%</span>;
}

function CoordCell({ coord }: { coord: FieldCoordinate | null | undefined }) {
  if (!coord) return <span className="text-xs text-gray-300">—</span>;
  return (
    <span className="text-xs font-mono text-gray-500 whitespace-nowrap">
      x={Math.round(coord.x)}, y={Math.round(coord.y)}
    </span>
  );
}

const RULE_FIELD_LABELS: Record<string, string> = {
  drawingNumber: "Drawing No",
  drawingTitle:  "Title",
  revision:      "Revision",
  revisionDate:  "Rev Date",
  status:        "Status",
};

const SOURCE_LABELS: Record<string, string> = {
  crop_bbox:      "Template crop",
  region:         "Region scan",
  vision:         "Vision OCR",
  revision_block: "Revision block",
  bbox_override:  "BBox override",
};

const VALIDATION_COLOURS: Record<string, string> = {
  passed:  "text-green-600",
  failed:  "text-red-600",
  flagged: "text-amber-600",
};

const VALIDATION_DOT: Record<string, string> = {
  passed:  "bg-green-500",
  failed:  "bg-red-500",
  flagged: "bg-amber-400",
};

function TransformPill({ label }: { label: string }) {
  const pretty = label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className="inline-block text-xs bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-mono">
      {pretty}
    </span>
  );
}

function DrawingRegisterSection({ entries }: { entries: DrawingRegisterEntry[] }) {
  if (!entries.length) {
    return (
      <div className="mx-4 mb-4 border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-purple-50 border-b border-gray-200 flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Drawing Register</span>
          <span className="text-xs text-gray-400">No rows extracted</span>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-4 mb-4 border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-purple-50 border-b border-gray-200 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Drawing Register</span>
        <span className="text-xs text-gray-400">{entries.length} entries extracted from drawing list table</span>
      </div>
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr className="text-gray-500 uppercase tracking-wide">
              <th className="text-left py-1.5 px-2 w-8">#</th>
              <th className="text-left py-1.5 px-2">Drawing No</th>
              <th className="text-left py-1.5 px-2">Title</th>
              <th className="text-left py-1.5 px-2 w-12">Rev</th>
              <th className="text-left py-1.5 px-2 w-20">Date</th>
              <th className="text-left py-1.5 px-2 w-24">Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="py-1.5 px-2 text-gray-400 font-mono">{i + 1}</td>
                <td className="py-1.5 px-2 font-mono text-gray-800">{entry.drawing_number ?? "—"}</td>
                <td className="py-1.5 px-2 text-gray-700">{entry.drawing_title ?? "—"}</td>
                <td className="py-1.5 px-2 font-mono text-gray-600">{entry.revision ?? "—"}</td>
                <td className="py-1.5 px-2 font-mono text-gray-600 whitespace-nowrap">{entry.revision_date ?? "—"}</td>
                <td className="py-1.5 px-2 text-gray-600">{entry.status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExtractionRulesSection({ rules }: { rules: ExtractionRules }) {
  const fields = ["drawingNumber", "drawingTitle", "revision", "revisionDate", "status"] as const;
  return (
    <div className="mx-4 mb-4 border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Extraction Rules</span>
        <span className="text-xs text-gray-400">How each field was derived</span>
      </div>
      <div className="divide-y divide-gray-100">
        {fields.map((key) => {
          const rule = rules[key];
          if (!rule) return null;
          const validationColour = VALIDATION_COLOURS[rule.validation] ?? "text-gray-600";
          const dot = VALIDATION_DOT[rule.validation] ?? "bg-gray-400";
          return (
            <div key={key} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-[80px]">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-0.5 ${dot}`} />
                  <span className="text-xs font-medium text-gray-700">{RULE_FIELD_LABELS[key]}</span>
                </div>
                <div className="flex-1 flex flex-col gap-1 items-end">
                  {/* Source */}
                  {rule.source && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">Source:</span>
                      <span className="text-xs text-gray-700 font-mono">
                        {SOURCE_LABELS[rule.source] ?? rule.source}
                        {rule.blockLocation && rule.blockLocation !== "unknown" && rule.blockLocation !== "none"
                          ? ` (${rule.blockLocation})`
                          : ""}
                      </span>
                    </div>
                  )}
                  {/* Normalised format (dates) */}
                  {rule.normalisedFormat && rule.normalisedFormat !== "DD/MM/YYYY" && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">Format:</span>
                      <span className="text-xs text-gray-600 font-mono">{rule.normalisedFormat} → DD/MM/YYYY</span>
                    </div>
                  )}
                  {/* Status canonical mapping */}
                  {rule.rawValue && rule.canonical && rule.rawValue !== rule.canonical && (
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                      <span className="text-xs text-gray-400">Mapped:</span>
                      <span className="text-xs text-gray-500 line-through font-mono">{rule.rawValue}</span>
                      <span className="text-xs text-gray-400">→</span>
                      <span className="text-xs text-green-700 font-mono">{rule.canonical}</span>
                    </div>
                  )}
                  {/* Transforms */}
                  {rule.transforms.length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-end">
                      {rule.transforms.map((t) => <TransformPill key={t} label={t} />)}
                    </div>
                  )}
                  {/* Validation */}
                  <span className={`text-xs font-medium ${validationColour}`}>
                    {rule.validation.charAt(0).toUpperCase() + rule.validation.slice(1)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DrawingDetailPage() {
  const { id, drawingId } = useParams<{ id: string; drawingId: string }>();
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [saving, setSaving]   = useState<string | null>(null);
  const [edits,  setEdits]    = useState<Partial<Record<string, string>>>({});
  
  // Cross check / Bulk apply state
  const [crossCheckResult, setCrossCheckResult] = useState<{
    bbox: BoundingBox;
    fieldName: string;
    matchedDrawingsCount: number;
    matchedDrawingIds: string[];
    extractedValue: string;
    architectId?: string;
  } | null>(null);
  const [isApplyingBulk, setIsApplyingBulk] = useState(false);

  async function load() {
    const res  = await fetch(`/api/drawings/${drawingId}`);
    const data = await res.json();
    setDrawing(data);
  }

  useEffect(() => { load(); }, [drawingId]);

  async function saveField(field: string) {
    if (!drawing) return;
    setSaving(field);
    await fetch(`/api/drawings/${drawingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: edits[field] }),
    });
    setSaving(null);
    load();
    setEdits((prev) => { const n = { ...prev }; delete n[field]; return n; });
  }

  async function handleRegionExtract(bbox: BoundingBox, fieldName: string, imageBase64?: string | null) {
    try {
      const res = await fetch(`/api/drawings/${drawingId}/cross-check-region`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldName, bbox, imageBase64 }),
      });
      const data = await res.json();
      
      if (data.extractedValue) {
        setEdits((prev) => ({ ...prev, [fieldName]: data.extractedValue }));
        setCrossCheckResult({ ...data, bbox, fieldName });
      } else {
        const manualVal = prompt(
          "No embedded text could be cleanly extracted from this specific region (likely due to it being a scanned or vectorized PDF).\n\n" +
          "Please type the value you see manually.\n" +
          "We will save this coordinate rule for future drawings produced by this Architect."
        );
        if (manualVal) {
          setEdits((prev) => ({ ...prev, [fieldName]: manualVal }));
          setCrossCheckResult({
            bbox,
            fieldName,
            matchedDrawingsCount: 0,
            matchedDrawingIds: [],
            extractedValue: manualVal,
            architectId: data.architectId
          });
        }
      }
    } catch (err) {
      alert("Error cross-checking region.");
    }
  }

  async function handleBulkApply(applyToAll: boolean) {
    if (!crossCheckResult || !drawing) return;

    // Always include the current drawing in the apply list
    const idsToApply = applyToAll && crossCheckResult.matchedDrawingIds.length > 0
      ? [...new Set([...crossCheckResult.matchedDrawingIds, drawing.id])]
      : [drawing.id];

    setIsApplyingBulk(true);
    try {
      await fetch('/api/drawings/bulk-apply-region', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bbox: crossCheckResult.bbox,
          fieldName: crossCheckResult.fieldName,
          applyToDrawingIds: idsToApply,
          architectId: crossCheckResult.architectId,
          // Pass the Vision-confirmed value for the current drawing so bulk-apply
          // doesn't need to re-extract it from pdfplumber (which may fail or be wrong).
          knownValue: crossCheckResult.extractedValue,
          knownDrawingId: drawing.id,
        }),
      });
      setCrossCheckResult(null);
      load(); // Reload to show updated values
    } catch {
      alert("Failed to apply changes.");
    } finally {
      setIsApplyingBulk(false);
    }
  }

  const flags: string[] = drawing?.flags ? (JSON.parse(drawing.flags) as string[]) : [];

  const coords: FieldCoordinates | null = (() => {
    try {
      return drawing?.fieldCoordinates ? JSON.parse(drawing.fieldCoordinates) : null;
    } catch { return null; }
  })();

  if (!drawing) return <div className="p-8 text-gray-500">Loading…</div>;

  const pdfUrl = `/api/drawings/${drawingId}/pdf`;

  return (
    <div className="flex flex-col h-[calc(100vh-49px)]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 px-4 py-2 border-b border-gray-200 bg-white shrink-0">
        <Link href="/" className="hover:text-gray-900">Projects</Link>
        <span>/</span>
        <Link href={`/projects/${id}`} className="hover:text-gray-900">Project</Link>
        <span>/</span>
        <span className="text-gray-900 truncate max-w-xs">{drawing.filename}</span>
        {drawing.pageNumber > 0 && (
          <span className="ml-1 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">p.{drawing.pageNumber}</span>
        )}
      </div>

      {/* Split view */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left: PDF viewer */}
        <div className="flex-1 overflow-auto bg-gray-800 border-r border-gray-300">
          <PDFViewer url={pdfUrl} onRegionExtract={handleRegionExtract} />
        </div>

        {/* Right: Data panel */}
        <div className="w-[520px] flex flex-col overflow-y-auto bg-white shrink-0">

          {/* Header */}
          <div className="p-4 border-b border-gray-200">
            <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Extracted Data</div>
            <div className="text-sm font-medium truncate">{drawing.filename}</div>
            {drawing.extractedAt && (
              <div className="text-xs text-gray-400 mt-0.5">
                Extracted {new Date(drawing.extractedAt).toLocaleString()} · {drawing.extractionModel ?? "—"}
              </div>
            )}
          </div>

          {/* Conflict banner */}
          {drawing.conflictDetected && (
            <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
              <div className="font-medium text-amber-800">⚠ Revision Conflict</div>
              <div className="text-amber-700 text-xs mt-0.5">
                {drawing.conflictDetail || "Title block and revision block disagree. Revision block value was used."}
              </div>
            </div>
          )}

          {/* Flags */}
          {flags.length > 0 && (
            <div className="mx-4 mt-3 flex flex-wrap gap-1">
              {flags.map((f) => (
                <span key={f} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">{f}</span>
              ))}
            </div>
          )}

          {/* ---- Numbered fields table ---- */}
          <div className="p-4">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-200">
                  <th className="text-left py-1.5 pr-2 w-6">#</th>
                  <th className="text-left py-1.5 pr-3 w-28">Field</th>
                  <th className="text-left py-1.5 pr-2">Value</th>
                  <th className="text-left py-1.5 pr-2 w-12">Conf</th>
                  <th className="text-left py-1.5 w-32">Coordinates</th>
                </tr>
              </thead>
              <tbody>
                {FIELD_ROWS.map((row) => {
                  const rawVal = (drawing as unknown as Record<string, unknown>)[row.field] as string | null;
                  const isEditing = row.field in edits;
                  const displayVal = isEditing ? (edits[row.field] ?? "") : (rawVal ?? "");
                  const conf = row.confKey ? ((drawing as unknown as Record<string, unknown>)[row.confKey] as number | null) : null;
                  const coord = coords?.[row.coordKey] ?? null;
                  const isLowConf = conf !== null && conf < 0.7;

                  return (
                    <tr key={row.field} className="border-b border-gray-100 align-top group">
                      {/* # */}
                      <td className="py-2.5 pr-2 text-gray-400 font-mono text-xs">{row.num}</td>

                      {/* Field label */}
                      <td className="py-2.5 pr-3">
                        <span className="font-medium text-gray-700 text-xs">{row.label}</span>
                      </td>

                      {/* Value — inline-editable */}
                      <td className="py-1.5 pr-2">
                        <div className={`flex gap-1 ${isLowConf ? "ring-1 ring-amber-300 rounded" : ""}`}>
                          <input
                            value={displayVal}
                            onChange={(e) => setEdits((prev) => ({ ...prev, [row.field]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") saveField(row.field); if (e.key === "Escape") setEdits((prev) => { const n = { ...prev }; delete n[row.field]; return n; }); }}
                            placeholder="—"
                            className="flex-1 min-w-0 border border-transparent hover:border-gray-200 focus:border-gray-400 rounded px-1.5 py-1 text-xs focus:outline-none bg-transparent focus:bg-white transition-colors"
                          />
                          {isEditing && (
                            <button
                              onClick={() => saveField(row.field)}
                              disabled={saving === row.field}
                              className="text-xs bg-gray-900 text-white px-1.5 rounded hover:bg-gray-700 disabled:opacity-50 shrink-0"
                            >
                              {saving === row.field ? "…" : "Save"}
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Confidence */}
                      <td className="py-2.5 pr-2">
                        <ConfidenceBadge value={conf} />
                      </td>

                      {/* Coordinates */}
                      <td className="py-2.5">
                        <CoordCell coord={coord} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Metadata */}
          <div className="mx-4 mb-4 border border-gray-100 rounded-lg p-3">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Metadata</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
              <span className="text-gray-400">Document type</span>
              <span>{drawing.documentType || "—"}</span>
              <span className="text-gray-400">Title block</span>
              <span>{drawing.titleBlockLocation || "—"}</span>
              <span className="text-gray-400">Revision block</span>
              <span>{drawing.revisionBlockLocation || "—"}</span>
              <span className="text-gray-400">Pipeline status</span>
              <span>{drawing.extractionStatus}</span>
            </div>
          </div>

          {/* Drawing Register (cover sheets) */}
          {drawing.drawingRegister && (
            <DrawingRegisterSection entries={drawing.drawingRegister} />
          )}

          {/* Extraction Rules */}
          {drawing.extractionRules && (
            <ExtractionRulesSection rules={drawing.extractionRules} />
          )}

          {drawing.notes && (
            <div className="mx-4 mb-4 bg-gray-50 rounded-lg p-3 text-xs text-gray-600 border border-gray-200">
              <div className="font-medium mb-1">Notes</div>
              {drawing.notes}
            </div>
          )}
        </div>
        
        {/* Bulk Apply Modal Overlay */}
        {crossCheckResult && (
          <div className="absolute inset-0 bg-gray-900/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl overflow-hidden max-w-md w-full">
              <div className="p-5 border-b border-gray-100 bg-amber-50">
                <h3 className="text-lg font-semibold text-amber-900 flex items-center gap-2">
                  <span>Region Extracted</span>
                  <span className="bg-amber-200 text-amber-800 text-xs px-2 py-0.5 rounded-full capitalize">{crossCheckResult.fieldName.replace(/([A-Z])/g, ' $1').trim()}</span>
                </h3>
              </div>
              <div className="p-6">
                <div className="mb-4 text-center">
                  <div className="text-sm text-gray-500 mb-1">Extracted Value</div>
                  <div className="text-xl font-bold font-mono bg-gray-100 py-3 px-4 rounded text-gray-900 break-all">{crossCheckResult.extractedValue}</div>
                </div>
                
                {crossCheckResult.matchedDrawingsCount > 0 ? (
                  <p className="text-sm text-gray-600 mb-6 leading-relaxed">
                    This location rule can be applied to <strong className="text-gray-900">{crossCheckResult.matchedDrawingsCount} other drawings</strong> in this project.
                    Standard drawings will extract instantly. Scanned documents will be queued for automated visual AI extraction.
                  </p>
                ) : (
                  <p className="text-sm text-gray-600 mb-6">
                    No other drawings in this project are ready to extract this rule right now. 
                    We will save this coordinate rule so any future drawings automatically scan this location!
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  {crossCheckResult.matchedDrawingsCount > 0 && (
                    <button
                      onClick={() => handleBulkApply(true)}
                      disabled={isApplyingBulk}
                      className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:bg-amber-500 text-black font-semibold py-2.5 rounded shadow transition-colors flex items-center justify-center gap-2"
                    >
                      {isApplyingBulk ? "Applying..." : `Yes, apply to all (${crossCheckResult.matchedDrawingsCount + 1} drawings)`}
                    </button>
                  )}
                  <button
                    onClick={() => handleBulkApply(false)}
                    disabled={isApplyingBulk}
                    className="w-full bg-white hover:bg-gray-50 disabled:opacity-50 disabled:bg-white text-gray-700 font-medium py-2 px-4 border border-gray-300 rounded transition-colors"
                  >
                    No, apply to this drawing only
                  </button>
                  <button
                    onClick={() => setCrossCheckResult(null)}
                    disabled={isApplyingBulk}
                    className="w-full text-gray-500 hover:text-gray-700 font-medium py-2 px-4 transition-colors text-sm mt-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
