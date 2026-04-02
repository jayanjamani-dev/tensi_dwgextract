"use client";

import { useState, useEffect } from "react";
import { Search, Trash2, Edit2, Check, X, ShieldAlert, BrainCircuit, ScanLine } from "lucide-react";

export default function RulesPage() {
  const [activeTab, setActiveTab] = useState<"core" | "ml" | "patterns">("core");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<{
    systemRules: any[];
    learnedVocabulary: any[];
    learnedPatterns: any[];
  } | null>(null);

  const [editingSystemRules, setEditingSystemRules] = useState(false);
  const [systemMappingDraft, setSystemMappingDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    const res = await fetch("/api/rules");
    if (res.ok) {
      const json = await res.json();
      setData(json);
      
      const statusRule = json.systemRules.find((r: any) => r.ruleType === "STATUS_NORMALISATION");
      if (statusRule && statusRule.content) {
        try {
          setSystemMappingDraft(JSON.parse(statusRule.content));
        } catch {
          setSystemMappingDraft({});
        }
      }
    }
  };

  const handleSaveSystemRules = async () => {
    await fetch("/api/rules/system", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapping: systemMappingDraft })
    });
    setEditingSystemRules(false);
    fetchRules();
  };

  const handleDeleteMLRule = async (architectId: string, field: string, original: string) => {
    if (!confirm(`Are you sure you want to delete the mapping "${original}" for field "${field}"?`)) return;
    
    await fetch(`/api/architects/${architectId}/rules`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, original })
    });
    
    fetchRules();
  };

  const handleUpdateDraft = (key: string, value: string) => {
    setSystemMappingDraft(prev => ({ ...prev, [key]: value }));
  };

  const handleAddDraftRow = () => {
    const newKey = prompt("Enter the raw status string (e.g. 'for info'):");
    if (!newKey) return;
    if (systemMappingDraft[newKey]) {
      alert("This string is already mapped!");
      return;
    }
    const newVal = prompt("Enter the canonical status string (e.g. 'For Information'):");
    if (!newVal) return;
    
    setSystemMappingDraft(prev => ({ ...prev, [newKey]: newVal }));
  };

  const handleDeleteDraftRow = (key: string) => {
    const next = { ...systemMappingDraft };
    delete next[key];
    setSystemMappingDraft(next);
  };

  if (!data) return <div className="p-8 animate-pulse flex items-center justify-center text-gray-400">Loading Intelligence Engine...</div>;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-2 text-gray-900">System Rules Engine</h1>
          <p className="text-gray-500 text-sm">
            Manage strict global parsing rules and monitor the neural vocabulary continuously learned per-architect.
          </p>
        </div>
        
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input 
            type="text" 
            placeholder="Search rules, architects..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm"
          />
        </div>
      </div>

      <div className="flex space-x-1 mb-6 border-b border-gray-200">
        <button 
          onClick={() => setActiveTab("core")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "core" ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}
        >
          <ShieldAlert className="w-4 h-4" /> Global Logic
        </button>
        <button 
          onClick={() => setActiveTab("ml")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "ml" ? "border-fuchsia-500 text-fuchsia-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}
        >
          <BrainCircuit className="w-4 h-4" /> Learned Terminology
          <span className="ml-1.5 py-0.5 px-2 rounded-full bg-gray-100 text-gray-600 text-xs">{data.learnedVocabulary.length}</span>
        </button>
        <button 
          onClick={() => setActiveTab("patterns")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "patterns" ? "border-emerald-500 text-emerald-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}
        >
          <ScanLine className="w-4 h-4" /> Locked Patterns
          <span className="ml-1.5 py-0.5 px-2 rounded-full bg-gray-100 text-gray-600 text-xs">{data.learnedPatterns.length}</span>
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {activeTab === "core" && (
          <div>
            <div className="flex justify-between items-center p-4 border-b border-gray-100 bg-gray-50">
              <h2 className="font-medium text-gray-800">Status Normalisation Matrix</h2>
              {!editingSystemRules ? (
                <button onClick={() => setEditingSystemRules(true)} className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-md font-medium transition-colors">
                  <Edit2 className="w-3.5 h-3.5" /> Edit Matrix
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditingSystemRules(false)} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 bg-gray-100 px-3 py-1.5 rounded-md transition-colors">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                  <button onClick={handleSaveSystemRules} className="flex items-center gap-2 text-sm text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-md font-medium shadow-sm transition-colors">
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
                  {Object.entries(!editingSystemRules ? (data.systemRules.find(r => r.ruleType === "STATUS_NORMALISATION")?.content ? JSON.parse(data.systemRules.find(r => r.ruleType === "STATUS_NORMALISATION").content) : {}) : systemMappingDraft)
                    .filter(([key, val]) => (key+val).toLowerCase().includes(search.toLowerCase()))
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
                            onChange={(e) => handleUpdateDraft(key, e.target.value)}
                          />
                        )}
                      </td>
                      {editingSystemRules && (
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => handleDeleteDraftRow(key)} className="text-gray-400 hover:text-red-500 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {editingSystemRules && (
                    <tr>
                      <td colSpan={3} className="px-4 py-3 bg-gray-50 text-center border-t border-gray-100">
                        <button onClick={handleAddDraftRow} className="text-sm font-medium text-blue-600 hover:text-blue-700">
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

        {activeTab === "ml" && (
          <div className="p-0">
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
                    .filter(v => (v.architectName + v.field + v.original + v.corrected).toLowerCase().includes(search.toLowerCase()))
                    .map((voc) => (
                    <tr key={voc.idx} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium text-gray-700">{voc.architectName}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-fuchsia-100 text-fuchsia-800">
                          {voc.field}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-gray-500">"{voc.original}"</code>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {voc.corrected}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button 
                          onClick={() => handleDeleteMLRule(voc.architectId, voc.field, voc.original)}
                          className="text-gray-400 hover:text-red-500 transition-colors p-1"
                          title="Delete this learned mapping"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {data.learnedVocabulary.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-500">No ML terminology learned yet. Correct fields in the viewer to populate this matrix.</td>
                    </tr>
                  )}
                </tbody>
              </table>
          </div>
        )}

        {activeTab === "patterns" && (
          <div className="p-0">
             <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 font-medium text-gray-500">Architect Firm</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Title Block Location</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Revision Block Location</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Auto-Crop Boundary</th>
                    <th className="px-4 py-3 font-medium text-gray-500">Confidence Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.learnedPatterns
                    .filter(p => (p.architectName + p.titleBlockLocation).toLowerCase().includes(search.toLowerCase()))
                    .map((pat) => (
                    <tr key={pat.architectId} className="hover:bg-emerald-50/30">
                      <td className="px-4 py-3 font-medium text-gray-700">{pat.architectName}</td>
                      <td className="px-4 py-3">
                        {pat.titleBlockLocation === "unknown" ? <span className="text-gray-400">Scanning...</span> : <span className="capitalize">{pat.titleBlockLocation}</span>}
                      </td>
                      <td className="px-4 py-3">
                         {pat.revisionBlockLocation === "unknown" ? <span className="text-gray-400">Scanning...</span> : <span className="capitalize">{pat.revisionBlockLocation}</span>}
                      </td>
                      <td className="px-4 py-3">
                        {pat.pattern ? (
                          <code className="text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                            [{Math.round(pat.pattern.bbox.x0)}, {Math.round(pat.pattern.bbox.y0)}] → [{Math.round(pat.pattern.bbox.x1)}, {Math.round(pat.pattern.bbox.y1)}]
                          </code>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                       <td className="px-4 py-3">
                        {pat.pattern ? (
                          <div className="flex items-center gap-2">
                             <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                               <div className="h-full bg-emerald-500 transition-all" style={{width: `${Math.min(100, (pat.pattern.confirmedDrawingCount / 2) * 100)}%`}}></div>
                             </div>
                             <span className="text-xs text-gray-500">{pat.pattern.confirmedDrawingCount} hits</span>
                          </div>
                        ) : <span className="text-gray-400">Building profile...</span>}
                      </td>
                    </tr>
                  ))}
                  {data.learnedPatterns.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-500">No structural layouts locked yet. Extract drawings to build profiles.</td>
                    </tr>
                  )}
                </tbody>
              </table>
          </div>
        )}
      </div>
    </div>
  );
}
