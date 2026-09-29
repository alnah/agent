/**
 * Normalizes usage cost payloads into one numeric total.
 *
 * Session history may contain slightly different shapes depending on provider
 * or runtime version, so the command accepts both flat and nested totals.
 */
export type UsageLike = {
  cost?: unknown;
  input?: unknown;
  inputTokens?: unknown;
  output?: unknown;
  outputTokens?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
};

/**
 * Formats a session cost total for compact display.
 *
 * `/window` needs stable, low-noise currency output so tiny totals remain
 * readable without overwhelming the rest of the summary.
 */
export function formatUsd(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return "$0.00";
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
}

/**
 * Applies the lightweight token heuristic used throughout the extension.
 *
 * The view only needs order-of-magnitude estimates for files, prompts, and
 * tool definitions, so a fast character-based approximation is sufficient.
 */
export function estimateTokens(text: string): number {
  // Deliberately fuzzy (good enough for “how big-ish is this”).
  return Math.max(0, Math.ceil(text.length / 4));
}

export function extractCostTotal(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const c = (usage as UsageLike).cost;
  if (typeof c === "number") return Number.isFinite(c) ? c : 0;
  if (typeof c === "string") {
    const n = Number(c);
    return Number.isFinite(n) ? n : 0;
  }
  const t =
    c && typeof c === "object" ? (c as { total?: unknown }).total : undefined;
  if (typeof t === "number") return Number.isFinite(t) ? t : 0;
  if (typeof t === "string") {
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Estimates how much context an active tool definition contributes.
 *
 * Tool schemas are often a large share of prompt overhead, so the estimate
 * includes the tool name, description, and serialized parameter schema.
 */
export function estimateToolDefinitionTokens(tool: {
  name: string;
  description?: string;
  parameters?: unknown;
}): number {
  let parametersText = "";
  try {
    parametersText = tool.parameters
      ? JSON.stringify(tool.parameters, null, 2)
      : "";
  } catch {
    parametersText = "";
  }
  return estimateTokens(
    [tool.name, tool.description ?? "", parametersText]
      .filter(Boolean)
      .join("\n"),
  );
}
