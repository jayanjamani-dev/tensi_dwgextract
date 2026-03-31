/**
 * FinOps helpers — cost calculation and metric types for Gemini API calls.
 *
 * Pricing defaults (Gemini 2.5 Flash, USD per 1M tokens).
 * Override via env:
 *   GEMINI_PRICE_INPUT_PER_1M      (default: 0.075)
 *   GEMINI_PRICE_OUTPUT_PER_1M     (default: 0.30)
 *   GEMINI_PRICE_THINKING_PER_1M   (default: 3.50)
 */

export interface GeminiUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
}

export interface GeminiCallMetrics {
  usage: GeminiUsage;
  latencyMs: number;
  costUsd: number;
  retryCount: number;
  success: boolean;
  errorMessage?: string;
}

function getPrice(envKey: string, defaultVal: number): number {
  const v = process.env[envKey];
  return v ? parseFloat(v) : defaultVal;
}

export function calculateCost(usage: GeminiUsage): number {
  const inputPrice  = getPrice("GEMINI_PRICE_INPUT_PER_1M", 0.075);
  const outputPrice = getPrice("GEMINI_PRICE_OUTPUT_PER_1M", 0.30);
  const thinkPrice  = getPrice("GEMINI_PRICE_THINKING_PER_1M", 3.50);

  return (
    (usage.inputTokens    / 1_000_000) * inputPrice  +
    (usage.outputTokens   / 1_000_000) * outputPrice +
    (usage.thinkingTokens / 1_000_000) * thinkPrice
  );
}

export function formatCost(usd: number): string {
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01)   return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatLatency(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000)  return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}
