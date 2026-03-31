import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  // --- Aggregate ApiCall stats ---
  const calls = await prisma.apiCall.findMany({
    include: { drawing: { select: { filename: true, pageNumber: true, projectId: true } } },
    orderBy: { createdAt: "desc" },
  });

  const totalCalls       = calls.length;
  const successfulCalls  = calls.filter((c) => c.success).length;
  const failedCalls      = totalCalls - successfulCalls;
  const errorRate        = totalCalls > 0 ? failedCalls / totalCalls : 0;
  const retryCalls       = calls.filter((c) => c.retryCount > 0).length;

  const totalInputTokens    = calls.reduce((s, c) => s + c.inputTokens, 0);
  const totalOutputTokens   = calls.reduce((s, c) => s + c.outputTokens, 0);
  const totalThinkingTokens = calls.reduce((s, c) => s + c.thinkingTokens, 0);
  const totalTokens         = calls.reduce((s, c) => s + c.totalTokens, 0);
  const totalCostUsd        = calls.reduce((s, c) => s + c.costUsd, 0);

  const latencies = calls.filter((c) => c.latencyMs > 0).map((c) => c.latencyMs);
  latencies.sort((a, b) => a - b);
  const avgLatencyMs = latencies.length > 0 ? latencies.reduce((s, v) => s + v, 0) / latencies.length : 0;
  const p50LatencyMs = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
  const p95LatencyMs = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;
  const maxLatencyMs = latencies.length > 0 ? latencies[latencies.length - 1] : 0;

  // --- Per-drawing rollup ---
  const drawings = await prisma.drawing.findMany({
    where: { totalCostUsd: { not: null } },
    select: {
      id: true,
      filename: true,
      pageNumber: true,
      projectId: true,
      extractionStatus: true,
      processingTimeMs: true,
      pdfplumberTimeMs: true,
      totalInputTokens: true,
      totalOutputTokens: true,
      totalCostUsd: true,
      extractedAt: true,
      extractionModel: true,
      flags: true,
      project: { select: { name: true } },
      apiCalls: {
        select: { latencyMs: true, retryCount: true, success: true, costUsd: true },
      },
    },
    orderBy: { extractedAt: "desc" },
    take: 100,
  });

  const perDrawing = drawings
    .filter((d) => d.totalCostUsd !== null && d.totalCostUsd! > 0)
    .map((d) => ({
      id: d.id,
      filename: d.filename,
      pageNumber: d.pageNumber,
      projectName: d.project?.name ?? "—",
      extractionStatus: d.extractionStatus,
      processingTimeMs: d.processingTimeMs,
      pdfplumberTimeMs: d.pdfplumberTimeMs,
      geminiLatencyMs: d.apiCalls.length > 0
        ? d.apiCalls.reduce((s, c) => s + c.latencyMs, 0)
        : null,
      totalInputTokens: d.totalInputTokens,
      totalOutputTokens: d.totalOutputTokens,
      totalCostUsd: d.totalCostUsd,
      retried: d.apiCalls.some((c) => c.retryCount > 0),
      flags: d.flags ? (JSON.parse(d.flags) as string[]) : [],
      extractedAt: d.extractedAt?.toISOString() ?? null,
      model: d.extractionModel,
    }));

  const avgCostPerDrawing = perDrawing.length > 0
    ? perDrawing.reduce((s, d) => s + (d.totalCostUsd ?? 0), 0) / perDrawing.length
    : 0;

  // --- Cost by day ---
  const costByDay: Record<string, { costUsd: number; calls: number; tokens: number }> = {};
  for (const call of calls) {
    const day = call.createdAt.toISOString().slice(0, 10);
    if (!costByDay[day]) costByDay[day] = { costUsd: 0, calls: 0, tokens: 0 };
    costByDay[day].costUsd += call.costUsd;
    costByDay[day].calls   += 1;
    costByDay[day].tokens  += call.totalTokens;
  }
  const costTrend = Object.entries(costByDay)
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day));

  // --- Model breakdown ---
  const modelBreakdown: Record<string, { calls: number; costUsd: number; inputTokens: number; outputTokens: number }> = {};
  for (const call of calls) {
    if (!modelBreakdown[call.model]) modelBreakdown[call.model] = { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
    modelBreakdown[call.model].calls      += 1;
    modelBreakdown[call.model].costUsd    += call.costUsd;
    modelBreakdown[call.model].inputTokens  += call.inputTokens;
    modelBreakdown[call.model].outputTokens += call.outputTokens;
  }

  // --- Recent errors ---
  const recentErrors = calls
    .filter((c) => !c.success)
    .slice(0, 20)
    .map((c) => ({
      id: c.id,
      drawingId: c.drawingId,
      filename: c.drawing.filename,
      page: c.drawing.pageNumber,
      model: c.model,
      errorMessage: c.errorMessage,
      latencyMs: c.latencyMs,
      createdAt: c.createdAt.toISOString(),
    }));

  // --- Pricing config (for display) ---
  const pricing = {
    inputPer1M:    parseFloat(process.env.GEMINI_PRICE_INPUT_PER_1M    || "0.075"),
    outputPer1M:   parseFloat(process.env.GEMINI_PRICE_OUTPUT_PER_1M   || "0.30"),
    thinkingPer1M: parseFloat(process.env.GEMINI_PRICE_THINKING_PER_1M || "3.50"),
  };

  return NextResponse.json({
    overview: {
      totalCalls,
      successfulCalls,
      failedCalls,
      errorRate,
      retryCalls,
      totalInputTokens,
      totalOutputTokens,
      totalThinkingTokens,
      totalTokens,
      totalCostUsd,
      avgCostPerDrawing,
      avgLatencyMs,
      p50LatencyMs,
      p95LatencyMs,
      maxLatencyMs,
    },
    costTrend,
    modelBreakdown,
    perDrawing,
    recentErrors,
    pricing,
  });
}
