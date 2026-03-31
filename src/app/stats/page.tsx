"use client";

import { useEffect, useState } from "react";

interface Stats {
  total: number;
  totalExtracted: number;
  avgConfidence: Record<string, number>;
  correctionCounts: Record<string, number>;
  accuracyRate: number;
  perArchitect: Array<{ firmName: string; total: number; corrections: number }>;
}

const FIELD_LABELS: Record<string, string> = {
  drawingNumber: "Drawing Number",
  drawingTitle: "Drawing Title",
  revision: "Revision",
  revisionDate: "Revision Date",
  status: "Status",
};

function ConfBar({ value }: { value: number }) {
  const pct = (value * 100).toFixed(1);
  const color = value >= 0.8 ? "bg-green-400" : value >= 0.6 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-600 w-10 text-right">{pct}%</span>
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats").then((r) => r.json()).then((data) => { setStats(data); setLoading(false); });
  }, []);

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;
  if (!stats) return null;

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-6">Extraction Stats</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-3xl font-bold">{stats.total}</div>
          <div className="text-sm text-gray-500 mt-1">Total drawings</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-3xl font-bold">{stats.totalExtracted}</div>
          <div className="text-sm text-gray-500 mt-1">Extracted</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-3xl font-bold">{(stats.accuracyRate * 100).toFixed(1)}%</div>
          <div className="text-sm text-gray-500 mt-1">Accuracy rate</div>
        </div>
      </div>

      {/* Per-field stats */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <h2 className="font-semibold mb-4">Per-Field Performance</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
              <th className="text-left py-2">Field</th>
              <th className="text-left py-2 w-48">Avg Confidence</th>
              <th className="text-right py-2">Corrections</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(FIELD_LABELS).map(([key, label]) => (
              <tr key={key} className="border-b border-gray-50">
                <td className="py-2.5 text-gray-700">{label}</td>
                <td className="py-2.5">
                  <ConfBar value={stats.avgConfidence[key] || 0} />
                </td>
                <td className="py-2.5 text-right text-gray-600">{stats.correctionCounts[key] || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-architect */}
      {stats.perArchitect.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold mb-4">Per-Architect Breakdown</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                <th className="text-left py-2">Firm</th>
                <th className="text-right py-2">Drawings</th>
                <th className="text-right py-2">Corrections</th>
                <th className="text-right py-2">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {stats.perArchitect.map((a) => {
                const fields = 5;
                const totalFields = a.total * fields;
                const accuracy = totalFields > 0 ? ((totalFields - a.corrections) / totalFields * 100).toFixed(1) : "—";
                return (
                  <tr key={a.firmName} className="border-b border-gray-50">
                    <td className="py-2.5 text-gray-700">{a.firmName}</td>
                    <td className="py-2.5 text-right">{a.total}</td>
                    <td className="py-2.5 text-right">{a.corrections}</td>
                    <td className="py-2.5 text-right">{accuracy}{accuracy !== "—" ? "%" : ""}</td>
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
