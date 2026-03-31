"use client";

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────
interface Overview {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  errorRate: number;
  retryCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalThinkingTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  avgCostPerDrawing: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
}

interface CostTrendItem {
  day: string;
  costUsd: number;
  calls: number;
  tokens: number;
}

interface ModelRow {
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

interface DrawingRow {
  id: string;
  filename: string;
  pageNumber: number;
  projectName: string;
  extractionStatus: string;
  processingTimeMs: number | null;
  pdfplumberTimeMs: number | null;
  geminiLatencyMs: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCostUsd: number | null;
  retried: boolean;
  flags: string[];
  extractedAt: string | null;
  model: string | null;
}

interface ErrorRow {
  id: string;
  drawingId: string;
  filename: string;
  page: number;
  model: string;
  errorMessage: string | null;
  latencyMs: number;
  createdAt: string;
}

interface Pricing {
  inputPer1M: number;
  outputPer1M: number;
  thinkingPer1M: number;
}

interface FinOpsData {
  overview: Overview;
  costTrend: CostTrendItem[];
  modelBreakdown: Record<string, ModelRow>;
  perDrawing: DrawingRow[];
  recentErrors: ErrorRow[];
  pricing: Pricing;
}

// ── Formatters ─────────────────────────────────────────────────────────────
function fmt$( usd: number ) {
  if (!usd) return "$0.0000";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01)   return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(4)}`;
}

function fmtK(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtMs(ms: number | null) {
  if (!ms) return "—";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000)  return `${(ms / 1_000).toFixed(2)}s`;
  return `${ms}ms`;
}

function fmtPct(r: number) {
  return `${(r * 100).toFixed(1)}%`;
}

// ── Components ─────────────────────────────────────────────────────────────
function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "green" | "red" | "blue" | "amber";
}) {
  const border = {
    green: "border-l-green-400",
    red:   "border-l-red-400",
    blue:  "border-l-blue-400",
    amber: "border-l-amber-400",
  }[accent ?? "blue"];

  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${border} p-4`}>
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">{children}</h2>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function FinOpsPage() {
  const [data, setData] = useState<FinOpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"drawings" | "errors" | "trend">("drawings");

  useEffect(() => {
    fetch("/api/stats/finops")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, []);

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;
  if (!data)   return <div className="p-8 text-red-500">Failed to load FinOps data.</div>;

  const { overview: o, costTrend, modelBreakdown, perDrawing, recentErrors, pricing } = data;

  // Bar chart for cost trend
  const maxDayCost = Math.max(...costTrend.map((d) => d.costUsd), 0.000001);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">DevOps &amp; FinOps</h1>
          <p className="text-sm text-gray-500 mt-0.5">API usage, cost, latency, and error tracking per document</p>
        </div>
        <button
          onClick={() => { setLoading(true); fetch("/api/stats/finops").then(r => r.json()).then(d => { setData(d); setLoading(false); }); }}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total API Calls"     value={o.totalCalls.toLocaleString()}      sub={`${o.successfulCalls} succeeded · ${o.failedCalls} failed`} accent="blue"  />
        <MetricCard label="Total Cost"          value={fmt$(o.totalCostUsd)}               sub={`avg ${fmt$(o.avgCostPerDrawing)} / drawing`}               accent="green" />
        <MetricCard label="Total Tokens"        value={fmtK(o.totalTokens)}               sub={`${fmtK(o.totalInputTokens)} in · ${fmtK(o.totalOutputTokens)} out`} accent="blue" />
        <MetricCard label="Error Rate"          value={fmtPct(o.errorRate)}                sub={`${o.retryCalls} retried`}                                  accent={o.errorRate > 0.1 ? "red" : "green"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Avg Gemini Latency"  value={fmtMs(o.avgLatencyMs)}             sub="per call"                        accent="amber" />
        <MetricCard label="P50 Latency"         value={fmtMs(o.p50LatencyMs)}             sub="median"                          accent="amber" />
        <MetricCard label="P95 Latency"         value={fmtMs(o.p95LatencyMs)}             sub="95th percentile"                 accent={o.p95LatencyMs > 30_000 ? "red" : "amber"} />
        <MetricCard label="Max Latency"         value={fmtMs(o.maxLatencyMs)}             sub="slowest call"                    accent="amber" />
      </div>

      {/* Pricing config */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-500 flex flex-wrap gap-6">
        <span className="font-medium text-gray-700">Pricing config</span>
        <span>Input: <b>${pricing.inputPer1M}/1M tokens</b></span>
        <span>Output: <b>${pricing.outputPer1M}/1M tokens</b></span>
        <span>Thinking: <b>${pricing.thinkingPer1M}/1M tokens</b></span>
        <span className="text-gray-400">Override via GEMINI_PRICE_*_PER_1M in .env.local</span>
        {o.totalThinkingTokens > 0 && (
          <span className="text-amber-600">⚡ {fmtK(o.totalThinkingTokens)} thinking tokens used</span>
        )}
      </div>

      {/* Model breakdown */}
      {Object.keys(modelBreakdown).length > 0 && (
        <section>
          <SectionTitle>Model Breakdown</SectionTitle>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2.5">Model</th>
                  <th className="text-right px-4 py-2.5">Calls</th>
                  <th className="text-right px-4 py-2.5">Input tokens</th>
                  <th className="text-right px-4 py-2.5">Output tokens</th>
                  <th className="text-right px-4 py-2.5">Cost</th>
                  <th className="text-right px-4 py-2.5">Cost / call</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(modelBreakdown).map(([model, row]) => (
                  <tr key={model} className="border-t border-gray-100">
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{model}</td>
                    <td className="px-4 py-2.5 text-right">{row.calls.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">{fmtK(row.inputTokens)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">{fmtK(row.outputTokens)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-900">{fmt$(row.costUsd)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">{fmt$(row.costUsd / row.calls)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tabs */}
      <section>
        <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
          {(["drawings", "trend", "errors"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-sm px-4 py-2 border-b-2 transition-colors capitalize ${
                tab === t
                  ? "border-gray-900 text-gray-900 font-medium"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "drawings" ? `Per Document (${perDrawing.length})` :
               t === "errors"   ? `Errors (${recentErrors.length})` :
               `Cost Trend (${costTrend.length} days)`}
            </button>
          ))}
        </div>

        {/* Per-drawing table */}
        {tab === "drawings" && (
          perDrawing.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No extraction data yet. Run Extract All on a project.</p>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-2.5">Document</th>
                    <th className="text-left px-4 py-2.5">Project</th>
                    <th className="text-right px-4 py-2.5">In tokens</th>
                    <th className="text-right px-4 py-2.5">Out tokens</th>
                    <th className="text-right px-4 py-2.5">Cost</th>
                    <th className="text-right px-4 py-2.5">Gemini</th>
                    <th className="text-right px-4 py-2.5">pdfplumber</th>
                    <th className="text-right px-4 py-2.5">Total</th>
                    <th className="text-center px-4 py-2.5">Retry</th>
                    <th className="text-left px-4 py-2.5">Extracted</th>
                  </tr>
                </thead>
                <tbody>
                  {perDrawing.map((d) => (
                    <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <span className="truncate max-w-[180px] block text-gray-800" title={d.filename}>{d.filename}</span>
                        <span className="text-xs text-gray-400">p.{d.pageNumber + 1}</span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{d.projectName}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{d.totalInputTokens ? fmtK(d.totalInputTokens) : "—"}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{d.totalOutputTokens ? fmtK(d.totalOutputTokens) : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-gray-900">{fmt$(d.totalCostUsd ?? 0)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{fmtMs(d.geminiLatencyMs)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{fmtMs(d.pdfplumberTimeMs)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{fmtMs(d.processingTimeMs)}</td>
                      <td className="px-4 py-2.5 text-center">
                        {d.retried ? <span className="text-amber-500 text-xs">⚠ yes</span> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-400">
                        {d.extractedAt ? new Date(d.extractedAt).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t-2 border-gray-200 text-xs font-medium text-gray-700">
                  <tr>
                    <td className="px-4 py-2.5" colSpan={2}>Totals ({perDrawing.length} documents)</td>
                    <td className="px-4 py-2.5 text-right">{fmtK(perDrawing.reduce((s, d) => s + (d.totalInputTokens ?? 0), 0))}</td>
                    <td className="px-4 py-2.5 text-right">{fmtK(perDrawing.reduce((s, d) => s + (d.totalOutputTokens ?? 0), 0))}</td>
                    <td className="px-4 py-2.5 text-right">{fmt$(perDrawing.reduce((s, d) => s + (d.totalCostUsd ?? 0), 0))}</td>
                    <td colSpan={5} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        )}

        {/* Cost trend */}
        {tab === "trend" && (
          costTrend.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No data yet.</p>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-2.5">Date</th>
                    <th className="text-right px-4 py-2.5">Calls</th>
                    <th className="text-right px-4 py-2.5">Tokens</th>
                    <th className="text-right px-4 py-2.5">Cost</th>
                    <th className="px-4 py-2.5 w-48">Bar</th>
                  </tr>
                </thead>
                <tbody>
                  {costTrend.map((row) => (
                    <tr key={row.day} className="border-t border-gray-100">
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{row.day}</td>
                      <td className="px-4 py-2.5 text-right">{row.calls}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{fmtK(row.tokens)}</td>
                      <td className="px-4 py-2.5 text-right font-medium">{fmt$(row.costUsd)}</td>
                      <td className="px-4 py-2.5">
                        <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className="h-full bg-blue-400 rounded-full"
                            style={{ width: `${(row.costUsd / maxDayCost) * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Errors */}
        {tab === "errors" && (
          recentErrors.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No errors recorded.</p>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-2.5">Document</th>
                    <th className="text-left px-4 py-2.5">Model</th>
                    <th className="text-right px-4 py-2.5">Latency</th>
                    <th className="text-left px-4 py-2.5">Error</th>
                    <th className="text-left px-4 py-2.5">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentErrors.map((e) => (
                    <tr key={e.id} className="border-t border-gray-100">
                      <td className="px-4 py-2.5">
                        <span className="text-gray-800">{e.filename}</span>
                        <span className="text-xs text-gray-400 ml-1">p.{e.page + 1}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{e.model}</td>
                      <td className="px-4 py-2.5 text-right">{fmtMs(e.latencyMs)}</td>
                      <td className="px-4 py-2.5 text-xs text-red-600 max-w-sm">
                        <span className="truncate block" title={e.errorMessage ?? ""}>{e.errorMessage?.slice(0, 120) ?? "Unknown"}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-400">
                        {new Date(e.createdAt).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>
    </div>
  );
}
