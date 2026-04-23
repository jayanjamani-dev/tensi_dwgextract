"use client";

import React, { useEffect, useState } from "react";
import {
  Building2,
  Layout,
  BrainCircuit,
  Save,
  Clock,
  Search,
  AlertCircle,
  ChevronRight,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";

interface Template {
  id: string;
  architectId: string;
  titleBlockLocation: string | null;
  revisionBlockLocation: string | null;
  revisionColumnOrder: string | null;
  revisionReadingDirection: string | null;
  fieldLabelMap: string | null;
  valueReplacements: string | null;
  learnedRules: string | null;
  // ── Enriched format intelligence (Task 2) ──────────────────────
  drawingNumberFormatDesc: string | null;
  drawingTitleConventions: string | null;
  revisionNumberFormat: string | null;
  revisionDateFormat: string | null;
  statusTerminology: string | null; // JSON string[]
  lastUpdated: string;
  architect: { firmName: string; firmAddress: string | null };
}

function JsonEditor({ value, onChange, label }: { value: string | null; onChange: (v: string) => void; label: string }) {
  const [raw, setRaw] = useState(value || "{}");
  const [valid, setValid] = useState(true);

  useEffect(() => {
    setRaw(value || "{}");
  }, [value]);

  function handleChange(v: string) {
    setRaw(v);
    try { 
      JSON.parse(v); 
      setValid(true); 
      onChange(v); 
    } catch { 
      setValid(false); 
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>
        {!valid && <span className="text-[10px] text-red-500 font-medium flex items-center gap-1"><AlertCircle className="w-2.5 h-2.5" /> Invalid JSON</span>}
      </div>
      <textarea
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        rows={4}
        className={`w-full font-mono text-[11px] border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 transition-all ${valid ? "border-gray-200" : "border-red-300"}`}
      />
    </div>
  );
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Template>>>({});
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/templates");
    const data = await res.json();
    setTemplates(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function setEdit(id: string, field: string, value: unknown) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function save(id: string) {
    setSaving(id);
    await fetch(`/api/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(edits[id] || {}),
    });
    setSaving(null);
    setEditingId(null);
    load();
  }

  const filtered = templates.filter(t => 
    t.architect.firmName.toLowerCase().includes(search.toLowerCase()) ||
    t.id.toLowerCase().includes(search.toLowerCase())
  );

  if (loading && templates.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-4" />
        <p className="text-gray-500 font-medium animate-pulse">Synchronizing Intelligence...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
            <Layout className="w-8 h-8 text-blue-600" />
            Architect Intelligence Library
          </h1>
          <p className="text-gray-500 mt-2 max-w-2xl">
            Central repository of structural patterns and learned terminology mappings. 
            Rules are automatically extracted from user corrections to reinforce parsing accuracy.
          </p>
        </div>

        <div className="relative group">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-blue-500 transition-colors" />
          <input 
            type="text" 
            placeholder="Search architects or firms..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm w-full md:w-72 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
          />
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-16 text-center shadow-sm">
          <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Sparkles className="w-10 h-10 text-gray-300" />
          </div>
          <h3 className="text-xl font-semibold text-gray-800">Intelligence Engine Dormant</h3>
          <p className="text-gray-500 mt-2 max-w-sm mx-auto">
            Templates are generated automatically upon successful drawing extraction.
            Correction maps will appear here as the system learns your preferences.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden border-separate">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest">Architect Firm</th>
                <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest">Structural Layout</th>
                <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest">Correction Intelligence</th>
                <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((t) => {
                const isEditing = editingId === t.id;
                const edit = edits[t.id] || {};
                const learnedRulesCount = t.learnedRules ? JSON.parse(t.learnedRules).length : 0;
                const vocabCount = t.valueReplacements ? Object.keys(JSON.parse(t.valueReplacements as string)).reduce((acc: number, k: string) => acc + Object.keys((JSON.parse(t.valueReplacements as string) as Record<string, Record<string, string>>)[k]).length, 0) : 0;
                const hasFormatIntel = !!(t.drawingNumberFormatDesc || t.revisionNumberFormat || t.revisionDateFormat || t.statusTerminology);
                const statusTermCount = t.statusTerminology ? (() => { try { return (JSON.parse(t.statusTerminology) as string[]).length; } catch { return 0; } })() : 0;

                return (
                  <React.Fragment key={t.id}>
                    <tr className={`hover:bg-blue-50/30 transition-colors ${isEditing ? "bg-blue-50/50" : ""}`}>
                      <td className="px-6 py-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                            <Building2 className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900 leading-tight">{t.architect.firmName}</div>
                            {t.architect.firmAddress && <div className="text-xs text-gray-400 mt-1 truncate max-w-[180px]">{t.architect.firmAddress}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-6">
                        <div className="flex flex-wrap gap-2">
                          <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-100 border border-gray-200 rounded-md text-[10px] font-bold text-gray-600 uppercase">
                            <Layout className="w-3 h-3" /> Block: {t.titleBlockLocation || "Auto"}
                          </div>
                          <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-100 border border-gray-200 rounded-md text-[10px] font-bold text-gray-600 uppercase">
                            <Clock className="w-3 h-3" /> Revs: {t.revisionBlockLocation || "Default"}
                          </div>
                          {hasFormatIntel && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-md text-[10px] font-bold text-emerald-700 uppercase">
                              <Zap className="w-3 h-3" /> Format Intel
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-6">
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
                              <BrainCircuit className="w-3.5 h-3.5 text-fuchsia-500" /> 
                              {learnedRulesCount} Learned Rule{learnedRulesCount !== 1 ? 's' : ''}
                            </span>
                            <span className="text-[10px] text-gray-400 mt-0.5">{vocabCount} terminology mappings stored</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-6 text-right">
                        <button 
                          onClick={() => setEditingId(isEditing ? null : t.id)}
                          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-all shadow-sm ${isEditing ? "bg-white text-gray-700 border border-gray-200" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                        >
                          {isEditing ? "Cancel" : "Configure Intelligence"}
                          {!isEditing && <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>
                    </tr>
                    
                    {/* Expandable Editing Section */}
                    {isEditing && (
                      <tr>
                        <td colSpan={4} className="px-8 pb-10 bg-blue-50/30">
                          <div className="bg-white border border-blue-200 rounded-2xl shadow-lg p-8 grid grid-cols-1 md:grid-cols-2 gap-8 animate-slide-down">
                            
                            {/* Layout Configuration */}
                            <div className="space-y-6">
                              <div className="flex items-center gap-2 mb-2">
                                <Layout className="w-4 h-4 text-blue-600" />
                                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Extraction Layout</h4>
                              </div>
                              
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Title Block Location</label>
                                  <select
                                    value={(edit.titleBlockLocation ?? t.titleBlockLocation) || ""}
                                    onChange={(e) => setEdit(t.id, "titleBlockLocation", e.target.value)}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                  >
                                    <option value="">unknown</option>
                                    <option value="bottom">bottom</option>
                                    <option value="bottom-right">bottom-right</option>
                                    <option value="right">right</option>
                                    <option value="left">left</option>
                                  </select>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Revision Block</label>
                                  <select
                                    value={(edit.revisionBlockLocation ?? t.revisionBlockLocation) || ""}
                                    onChange={(e) => setEdit(t.id, "revisionBlockLocation", e.target.value)}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                  >
                                    <option value="">unknown</option>
                                    <option value="top-left">top-left</option>
                                    <option value="left-of-title-block">left-of-title-block</option>
                                    <option value="integrated">integrated</option>
                                    <option value="none">none</option>
                                  </select>
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Revision Direction</label>
                                <select
                                  value={(edit.revisionReadingDirection ?? t.revisionReadingDirection) || ""}
                                  onChange={(e) => setEdit(t.id, "revisionReadingDirection", e.target.value)}
                                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                >
                                  <option value="">unknown</option>
                                  <option value="top-to-bottom">top-to-bottom</option>
                                  <option value="bottom-to-top">bottom-to-top</option>
                                </select>
                              </div>

                              <JsonEditor
                                label="Revision Column mapping"
                                value={edit.revisionColumnOrder ?? t.revisionColumnOrder}
                                onChange={(v) => setEdit(t.id, "revisionColumnOrder", v)}
                              />
                            </div>

                            {/* Cognitive Intelligence Configuration */}
                            <div className="space-y-6">
                              <div className="flex items-center gap-2 mb-2">
                                <BrainCircuit className="w-4 h-4 text-fuchsia-600" />
                                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Neural Corrections</h4>
                              </div>

                              <JsonEditor
                                label="Field Label Overrides"
                                value={edit.fieldLabelMap ?? t.fieldLabelMap}
                                onChange={(v) => setEdit(t.id, "fieldLabelMap", v)}
                              />

                              <div className="bg-fuchsia-50/50 border border-fuchsia-100 rounded-xl p-4">
                                <div className="flex items-start gap-3">
                                  <Sparkles className="w-5 h-5 text-fuchsia-500 mt-0.5" />
                                  <div>
                                    <div className="text-xs font-bold text-fuchsia-900 uppercase tracking-wide mb-1">Implicit Pattern Engine</div>
                                    <p className="text-xs text-fuchsia-800/80 leading-relaxed">
                                      This architect has <span className="font-bold underline">{learnedRulesCount} active structural rules</span> and <span className="font-bold underline">{vocabCount} correction mappings</span>.
                                      These are updated automatically when you correct a drawing in the viewer.
                                    </p>
                                    <div className="mt-3 flex gap-2">
                                      <button
                                        onClick={async () => {
                                          if (!confirm(`Reset all AI-learned corrections for ${t.architect.firmName}? This clears valueReplacements and learnedRules. The structural pattern (bbox) is kept.`)) return;
                                          await fetch(`/api/templates/${t.id}`, {
                                            method: "PATCH",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ valueReplacements: null, learnedRules: null }),
                                          });
                                          load();
                                        }}
                                        className="text-[10px] font-bold text-red-600 bg-white border border-red-200 rounded px-2 py-1 hover:bg-red-50 transition-colors uppercase tracking-wider flex items-center gap-1"
                                      >
                                        <Trash2 className="w-2.5 h-2.5" /> Reset Corrections
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Footer Actions */}
                              <div className="pt-4 flex items-center justify-between border-t border-gray-100">
                                <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                  <Clock className="w-3 h-3" /> Last Indexed: {new Date(t.lastUpdated).toLocaleDateString()}
                                </div>
                                <div className="flex gap-3">
                                  <button
                                    onClick={() => setEditingId(null)}
                                    className="px-4 py-2 text-sm font-semibold text-gray-600 rounded-xl hover:bg-gray-50 transition-all border border-transparent"
                                  >
                                    Discard
                                  </button>
                                  <button
                                    onClick={() => save(t.id)}
                                    disabled={saving === t.id || !edits[t.id]}
                                    className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all shadow-md active:scale-95"
                                  >
                                    {saving === t.id ? (
                                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                    ) : (
                                      <Save className="w-4 h-4" />
                                    )}
                                    Synchronize Rules
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* ── Format Intelligence Section (full width) ── */}
                            <div className="col-span-1 md:col-span-2 border-t border-gray-100 pt-6 space-y-5">
                              <div className="flex items-center gap-2">
                                <Zap className="w-4 h-4 text-emerald-600" />
                                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Format Intelligence</h4>
                                <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-semibold ml-1">Auto-detected · editable</span>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Drawing Number Format</label>
                                  <input
                                    type="text"
                                    value={(edit.drawingNumberFormatDesc ?? t.drawingNumberFormatDesc) || ""}
                                    onChange={(e) => setEdit(t.id, "drawingNumberFormatDesc", e.target.value || null)}
                                    placeholder="e.g. Letter prefix + 3 digits"
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50 transition-all"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Drawing Title Conventions</label>
                                  <input
                                    type="text"
                                    value={(edit.drawingTitleConventions ?? t.drawingTitleConventions) || ""}
                                    onChange={(e) => setEdit(t.id, "drawingTitleConventions", e.target.value || null)}
                                    placeholder="e.g. ALL-CAPS, multi-line combined"
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50 transition-all"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Revision Number Format</label>
                                  <input
                                    type="text"
                                    value={(edit.revisionNumberFormat ?? t.revisionNumberFormat) || ""}
                                    onChange={(e) => setEdit(t.id, "revisionNumberFormat", e.target.value || null)}
                                    placeholder="e.g. Single letter (A, B, C)"
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50 transition-all"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Revision Date Format</label>
                                  <input
                                    type="text"
                                    value={(edit.revisionDateFormat ?? t.revisionDateFormat) || ""}
                                    onChange={(e) => setEdit(t.id, "revisionDateFormat", e.target.value || null)}
                                    placeholder="e.g. DD/MM/YYYY"
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50 transition-all"
                                  />
                                </div>
                              </div>

                              {/* Status Terminology Tags */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                    Observed Status Terminology
                                    {statusTermCount > 0 && <span className="ml-2 text-emerald-600 font-bold">{statusTermCount} value{statusTermCount !== 1 ? "s" : ""}</span>}
                                  </label>
                                </div>
                                <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 bg-gray-50 border border-gray-200 rounded-lg">
                                  {(() => {
                                    const statusTermValue = edit.statusTerminology ?? t.statusTerminology;
                                    if (!statusTermValue) {
                                      return <span className="text-[10px] text-gray-400 italic self-center">No status values observed yet — will populate automatically during extraction</span>;
                                    }
                                    try {
                                      const terms = JSON.parse(statusTermValue) as string[];
                                      if (terms.length === 0) {
                                        return <span className="text-[10px] text-gray-400 italic self-center">No status values observed yet</span>;
                                      }
                                      return terms.map((term) => (
                                        <span key={term} className="inline-flex items-center px-2.5 py-1 text-[10px] font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 whitespace-nowrap">
                                          {term}
                                        </span>
                                      ));
                                    } catch {
                                      return <span className="text-[10px] text-red-400 italic self-center flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Invalid JSON in statusTerminology</span>;
                                    }
                                  })()}
                                </div>
                                <p className="text-[10px] text-gray-400">
                                  Populated automatically from each successful extraction. Used to build the normalisation vocabulary for this architect.
                                </p>
                              </div>
                            </div>

                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


