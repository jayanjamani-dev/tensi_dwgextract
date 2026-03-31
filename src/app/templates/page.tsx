"use client";

import { useEffect, useState } from "react";

interface Template {
  id: string;
  architectId: string;
  titleBlockLocation: string | null;
  revisionBlockLocation: string | null;
  revisionColumnOrder: string | null;
  revisionReadingDirection: string | null;
  fieldLabelMap: string | null;
  lastUpdated: string;
  architect: { firmName: string; firmAddress: string | null };
}

function JsonEditor({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const [raw, setRaw] = useState(value || "{}");
  const [valid, setValid] = useState(true);

  function handleChange(v: string) {
    setRaw(v);
    try { JSON.parse(v); setValid(true); onChange(v); } catch { setValid(false); }
  }

  return (
    <textarea
      value={raw}
      onChange={(e) => handleChange(e.target.value)}
      rows={4}
      className={`w-full font-mono text-xs border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900 ${valid ? "border-gray-200" : "border-red-400"}`}
    />
  );
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Template>>>({});
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/templates");
    setTemplates(await res.json());
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
    load();
  }

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-2">Template Library</h1>
      <p className="text-sm text-gray-500 mb-6">Stored patterns per architect firm. Used to guide Gemini extraction on known templates.</p>

      {templates.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No templates yet. They are created automatically when drawings are extracted.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {templates.map((t) => {
            const isExpanded = expanded === t.id;
            const edit = edits[t.id] || {};

            return (
              <div key={t.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50"
                  onClick={() => setExpanded(isExpanded ? null : t.id)}
                >
                  <div>
                    <div className="font-medium">{t.architect.firmName}</div>
                    {t.architect.firmAddress && <div className="text-xs text-gray-500 mt-0.5">{t.architect.firmAddress}</div>}
                  </div>
                  <span className="text-gray-400 text-sm">{isExpanded ? "▲" : "▼"}</span>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-gray-100 pt-4 flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-medium text-gray-500 uppercase block mb-1">Title Block Location</label>
                        <select
                          value={(edit.titleBlockLocation ?? t.titleBlockLocation) || ""}
                          onChange={(e) => setEdit(t.id, "titleBlockLocation", e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                        >
                          <option value="">unknown</option>
                          <option value="bottom">bottom</option>
                          <option value="bottom-right">bottom-right</option>
                          <option value="right">right</option>
                          <option value="left">left</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 uppercase block mb-1">Revision Block Location</label>
                        <select
                          value={(edit.revisionBlockLocation ?? t.revisionBlockLocation) || ""}
                          onChange={(e) => setEdit(t.id, "revisionBlockLocation", e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                        >
                          <option value="">unknown</option>
                          <option value="top-left">top-left</option>
                          <option value="left-of-title-block">left-of-title-block</option>
                          <option value="integrated">integrated</option>
                          <option value="none">none</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 uppercase block mb-1">Revision Reading Direction</label>
                        <select
                          value={(edit.revisionReadingDirection ?? t.revisionReadingDirection) || ""}
                          onChange={(e) => setEdit(t.id, "revisionReadingDirection", e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                        >
                          <option value="">unknown</option>
                          <option value="top-to-bottom">top-to-bottom</option>
                          <option value="bottom-to-top">bottom-to-top</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase block mb-1">
                        Revision Column Order (JSON array, e.g. ["rev","date","description","by"])
                      </label>
                      <JsonEditor
                        value={edit.revisionColumnOrder ?? t.revisionColumnOrder}
                        onChange={(v) => setEdit(t.id, "revisionColumnOrder", v)}
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase block mb-1">
                        Field Label Map (JSON, maps discovered labels → canonical names)
                      </label>
                      <JsonEditor
                        value={edit.fieldLabelMap ?? t.fieldLabelMap}
                        onChange={(v) => setEdit(t.id, "fieldLabelMap", v)}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Last updated {new Date(t.lastUpdated).toLocaleDateString()}</span>
                      <button
                        onClick={() => save(t.id)}
                        disabled={saving === t.id || !edits[t.id]}
                        className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-50"
                      >
                        {saving === t.id ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
