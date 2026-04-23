"use client";

import { useState, useEffect, useRef } from "react";
import {
  Search, Trash2, Edit2, Check, X, ShieldAlert, BrainCircuit, ScanLine,
  BookOpen, Plus, GripVertical, AlertTriangle, ChevronDown
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ExtractionRule {
  id: number;
  field: string;
  rule: string;
}

type MainTab = "core" | "ml" | "patterns" | "system";

// ── Field options for dropdowns ──────────────────────────────────────────────
const FIELD_OPTIONS = [
  "Drawing Number",
  "Drawing Title",
  "Revision",
  "Revision Date",
  "Status",
  "Location",
  "Coordinates",
  "All Fields",
];

// ── Field badge colours ───────────────────────────────────────────────────────
const FIELD_COLOURS: Record<string, string> = {
  "Drawing Number": "bg-blue-50 text-blue-700 border-blue-200",
  "Drawing Title":  "bg-violet-50 text-violet-700 border-violet-200",
  "Revision":       "bg-amber-50 text-amber-700 border-amber-200",
  "Revision Date":  "bg-orange-50 text-orange-700 border-orange-200",
  "Status":         "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Location":       "bg-cyan-50 text-cyan-700 border-cyan-200",
  "Coordinates":    "bg-rose-50 text-rose-700 border-rose-200",
  "All Fields":     "bg-gray-100 text-gray-700 border-gray-300",
};

// ── EditableRuleRow ───────────────────────────────────────────────────────────

function EditableRuleRow({
  rule,
  onSave,
  onDelete,
  isNew,
  onCancelNew,
}: {
  rule: ExtractionRule;
  onSave: (updated: ExtractionRule) => void;
  onDelete: (id: number) => void;
  isNew?: boolean;
  onCancelNew?: () => void;
}) {
  const [editing, setEditing] = useState(isNew ?? false);
  const [draft, setDraft] = useState<ExtractionRule>({ ...rule });
  const ruleRef = useRef<HTMLTextAreaElement>(null);

  function handleSave() {
    if (!draft.field.trim() || !draft.rule.trim()) return;
    onSave(draft);
    setEditing(false);
  }

  function handleCancel() {
    if (isNew) {
      onCancelNew?.();
    } else {
      setDraft({ ...rule });
      setEditing(false);
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    if (editing && ruleRef.current) {
      ruleRef.current.style.height = "auto";
      ruleRef.current.style.height = ruleRef.current.scrollHeight + "px";
    }
  }, [editing, draft.rule]);

  const fieldColour = FIELD_COLOURS[rule.field] ?? "bg-gray-100 text-gray-600 border-gray-200";
  const draftFieldColour = FIELD_COLOURS[draft.field] ?? "bg-gray-100 text-gray-600 border-gray-200";

  if (!editing) {
    return (
      <tr className="group hover:bg-gray-50/60 transition-colors border-b border-gray-100 last:border-0">
        <td className="px-3 py-2.5 text-xs text-gray-400 font-mono w-10 text-right select-none">{rule.id}</td>
        <td className="px-3 py-2.5 w-40">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${fieldColour}`}>
            {rule.field}
          </span>
        </td>
        <td className="px-3 py-2.5 text-sm text-gray-700 leading-snug">{rule.rule}</td>
        <td className="px-3 py-2.5 w-20">
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
            <button
              onClick={() => setEditing(true)}
              className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
              title="Edit rule"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDelete(rule.id)}
              className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Delete rule"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-blue-50/30 border-b border-blue-100">
      <td className="px-3 py-2 text-xs text-gray-400 font-mono w-10 text-right">{draft.id}</td>
      <td className="px-3 py-2 w-40">
        <div className="relative">
          <select
            value={draft.field}
            onChange={(e) => setDraft({ ...draft, field: e.target.value })}
            className={`w-full text-xs font-medium rounded border px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none pr-6 ${draftFieldColour}`}
          >
            {FIELD_OPTIONS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-current opacity-60" />
        </div>
      </td>
      <td className="px-3 py-2">
        <textarea
          ref={ruleRef}
          value={draft.rule}
          onChange={(e) => {
            setDraft({ ...draft, rule: e.target.value });
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
          }}
          rows={2}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none leading-snug"
          placeholder="Rule description…"
          autoFocus
        />
      </td>
      <td className="px-3 py-2 w-20">
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={handleSave}
            disabled={!draft.field.trim() || !draft.rule.trim()}
            className="p-1 rounded text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40"
            title="Save"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={handleCancel}
            className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RulesPage() {
  const [activeTab, setActiveTab] = useState<MainTab>("core");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<{
    systemRules: any[];
    learnedVocabulary: any[];
    learnedPatterns: any[];
    extractionRules: ExtractionRule[];
  } | null>(null);

  // Core (Status Normalisation) state
  const [editingSystemRules, setEditingSystemRules] = useState(false);
  const [systemMappingDraft, setSystemMappingDraft] = useState<Record<string, string>>({});

  // System Rules (Extraction Rules) state
  const [extractionRules, setExtractionRules] = useState<ExtractionRule[]>([]);
  const [addingNew, setAddingNew] = useState(false);
  const [savingExtractionRules, setSavingExtractionRules] = useState(false);
  const [filterField, setFilterField] = useState<string>("All");

  useEffect(() => { fetchRules(); }, []);

  const fetchRules = async () => {
    const res = await fetch("/api/rules");
    if (res.ok) {
      const json = await res.json();
      setData(json);

      const statusRule = json.systemRules.find((r: any) => r.ruleType === "STATUS_NORMALISATION");
      if (statusRule?.content) {
        try { setSystemMappingDraft(JSON.parse(statusRule.content)); } catch { setSystemMappingDraft({}); }
      }

      if (json.extractionRules) {
        setExtractionRules(json.extractionRules);
      }
    }
  };

  // ── Core tab handlers ─────────────────────────────────────────────────────

  const handleSaveSystemRules = async () => {
    await fetch("/api/rules/system", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapping: systemMappingDraft }),
    });
    setEditingSystemRules(false);
    fetchRules();
  };

  const handleDeleteMLRule = async (architectId: string, field: string, original: string) => {
    if (!confirm(`Delete the mapping "${original}" for field "${field}"?`)) return;
    await fetch(`/api/architects/${architectId}/rules`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, original }),
    });
    fetchRules();
  };

  // ── Extraction rules tab handlers ──────────────────────────────────────────

  const handleSaveExtractionRule = async (updated: ExtractionRule) => {
    const next = extractionRules.map((r) => (r.id === updated.id ? updated : r));
    setExtractionRules(next);
    await persistExtractionRules(next);
  };

  const handleDeleteExtractionRule = async (id: number) => {
    if (!confirm("Delete this rule?")) return;
    const next = extractionRules.filter((r) => r.id !== id);
    setExtractionRules(next);
    await persistExtractionRules(next);
  };

  const handleAddNewRule = (newRule: ExtractionRule) => {
    // Assign next id
    const maxId = extractionRules.reduce((m, r) => Math.max(m, r.id), 0);
    const rule = { ...newRule, id: maxId + 1 };
    const next = [...extractionRules, rule];
    setExtractionRules(next);
    setAddingNew(false);
    persistExtractionRules(next);
  };

  const persistExtractionRules = async (rules: ExtractionRule[]) => {
    setSavingExtractionRules(true);
    await fetch("/api/rules/system", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ruleType: "EXTRACTION_RULES", rules }),
    });
    setSavingExtractionRules(false);
  };

  if (!data) {
    return (
      <div className="p-8 flex items-center justify-center text-gray-400 animate-pulse">
        Loading Intelligence Engine…
      </div>
    );
  }

  // Filtered extraction rules
  const filteredExtraction = extractionRules.filter((r) => {
    const matchesSearch = (r.field + r.rule).toLowerCase().includes(search.toLowerCase());
    const matchesField = filterField === "All" || r.field === filterField;
    return matchesSearch && matchesField;
  });

  // Field counts for filter badges
  const fieldCounts: Record<string, number> = {};
  for (const r of extractionRules) {
    fieldCounts[r.field] = (fieldCounts[r.field] ?? 0) + 1;
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1 text-gray-900">System Rules Engine</h1>
          <p className="text-gray-500 text-sm">
            Manage extraction rules, status normalisation, and monitor learned architect patterns.
          </p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search rules, architects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm"
          />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex space-x-1 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab("system")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "system"
              ? "border-indigo-500 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          <BookOpen className="w-4 h-4" /> System Rules
          <span className="ml-1.5 py-0.5 px-2 rounded-full bg-gray-100 text-gray-600 text-xs">
            {extractionRules.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab("core")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "core"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          <ShieldAlert className="w-4 h-4" /> Global Logic
        </button>
        <button
          onClick={() => setActiveTab("ml")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "ml"
              ? "border-fuchsia-500 text-fuchsia-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          <BrainCircuit className="w-4 h-4" /> Learned Terminology
          <span className="ml-1.5 py-0.5 px-2 rounded-full bg-gray-100 text-gray-600 text-xs">
            {data.learnedVocabulary.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab("patterns")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "patterns"
              ? "border-emerald-500 text-emerald-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
        >
          <ScanLine className="w-4 h-4" /> Locked Patterns
          <span className="ml-1.5 py-0.5 px-2 rounded-full bg-gray-100 text-gray-600 text-xs">
            {data.learnedPatterns.length}
          </span>
        </button>
      </div>

      {/* ── SYSTEM RULES TAB ─────────────────────────────────────────────────── */}
      {activeTab === "system" && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-wrap gap-3 items-center justify-between p-4 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Field filter */}
              {["All", ...FIELD_OPTIONS].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterField(f)}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                    filterField === f
                      ? (FIELD_COLOURS[f] ?? "bg-indigo-50 text-indigo-700 border-indigo-200")
                      : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {f}
                  {f !== "All" && fieldCounts[f] != null && (
                    <span className="ml-1 opacity-60">{fieldCounts[f]}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {savingExtractionRules && (
                <span className="text-xs text-gray-400 animate-pulse">Saving…</span>
              )}
              <button
                onClick={() => setAddingNew(true)}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg shadow-sm transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Rule
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-y-auto" style={{ maxHeight: "70vh" }}>
            <table className="w-full text-left text-sm">
              <thead className="bg-white sticky top-0 border-b border-gray-200 z-10">
                <tr>
                  <th className="px-3 py-2.5 font-medium text-gray-400 text-xs text-right w-10">#</th>
                  <th className="px-3 py-2.5 font-medium text-gray-500 text-xs w-40">Field</th>
                  <th className="px-3 py-2.5 font-medium text-gray-500 text-xs">Rule</th>
                  <th className="px-3 py-2.5 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filteredExtraction.length === 0 && !addingNew && (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-gray-400 text-sm">
                      {search || filterField !== "All"
                        ? "No rules match the current filter."
                        : "No extraction rules defined yet."}
                    </td>
                  </tr>
                )}

                {filteredExtraction.map((rule) => (
                  <EditableRuleRow
                    key={rule.id}
                    rule={rule}
                    onSave={handleSaveExtractionRule}
                    onDelete={handleDeleteExtractionRule}
                  />
                ))}

                {/* New row form */}
                {addingNew && (
                  <EditableRuleRow
                    key="new"
                    rule={{ id: 0, field: FIELD_OPTIONS[0], rule: "" }}
                    onSave={handleAddNewRule}
                    onDelete={() => setAddingNew(false)}
                    isNew
                    onCancelNew={() => setAddingNew(false)}
                  />
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
            <span>{filteredExtraction.length} rule{filteredExtraction.length !== 1 ? "s" : ""} shown</span>
            <span className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              Changes are saved immediately
            </span>
          </div>
        </div>
      )}

      {/* ── GLOBAL LOGIC TAB ─────────────────────────────────────────────────── */}
      {activeTab === "core" && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex justify-between items-center p-4 border-b border-gray-100 bg-gray-50">
            <h2 className="font-medium text-gray-800">Status Normalisation Matrix</h2>
            {!editingSystemRules ? (
              <button
                onClick={() => setEditingSystemRules(true)}
                className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-md font-medium transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5" /> Edit Matrix
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingSystemRules(false)}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 bg-gray-100 px-3 py-1.5 rounded-md transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
                <button
                  onClick={handleSaveSystemRules}
                  className="flex items-center gap-2 text-sm text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-md font-medium shadow-sm transition-colors"
                >
                  <Check className="w-3.5 h-3.5" /> Save Changes
                </button>
              </div>
            )}
          </div>
          <div className="p-0 max-h-[600px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-white sticky top-0 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-500">Raw Extracted String</th>
                  <th className="px-4 py-3 font-medium text-gray-500">Target Canonical Resolution</th>
                  {editingSystemRules && <th className="px-4 py-3 w-16 text-center"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {Object.entries(
                  !editingSystemRules
                    ? (data.systemRules.find((r) => r.ruleType === "STATUS_NORMALISATION")?.content
                        ? JSON.parse(data.systemRules.find((r) => r.ruleType === "STATUS_NORMALISATION").content)
                        : {})
                    : systemMappingDraft
                )
                  .filter(([key, val]) => (key + val).toLowerCase().includes(search.toLowerCase()))
                  .map(([key, val]) => (
                    <tr key={key} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{key}</code>
                      </td>
                      <td className="px-4 py-3">
                        {!editingSystemRules ? (
                          <span className="font-medium text-blue-700">{val as string}</span>
                        ) : (
                          <input
                            type="text"
                            className="border border-gray-300 rounded px-2 py-1 w-full sm:w-64 focus:ring-blue-500"
                            value={val as string}
                            onChange={(e) =>
                              setSystemMappingDraft((p) => ({ ...p, [key]: e.target.value }))
                            }
                          />
                        )}
                      </td>
                      {editingSystemRules && (
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => {
                              const next = { ...systemMappingDraft };
                              delete next[key];
                              setSystemMappingDraft(next);
                            }}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                {editingSystemRules && (
                  <tr>
                    <td colSpan={3} className="px-4 py-3 bg-gray-50 text-center border-t border-gray-100">
                      <button
                        onClick={() => {
                          const newKey = prompt("Raw status string (e.g. 'for info'):");
                          if (!newKey) return;
                          if (systemMappingDraft[newKey]) { alert("Already mapped!"); return; }
                          const newVal = prompt("Canonical status (e.g. 'For Information'):");
                          if (!newVal) return;
                          setSystemMappingDraft((p) => ({ ...p, [newKey]: newVal }));
                        }}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700"
                      >
                        + Add New Mapping
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── LEARNED TERMINOLOGY TAB ───────────────────────────────────────────── */}
      {activeTab === "ml" && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-500">Architect Firm</th>
                <th className="px-4 py-3 font-medium text-gray-500">Field Target</th>
                <th className="px-4 py-3 font-medium text-gray-500">Raw Input</th>
                <th className="px-4 py-3 font-medium text-gray-500">AI Remapped To</th>
                <th className="px-4 py-3 w-16 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.learnedVocabulary
                .filter((v) =>
                  (v.architectName + v.field + v.original + v.corrected)
                    .toLowerCase()
                    .includes(search.toLowerCase())
                )
                .map((voc) => (
                  <tr key={voc.idx} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-gray-700">{voc.architectName}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-fuchsia-100 text-fuchsia-800">
                        {voc.field}
                      </span>
                    </td>
                    <td className="px-4 py-3"><code className="text-gray-500">"{voc.original}"</code></td>
                    <td className="px-4 py-3 font-medium text-gray-900">{voc.corrected}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleDeleteMLRule(voc.architectId, voc.field, voc.original)}
                        className="text-gray-400 hover:text-red-500 transition-colors p-1"
                        title="Delete learned mapping"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              {data.learnedVocabulary.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500">
                    No ML terminology learned yet. Correct fields in the viewer to populate this matrix.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── LOCKED PATTERNS TAB ───────────────────────────────────────────────── */}
      {activeTab === "patterns" && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-500">Architect Firm</th>
                <th className="px-4 py-3 font-medium text-gray-500">Title Block</th>
                <th className="px-4 py-3 font-medium text-gray-500">Revision Block</th>
                <th className="px-4 py-3 font-medium text-gray-500">Auto-Crop Boundary</th>
                <th className="px-4 py-3 font-medium text-gray-500">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.learnedPatterns
                .filter((p) =>
                  (p.architectName + p.titleBlockLocation)
                    .toLowerCase()
                    .includes(search.toLowerCase())
                )
                .map((pat) => (
                  <tr key={pat.architectId} className="hover:bg-emerald-50/30">
                    <td className="px-4 py-3 font-medium text-gray-700">{pat.architectName}</td>
                    <td className="px-4 py-3">
                      {pat.titleBlockLocation === "unknown" ? (
                        <span className="text-gray-400">Scanning…</span>
                      ) : (
                        <span className="capitalize">{pat.titleBlockLocation}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {pat.revisionBlockLocation === "unknown" ? (
                        <span className="text-gray-400">Scanning…</span>
                      ) : (
                        <span className="capitalize">{pat.revisionBlockLocation}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {pat.pattern ? (
                        <code className="text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                          [{Math.round(pat.pattern.bbox.x0)}, {Math.round(pat.pattern.bbox.y0)}] → [
                          {Math.round(pat.pattern.bbox.x1)}, {Math.round(pat.pattern.bbox.y1)}]
                        </code>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {pat.pattern ? (
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 transition-all"
                              style={{ width: `${Math.min(100, (pat.pattern.confirmedDrawingCount / 2) * 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500">{pat.pattern.confirmedDrawingCount} hits</span>
                        </div>
                      ) : (
                        <span className="text-gray-400">Building profile…</span>
                      )}
                    </td>
                  </tr>
                ))}
              {data.learnedPatterns.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500">
                    No structural layouts locked yet. Extract drawings to build profiles.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
