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

interface FieldCoordinates {
  drawing_number: FieldCoordinate | null;
  drawing_title:  FieldCoordinate | null;
  revision:       FieldCoordinate | null;
  revision_date:  FieldCoordinate | null;
  status:         FieldCoordinate | null;
  location:       FieldCoordinate | null;
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

export default function DrawingDetailPage() {
  const { id, drawingId } = useParams<{ id: string; drawingId: string }>();
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [saving, setSaving]   = useState<string | null>(null);
  const [edits,  setEdits]    = useState<Partial<Record<string, string>>>({});

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
      <div className="flex flex-1 overflow-hidden">
        {/* Left: PDF viewer */}
        <div className="flex-1 overflow-auto bg-gray-800 border-r border-gray-300">
          <PDFViewer url={pdfUrl} />
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

          {drawing.notes && (
            <div className="mx-4 mb-4 bg-gray-50 rounded-lg p-3 text-xs text-gray-600 border border-gray-200">
              <div className="font-medium mb-1">Notes</div>
              {drawing.notes}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
