"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";

const PDFViewer = dynamic(() => import("@/components/PDFViewer"), { ssr: false });

interface Drawing {
  id: string;
  filename: string;
  drawingNumber: string | null;
  drawingTitle: string | null;
  revision: string | null;
  revisionDate: string | null;
  status: string | null;
  confidenceDrawingNumber: number | null;
  confidenceDrawingTitle: number | null;
  confidenceRevision: number | null;
  confidenceRevisionDate: number | null;
  confidenceStatus: number | null;
  conflictDetected: boolean;
  conflictDetail: string | null;
  extractionStatus: string;
  documentType: string | null;
  titleBlockLocation: string | null;
  revisionBlockLocation: string | null;
  extractionModel: string | null;
  flags: string | null;
  notes: string | null;
  extractedAt: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  drawingNumber: "Drawing Number",
  drawingTitle: "Drawing Title",
  revision: "Revision",
  revisionDate: "Revision Date",
  status: "Status",
};

type FieldKey = keyof typeof FIELD_LABELS;

function ConfidenceBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const pct = (value * 100).toFixed(0);
  if (value >= 0.7) return <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{pct}%</span>;
  if (value >= 0.4) return <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">{pct}%</span>;
  return <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{pct}%</span>;
}

export default function DrawingDetailPage() {
  const { id, drawingId } = useParams<{ id: string; drawingId: string }>();
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Partial<Record<FieldKey, string>>>({});

  async function load() {
    const res = await fetch(`/api/drawings/${drawingId}`);
    const data = await res.json();
    setDrawing(data);
  }

  useEffect(() => { load(); }, [drawingId]);

  async function saveField(field: FieldKey) {
    if (!drawing) return;
    setSaving(field);
    await fetch(`/api/drawings/${drawingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: edits[field] ?? (drawing as unknown as Record<string, unknown>)[field] }),
    });
    setSaving(null);
    load();
    setEdits((prev) => { const n = { ...prev }; delete n[field]; return n; });
  }

  function getFieldValue(field: FieldKey): string {
    if (field in edits) return edits[field] || "";
    return (drawing as unknown as Record<string, unknown>)?.[field] as string || "";
  }

  function getConfidence(field: FieldKey): number | null {
    const key = `confidence${field.charAt(0).toUpperCase()}${field.slice(1)}` as keyof Drawing;
    return (drawing?.[key] as number | null) ?? null;
  }

  const flags = drawing?.flags ? (JSON.parse(drawing.flags) as string[]) : [];

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
      </div>

      {/* Split view */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: PDF viewer */}
        <div className="flex-1 overflow-auto bg-gray-800 border-r border-gray-300">
          <PDFViewer url={pdfUrl} />
        </div>

        {/* Right: Data form */}
        <div className="w-96 flex flex-col overflow-y-auto bg-white shrink-0">
          <div className="p-4 border-b border-gray-200">
            <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Extracted Data</div>
            <div className="text-sm font-medium truncate">{drawing.filename}</div>
            {drawing.extractedAt && (
              <div className="text-xs text-gray-400 mt-0.5">
                Extracted {new Date(drawing.extractedAt).toLocaleString()} · {drawing.extractionModel}
              </div>
            )}
          </div>

          {/* Conflict banner */}
          {drawing.conflictDetected && (
            <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
              <div className="font-medium text-amber-800">⚠ Revision Conflict</div>
              <div className="text-amber-700 text-xs mt-0.5">{drawing.conflictDetail || "Title block and revision block disagree. Revision block value was used."}</div>
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

          {/* Fields */}
          <div className="p-4 flex flex-col gap-4 flex-1">
            {(Object.keys(FIELD_LABELS) as FieldKey[]).map((field) => {
              const conf = getConfidence(field);
              const hasLowConf = conf !== null && conf < 0.7;
              const flagKey = `LOW_CONFIDENCE_${field.replace(/([A-Z])/g, "_$1").toUpperCase().slice(1)}`;
              const hasFlag = flags.some((f) => f.startsWith("LOW_CONFIDENCE") && f.includes(field.toUpperCase().replace(/([A-Z])/g, "_$1").slice(1)));
              void hasFlag; void flagKey;

              return (
                <div key={field}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                      {FIELD_LABELS[field]}
                    </label>
                    <ConfidenceBadge value={conf} />
                  </div>
                  <div className={`flex gap-2 ${hasLowConf ? "ring-1 ring-amber-300 rounded-lg" : ""}`}>
                    <input
                      value={getFieldValue(field)}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [field]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") saveField(field); }}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      placeholder={`Enter ${FIELD_LABELS[field].toLowerCase()}…`}
                    />
                    {field in edits && (
                      <button
                        onClick={() => saveField(field)}
                        disabled={saving === field}
                        className="text-xs bg-gray-900 text-white px-2 rounded-lg hover:bg-gray-700 disabled:opacity-50"
                      >
                        {saving === field ? "…" : "Save"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Metadata */}
            <div className="border-t border-gray-100 pt-4 mt-2">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Metadata</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                <span className="text-gray-400">Document type</span>
                <span>{drawing.documentType || "—"}</span>
                <span className="text-gray-400">Title block</span>
                <span>{drawing.titleBlockLocation || "—"}</span>
                <span className="text-gray-400">Revision block</span>
                <span>{drawing.revisionBlockLocation || "—"}</span>
                <span className="text-gray-400">Status</span>
                <span>{drawing.extractionStatus}</span>
              </div>
            </div>

            {drawing.notes && (
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 border border-gray-200">
                <div className="font-medium mb-1">Notes</div>
                {drawing.notes}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
