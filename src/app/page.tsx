"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  _count: { drawings: number };
  drawings: { extractionStatus: string }[];
}

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  async function deleteProject(projectId: string) {
    await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    load();
  }

  async function load() {
    const res = await fetch("/api/projects");
    setProjects(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || null }),
    });
    setNewName("");
    setNewDesc("");
    setShowForm(false);
    setCreating(false);
    load();
  }

  function statusSummary(drawings: { extractionStatus: string }[]) {
    const counts: Record<string, number> = {};
    for (const d of drawings) counts[d.extractionStatus] = (counts[d.extractionStatus] || 0) + 1;
    return counts;
  }

  const statusColors: Record<string, string> = {
    pending: "bg-gray-100 text-gray-600",
    processing: "bg-blue-100 text-blue-700",
    extracted: "bg-yellow-100 text-yellow-700",
    cover_sheet: "bg-purple-100 text-purple-700",
    reviewed: "bg-green-100 text-green-700",
    published: "bg-emerald-100 text-emerald-700",
  };

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700"
        >
          + New Project
        </button>
      </div>

      {showForm && (
        <form onSubmit={createProject} className="bg-white border border-gray-200 rounded-xl p-5 mb-6 flex flex-col gap-3">
          <h2 className="font-medium text-sm text-gray-700">New Project</h2>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Project name (e.g. Waterman)"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            autoFocus
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="bg-gray-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No projects yet.</p>
          <p className="text-sm mt-1">Create one to start uploading drawings.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {projects.map((p) => {
            const summary = statusSummary(p.drawings);
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-400 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    {p.description && <div className="text-sm text-gray-500 mt-0.5">{p.description}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-sm text-gray-400">{p._count.drawings} drawing{p._count.drawings !== 1 ? "s" : ""}</div>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteProject(p.id); }}
                      className="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50"
                      title="Delete project"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {p.drawings.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {Object.entries(summary).map(([status, count]) => (
                      <span
                        key={status}
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[status] || "bg-gray-100 text-gray-600"}`}
                      >
                        {count} {status.replace("_", " ")}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
