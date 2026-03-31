"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

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
  extractionStatus: string;
  flags: string | null;
  documentType: string | null;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  processing: "Processing…",
  extracted: "Extracted",
  cover_sheet: "Cover Sheet",
  reviewed: "Reviewed",
  published: "Published",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  processing: "bg-blue-100 text-blue-700",
  extracted: "bg-yellow-100 text-yellow-700",
  cover_sheet: "bg-purple-100 text-purple-700",
  reviewed: "bg-green-100 text-green-700",
  published: "bg-emerald-100 text-emerald-700",
};

function ConfidenceDot({ value }: { value: number | null }) {
  if (value === null) return null;
  if (value >= 0.7) return <span className="w-2 h-2 rounded-full bg-green-400 inline-block" title={`Confidence: ${(value * 100).toFixed(0)}%`} />;
  if (value >= 0.4) return <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" title={`Confidence: ${(value * 100).toFixed(0)}%`} />;
  return <span className="w-2 h-2 rounded-full bg-red-400 inline-block" title={`Confidence: ${(value * 100).toFixed(0)}%`} />;
}

function InlineCell({
  value,
  confidence,
  drawingId,
  field,
  onSave,
  isNull,
  isCoverSheet,
}: {
  value: string | null;
  confidence: number | null;
  drawingId: string;
  field: string;
  onSave: (id: string, field: string, value: string) => void;
  isNull: boolean;
  isCoverSheet: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(value || ""); }, [value]);

  function save() {
    setEditing(false);
    if (draft !== (value || "")) {
      onSave(drawingId, field, draft);
    }
  }

  const lowConf = confidence !== null && confidence < 0.7;
  const cellClass = isNull
    ? "bg-red-50 text-red-700"
    : lowConf
    ? "bg-amber-50 text-amber-800"
    : "";

  if (isCoverSheet) {
    return <span className="text-gray-400 italic text-xs">—</span>;
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); setDraft(value || ""); } }}
        className="w-full border border-blue-400 rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
      />
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded cursor-pointer hover:bg-gray-100 min-h-[28px] group ${cellClass}`}
    >
      <ConfidenceDot value={confidence} />
      <span className="text-sm truncate max-w-[160px]">
        {value || <span className="text-gray-400 italic">—</span>}
      </span>
      <span className="opacity-0 group-hover:opacity-100 text-gray-400 text-xs ml-auto">✎</span>
    </div>
  );
}

const FILTER_OPTIONS = ["all", "pending", "extracted", "cover_sheet", "reviewed", "published"] as const;
type Filter = typeof FILTER_OPTIONS[number];

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loading, setLoading] = useState(true);
  const [extractingAll, setExtractingAll] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [projRes, drawRes] = await Promise.all([
      fetch(`/api/projects`),
      fetch(`/api/projects/${id}/drawings`),
    ]);
    const projects = await projRes.json();
    setProject(projects.find((p: Project) => p.id === id) || null);
    setDrawings(await drawRes.json());
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function uploadFiles(files: FileList) {
    setUploading(true);
    const formData = new FormData();
    for (const f of Array.from(files)) {
      if (f.name.endsWith(".pdf")) formData.append("files", f);
    }
    await fetch(`/api/projects/${id}/upload`, { method: "POST", body: formData });
    setUploading(false);
    load();
  }

  async function extractAll() {
    setExtractingAll(true);
    await fetch(`/api/projects/${id}/extract-all`, { method: "POST" });
    setExtractingAll(false);
    load();
  }

  async function saveField(drawingId: string, field: string, value: string) {
    await fetch(`/api/drawings/${drawingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    load();
  }

  async function markReviewed(drawingId: string) {
    await fetch(`/api/drawings/${drawingId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extractionStatus: "reviewed" }),
    });
    load();
  }

  async function markPublished(drawingId: string) {
    await fetch(`/api/drawings/${drawingId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extractionStatus: "published" }),
    });
    load();
  }

  const filtered = drawings.filter((d) =>
    filter === "all" ? true : d.extractionStatus === filter
  );

  const pendingCount = drawings.filter((d) => d.extractionStatus === "pending").length;
  const needsReviewCount = drawings.filter((d) => {
    const flags = d.flags ? (JSON.parse(d.flags) as string[]) : [];
    return d.extractionStatus === "extracted" && flags.some((f) => f === "NEEDS_REVIEW" || f.startsWith("LOW_CONFIDENCE"));
  }).length;

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;

  return (
    <div className="p-6 max-w-full">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/" className="hover:text-gray-900">Projects</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{project?.name || id}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold">{project?.name}</h1>
          {project?.description && <p className="text-sm text-gray-500 mt-0.5">{project.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-sm border border-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload PDFs"}
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
          {pendingCount > 0 && (
            <button
              onClick={extractAll}
              disabled={extractingAll}
              className="text-sm bg-gray-900 text-white px-3 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-50"
            >
              {extractingAll ? "Extracting…" : `Extract All (${pendingCount})`}
            </button>
          )}
        </div>
      </div>

      {/* Drag and drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); }}
        className={`border-2 border-dashed rounded-xl p-6 text-center mb-5 transition-colors ${dragOver ? "border-blue-400 bg-blue-50" : "border-gray-200 bg-gray-50"}`}
      >
        <p className="text-sm text-gray-500">
          {dragOver ? "Drop PDFs here" : "Drag and drop PDF drawings here, or use the Upload button above"}
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-1 mb-4">
        {FILTER_OPTIONS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-lg capitalize ${filter === f ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}
          >
            {f === "all" ? `All (${drawings.length})` : `${f.replace("_", " ")} (${drawings.filter((d) => d.extractionStatus === f).length})`}
          </button>
        ))}
        {needsReviewCount > 0 && (
          <span className="text-xs text-amber-600 ml-2">{needsReviewCount} need{needsReviewCount !== 1 ? "" : "s"} review</span>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">No drawings in this category.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-3 py-2 font-medium">File</th>
                <th className="text-left px-3 py-2 font-medium">Drawing No</th>
                <th className="text-left px-3 py-2 font-medium">Title</th>
                <th className="text-left px-3 py-2 font-medium w-20">Rev</th>
                <th className="text-left px-3 py-2 font-medium w-28">Rev Date</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium w-24">State</th>
                <th className="text-left px-3 py-2 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const flags = d.flags ? (JSON.parse(d.flags) as string[]) : [];
                const isCoverSheet = d.extractionStatus === "cover_sheet" || d.documentType === "cover_sheet";
                const hasConflict = d.conflictDetected;

                return (
                  <tr key={d.id} className={`border-b border-gray-100 hover:bg-gray-50 ${isCoverSheet ? "bg-purple-50/30" : ""}`}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {hasConflict && <span className="text-amber-500 text-xs" title="Revision conflict detected">⚠</span>}
                        <span className="text-gray-700 truncate max-w-[140px]" title={d.filename}>{d.filename}</span>
                        {isCoverSheet && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">cover</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <InlineCell value={d.drawingNumber} confidence={d.confidenceDrawingNumber} drawingId={d.id} field="drawingNumber" onSave={saveField} isNull={!d.drawingNumber && flags.includes("NEEDS_REVIEW")} isCoverSheet={isCoverSheet} />
                    </td>
                    <td className="px-3 py-2">
                      <InlineCell value={d.drawingTitle} confidence={d.confidenceDrawingTitle} drawingId={d.id} field="drawingTitle" onSave={saveField} isNull={false} isCoverSheet={isCoverSheet} />
                    </td>
                    <td className="px-3 py-2">
                      <InlineCell value={d.revision} confidence={d.confidenceRevision} drawingId={d.id} field="revision" onSave={saveField} isNull={false} isCoverSheet={isCoverSheet} />
                    </td>
                    <td className="px-3 py-2">
                      <InlineCell value={d.revisionDate} confidence={d.confidenceRevisionDate} drawingId={d.id} field="revisionDate" onSave={saveField} isNull={false} isCoverSheet={isCoverSheet} />
                    </td>
                    <td className="px-3 py-2">
                      <InlineCell value={d.status} confidence={d.confidenceStatus} drawingId={d.id} field="status" onSave={saveField} isNull={false} isCoverSheet={isCoverSheet} />
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[d.extractionStatus] || "bg-gray-100 text-gray-600"}`}>
                        {STATUS_LABELS[d.extractionStatus] || d.extractionStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/projects/${id}/drawings/${d.id}`}
                          className="text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50"
                          title="View"
                        >
                          View
                        </Link>
                        {d.extractionStatus === "extracted" && !isCoverSheet && (
                          <button
                            onClick={() => markReviewed(d.id)}
                            className="text-xs text-green-700 border border-green-200 rounded px-1.5 py-0.5 hover:bg-green-50"
                            title="Mark reviewed"
                          >
                            ✓
                          </button>
                        )}
                        {d.extractionStatus === "reviewed" && (
                          <button
                            onClick={() => markPublished(d.id)}
                            className="text-xs text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5 hover:bg-emerald-50"
                            title="Publish"
                          >
                            ↑
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
