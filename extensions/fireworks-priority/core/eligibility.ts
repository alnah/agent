export interface ModelSnapshot {
  readonly provider: string;
  readonly api: string;
  readonly modelId: string;
}

export type PriorityIneligibilityReason =
  | "missing_model"
  | "unsupported_provider"
  | "unsupported_api"
  | "unsupported_model";

export type PriorityEligibilityResult =
  | { readonly eligible: true; readonly multiplier: number }
  | { readonly eligible: false; readonly reason: PriorityIneligibilityReason };

/**
 * Fireworks models with a published Priority tier, mapped to their Priority
 * cost multiplier. Only direct model IDs are listed: Fireworks does not publish
 * Priority rates for routers, so they stay standard until that changes.
 */
const PRIORITY_MULTIPLIERS: ReadonlyMap<string, number> = new Map([
  ["accounts/fireworks/models/deepseek-v4p1-flash", 1.25],
  ["accounts/fireworks/models/ember-1", 1.25],
  ["accounts/fireworks/models/gpt-oss-120b", 1.2],
  ["accounts/fireworks/models/minimax-m3", 1.5],
  ["accounts/fireworks/models/nemotron-3-ultra-nvfp4", 1.25],
  ["accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b", 1.25],
  ["accounts/fireworks/models/qwen3p8-max", 1.5],
  ["accounts/fireworks/models/glm-5p3", 1.25],
  ["accounts/fireworks/models/glm-5p3-flash", 1.25],
  ["accounts/fireworks/models/kimi-k3", 1.25],
]);

const FIREWORKS_PROVIDER = "fireworks";
const FIREWORKS_APIS = new Set(["anthropic-messages", "openai-completions"]);

/** Exact allowlist for Fireworks priority mode V1. */
export class PriorityEligibilityPolicy {
  evaluate(model: ModelSnapshot | undefined): PriorityEligibilityResult {
    if (!model) return { eligible: false, reason: "missing_model" };
    if (model.provider !== FIREWORKS_PROVIDER) {
      return { eligible: false, reason: "unsupported_provider" };
    }
    if (!FIREWORKS_APIS.has(model.api)) {
      return { eligible: false, reason: "unsupported_api" };
    }
    const multiplier = PRIORITY_MULTIPLIERS.get(model.modelId);
    if (multiplier === undefined) {
      return { eligible: false, reason: "unsupported_model" };
    }
    return { eligible: true, multiplier };
  }
}
