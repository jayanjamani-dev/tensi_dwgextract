"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { BrainCircuit, Sparkles } from "lucide-react";

const PDFViewer = dynamic(() => import("@/components/PDFViewer"), { ssr: false });

// ── Types ──────────────────────────────────────────────────────────

interface Drawing {
  id: string;
  filename: string;
  pageNumber: number;
  drawingNumber: string | null;
  drawingTitle: string | null;
  revision: string | null;
  revisionDate: string | null;
  status: string | null;
  location: string | null;
  fieldCoordinates: string | null;
  confidenceDrawingNumber: number | null;
  confidenceDrawingTitle: number | null;
  confidenceRevision: number | null;
  confidenceRevisionDate: number | null;
  confidenceStatus: number | null;
  conflictDetected: boolean;
  extractionStatus: string;
  flags: string | null;
  documentType: string | null;
  titleBlockLocation: string | null;
  revisionBlockLocation: string | null;
  extractionModel: string | null;
  notes: string | null;
  extractedAt: string | null;
}

interface FieldCoordinate {
  x: number;
  y: number;
}

interface FieldCoordinates {
  drawing_number: FieldCoordinate | null;
  drawing_title: FieldCoordinate | null;
  revision: FieldCoordinate | null;
  revision_date: FieldCoordinate | null;
  status: FieldCoordinate | null;
  location: FieldCoordinate | null;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
}

// ── Constants ──────────────────────────────────────────────────────

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

// ── Sub-components ─────────────────────────────────────────────────

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

// ── Slide-over panel ───────────────────────────────────────────────

function DrawingSlideOver({
  drawing,
  projectId,
  onClose,
  onSave,
  onMarkReviewed,
  onMarkPublished,
  onNext,
  onPrev,
  hasPrev,
  hasNext,
}: {
  drawing: Drawing;
  projectId: string;
  onClose: () => void;
  onSave: (drawingId: string, field: string, value: string) => void;
  onMarkReviewed: (drawingId: string) => void;
  onMarkPublished: (drawingId: string) => void;
  onNext: () => void;
  onPrev: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const coords: FieldCoordinates | null = (() => {
    try {
      return drawing.fieldCoordinates ? JSON.parse(drawing.fieldCoordinates) : null;
    } catch { return null; }
  })();

  // Use the first available coordinate as the title block position
  const titleBlockCoord = coords
    ? (coords.drawing_number || coords.drawing_title || coords.revision || null)
    : null;

  const flags: string[] = drawing.flags ? (JSON.parse(drawing.flags) as string[]) : [];
  const isCoverSheet = drawing.extractionStatus === "cover_sheet" || drawing.documentType === "cover_sheet";

  const FIELD_ROWS = [
    { label: "Drawing Number", field: "drawingNumber", coordKey: "drawing_number" as const, confKey: "confidenceDrawingNumber" as const, color: "blue" },
    { label: "Drawing Title", field: "drawingTitle", coordKey: "drawing_title" as const, confKey: "confidenceDrawingTitle" as const, color: "green" },
    { label: "Revision", field: "revision", coordKey: "revision" as const, confKey: "confidenceRevision" as const, color: "purple" },
    { label: "Revision Date", field: "revisionDate", coordKey: "revision_date" as const, confKey: "confidenceRevisionDate" as const, color: "fuchsia" },
    { label: "Status", field: "status", coordKey: "status" as const, confKey: "confidenceStatus" as const, color: "amber" },
    { label: "Location", field: "location", coordKey: "location" as const, confKey: null, color: "rose" },
  ];

  const extractedFieldOverlays = FIELD_ROWS.map((row) => {
    const rawVal = (drawing as unknown as Record<string, unknown>)[row.field] as string | null;
    const c = coords?.[row.coordKey];
    return {
      label: row.label,
      value: rawVal,
      x: c?.x,
      y: c?.y,
      color: row.color,
    };
  }).filter((f): f is { label: string; value: string | null; x: number; y: number; color: string } => 
    f.x !== undefined && f.y !== undefined && f.x !== null && f.y !== null
  );

  const pdfUrl = `/api/drawings/${drawing.id}/pdf`;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-[85vw] max-w-none flex bg-white shadow-2xl animate-slide-in">
        {/* PDF Viewer */}
        <div className="flex-1 bg-gray-800 min-w-0">
          <PDFViewer
            url={pdfUrl}
            pageNumber={drawing.pageNumber + 1}
            titleBlockCoords={titleBlockCoord}
            titleBlockLocation={drawing.titleBlockLocation}
            extractedFields={extractedFieldOverlays}
          />
        </div>

        {/* Data panel */}
        <div className="w-[400px] flex flex-col overflow-y-auto shrink-0 border-l border-gray-200">
          {/* Close + header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50/50">
            <div>
              <div className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-0.5">Extracted Data</div>
              <div className="text-sm font-medium truncate max-w-[240px]" title={drawing.filename}>{drawing.filename}</div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={onPrev}
                disabled={!hasPrev}
                className="text-gray-400 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent"
                title="Previous Drawing (Left Arrow)"
              >
                ←
              </button>
              <button
                onClick={onNext}
                disabled={!hasNext}
                className="text-gray-400 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent"
                title="Next Drawing (Right Arrow)"
              >
                →
              </button>
              <div className="w-px h-4 bg-gray-300 mx-1" />
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-200"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Conflict banner */}
          {drawing.conflictDetected && (
            <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
              <div className="font-medium text-amber-800">⚠ Revision Conflict</div>
              <div className="text-amber-700 text-xs mt-0.5">
                {drawing.notes || "Title block and revision block disagree."}
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

          {/* Fields table */}
          <div className="p-4">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wide border-b border-gray-200">
                  <th className="text-left py-1.5 pr-2 w-28">Field</th>
                  <th className="text-left py-1.5 pr-2">Value</th>
                  <th className="text-left py-1.5 w-12">Conf</th>
                </tr>
              </thead>
              <tbody>
                {FIELD_ROWS.map((row) => {
                  const rawVal = (drawing as unknown as Record<string, unknown>)[row.field] as string | null;
                  const conf = row.confKey ? ((drawing as unknown as Record<string, unknown>)[row.confKey] as number | null) : null;
                  const isCoverSheet = drawing.extractionStatus === "cover_sheet" || drawing.documentType === "cover_sheet";
                  const isNull = !rawVal && flags.includes("NEEDS_REVIEW");

                  return (
                    <tr key={row.field} className="border-b border-gray-100">
                      <td className="py-2 pr-2 text-xs font-medium text-gray-700">{row.label}</td>
                      <td className="py-2 pr-2 text-xs text-gray-900">
                        <InlineCell
                          value={rawVal}
                          confidence={null} // Suppress the dot, we render it explicitly in the next column
                          drawingId={drawing.id}
                          field={row.field}
                          onSave={onSave}
                          isNull={isNull}
                          isCoverSheet={isCoverSheet}
                        />
                      </td>
                      <td className="py-2">
                        {conf !== null ? (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${conf >= 0.7 ? "bg-green-100 text-green-700" : conf >= 0.4 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                            {(conf * 100).toFixed(0)}%
                          </span>
                        ) : <span className="text-xs text-gray-300">—</span>}
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

          {/* Actions */}
          <div className="px-4 pb-4 mt-auto flex flex-col gap-2">
            {!isCoverSheet && drawing.extractionStatus === "extracted" && (
              <button
                onClick={() => onMarkReviewed(drawing.id)}
                className="w-full text-center text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg px-3 py-2"
              >
                ✓ Mark as Reviewed
              </button>
            )}
            {drawing.extractionStatus === "reviewed" && (
              <button
                onClick={() => onMarkPublished(drawing.id)}
                className="w-full flex items-center justify-center gap-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-2 shadow-sm"
              >
                <span className="text-lg leading-none mb-0.5">↑</span> Publish Drawing
              </button>
            )}
            <Link
              href={`/projects/${projectId}/drawings/${drawing.id}`}
              className="block text-center text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50"
            >
              Open full detail view →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Filters ────────────────────────────────────────────────────────

const FILTER_OPTIONS = ["all", "pending", "extracted", "cover_sheet", "reviewed", "published"] as const;
type Filter = typeof FILTER_OPTIONS[number];

// ── Main Page ──────────────────────────────────────────────────────

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loading, setLoading] = useState(true);
  const [extractingAll, setExtractingAll] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // Slide-over state
  const [viewingDrawingId, setViewingDrawingId] = useState<string | null>(null);
  const viewingDrawing = drawings.find(d => d.id === viewingDrawingId) || null;

  const filtered = drawings.filter((d) =>
    filter === "all" ? true : d.extractionStatus === filter
  );

  const viewingIndex = viewingDrawingId ? filtered.findIndex(d => d.id === viewingDrawingId) : -1;
  const hasPrev = viewingIndex > 0;
  const hasNext = viewingIndex >= 0 && viewingIndex < filtered.length - 1;

  function goPrev() { if (hasPrev) setViewingDrawingId(filtered[viewingIndex - 1].id); }
  function goNext() { if (hasNext) setViewingDrawingId(filtered[viewingIndex + 1].id); }

  // Batch correction modal state
  const [pendingBatchCorrection, setPendingBatchCorrection] = useState<{
    fieldName: string;
    original: string;
    corrected: string;
    affectedIds: string[];
    count: number;
    isGlobal?: boolean;
  } | null>(null);

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

  // Keyboard navigation for slide-over
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!viewingDrawingId) return;
      if (e.key === "Escape") setViewingDrawingId(null);
      // Only navigate if an input or textarea isn't focused
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === "input" || activeTag === "textarea") return;
      
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewingDrawingId, hasPrev, hasNext, goPrev, goNext]);

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
    const res = await fetch(`/api/drawings/${drawingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const data = await res.json();
    if (data.similarErrors && data.similarErrors[field]) {
      setPendingBatchCorrection({ fieldName: field, ...data.similarErrors[field] });
    }
    load();
  }

  async function markReviewed(drawingId: string) {
    await fetch(`/api/drawings/${drawingId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extractionStatus: "reviewed" }),
    });
    
    // Auto-advance to next drawing
    if (viewingDrawingId === drawingId) {
      const currentIndex = filtered.findIndex((d) => d.id === drawingId);
      if (currentIndex >= 0 && currentIndex + 1 < filtered.length) {
        setViewingDrawingId(filtered[currentIndex + 1].id);
      } else {
        setViewingDrawingId(null);
      }
    }
    
    load();
  }

  async function markPublished(drawingId: string) {
    await fetch(`/api/drawings/${drawingId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extractionStatus: "published" }),
    });

    // Auto-advance to next drawing
    if (viewingDrawingId === drawingId) {
      const currentIndex = filtered.findIndex((d) => d.id === drawingId);
      if (currentIndex >= 0 && currentIndex + 1 < filtered.length) {
        setViewingDrawingId(filtered[currentIndex + 1].id);
      } else {
        setViewingDrawingId(null);
      }
    }

    load();
  }

  async function deleteProject() {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    router.push("/");
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    await fetch(`/api/drawings/batch`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selectedIds) }),
    });
    setSelectedIds(new Set());
    setDeleting(false);
    load();
  }

  async function applyBatchCorrection() {
    if (!pendingBatchCorrection) return;
    await fetch(`/api/projects/${id}/batch-correct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: pendingBatchCorrection.affectedIds,
        fieldName: pendingBatchCorrection.fieldName,
        correctedValue: pendingBatchCorrection.corrected,
      }),
    });
    setPendingBatchCorrection(null);
    load();
  }

  function toggleSelect(drawingId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(drawingId)) next.delete(drawingId);
      else next.add(drawingId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((d) => d.id)));
    }
  }

  const pendingCount = drawings.filter((d) => d.extractionStatus === "pending").length;
  const needsReviewCount = drawings.filter((d) => {
    const flags = d.flags ? (JSON.parse(d.flags) as string[]) : [];
    return d.extractionStatus === "extracted" && flags.some((f) => f === "NEEDS_REVIEW" || f.startsWith("LOW_CONFIDENCE"));
  }).length;

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;

  return (
    <>
      <div className="p-6 max-w-full">
        {/* Breadcrumb */}
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
            <button
              onClick={deleteProject}
              className="text-sm text-red-600 border border-red-200 px-3 py-2 rounded-lg hover:bg-red-50"
              title="Delete project"
            >
              Delete Project
            </button>
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

        {/* Filter bar + selection actions */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1">
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

          {selectedIds.size > 0 && (
            <button
              onClick={deleteSelected}
              disabled={deleting}
              className="text-sm text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : `Delete ${selectedIds.size} drawing${selectedIds.size !== 1 ? "s" : ""}`}
            </button>
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
                  <th className="text-left px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === filtered.length && filtered.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="text-left px-3 py-2 font-medium">File</th>
                  <th className="text-left px-3 py-2 font-medium">Drawing No</th>
                  <th className="text-left px-3 py-2 font-medium">Title</th>
                  <th className="text-left px-3 py-2 font-medium w-20">Rev</th>
                  <th className="text-left px-3 py-2 font-medium w-28">Rev Date</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium w-24">State</th>
                  <th className="text-left px-3 py-2 font-medium w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const flags = d.flags ? (JSON.parse(d.flags) as string[]) : [];
                  const isCoverSheet = d.extractionStatus === "cover_sheet" || d.documentType === "cover_sheet";
                  const hasConflict = d.conflictDetected;
                  const isSelected = selectedIds.has(d.id);

                  return (
                    <tr
                      key={d.id}
                      className={`border-b border-gray-100 hover:bg-gray-50 ${isCoverSheet ? "bg-purple-50/30" : ""} ${isSelected ? "bg-blue-50" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(d.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {hasConflict && <span className="text-amber-500 text-xs" title="Revision conflict detected">⚠</span>}
                          <span className="text-gray-700 truncate max-w-[140px]" title={`${d.filename} — page ${d.pageNumber + 1}`}>{d.filename}</span>
                          <span className="text-xs text-gray-400 shrink-0">p.{d.pageNumber + 1}</span>
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
                          <button
                            onClick={() => setViewingDrawingId(d.id)}
                            className="text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50"
                          >
                            View
                          </button>
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

      {/* Slide-over */}
      {viewingDrawing && (
        <DrawingSlideOver
          drawing={viewingDrawing}
          projectId={id}
          onClose={() => setViewingDrawingId(null)}
          onSave={saveField}
          onMarkReviewed={markReviewed}
          onMarkPublished={markPublished}
          onNext={goNext}
          onPrev={goPrev}
          hasNext={hasNext}
          hasPrev={hasPrev}
        />
      )}

      {/* Batch Correction Modal */}
      {pendingBatchCorrection && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={() => setPendingBatchCorrection(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slide-up border border-gray-100">
            <div className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${pendingBatchCorrection.isGlobal ? "bg-fuchsia-100 text-fuchsia-600" : "bg-blue-100 text-blue-600"}`}>
                  <BrainCircuit className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Intelligence Detected</h3>
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mt-0.5">
                    {pendingBatchCorrection.isGlobal ? "Architect-Global Pattern" : "Project-Local Inconsistency"}
                  </p>
                </div>
              </div>

              <p className="text-sm text-gray-600 mb-6 leading-relaxed">
                This correction matches <strong className="text-gray-900">{pendingBatchCorrection.count} other drawing{pendingBatchCorrection.count !== 1 ? 's' : ''}</strong> 
                {pendingBatchCorrection.isGlobal ? " across all projects for this architect." : " in this project."} 
                Apply this rule automatically?
              </p>
              
              <div className="bg-gray-50/80 border border-gray-100 rounded-2xl p-5 grid grid-cols-1 gap-4 mb-8">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">Extracted</div>
                    <div className="line-through text-gray-400 font-mono text-sm">{pendingBatchCorrection.original || "—"}</div>
                  </div>
                  <div className="w-8 h-8 flex items-center justify-center text-gray-300">→</div>
                  <div className="text-right">
                    <div className="text-[10px] text-blue-500 font-bold uppercase tracking-widest mb-1">Corrected</div>
                    <div className="text-gray-900 font-bold font-mono text-sm">{pendingBatchCorrection.corrected || "—"}</div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={applyBatchCorrection}
                  className={`w-full py-3 text-sm font-bold text-white rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98] ${pendingBatchCorrection.isGlobal ? "bg-fuchsia-600 hover:bg-fuchsia-700" : "bg-blue-600 hover:bg-blue-700"}`}
                >
                  Yes, Update All {pendingBatchCorrection.count} Drawings
                </button>
                <button
                  onClick={() => setPendingBatchCorrection(null)}
                  className="w-full py-3 text-sm text-gray-500 hover:text-gray-700 font-semibold rounded-xl hover:bg-gray-100 transition-all"
                >
                  No, only correct this one
                </button>
              </div>
            </div>
            
            {pendingBatchCorrection.isGlobal && (
              <div className="bg-fuchsia-50 px-8 py-3 border-t border-fuchsia-100 flex items-center justify-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-fuchsia-500" />
                <span className="text-[10px] font-bold text-fuchsia-700 uppercase tracking-tighter">Reinforcing architect template for future extractions</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
