import type { ModelSnapshot } from "./model-snapshot.ts";

export type IneligibilityReason =
  | "missing_model"
  | "unsupported_provider"
  | "unsupported_api"
  | "unsupported_model";

export type EligibilityResult =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: IneligibilityReason };

/** Exact allowlist for OpenAI fast mode V1. */
export class FastModeEligibilityPolicy {
  evaluate(model: ModelSnapshot | undefined): EligibilityResult {
    if (!model) return { eligible: false, reason: "missing_model" };

    if (model.provider !== "openai" && model.provider !== "openai-codex") {
      return { eligible: false, reason: "unsupported_provider" };
    }

    const expectedApi =
      model.provider === "openai"
        ? "openai-responses"
        : "openai-codex-responses";
    if (model.api !== expectedApi) {
      return { eligible: false, reason: "unsupported_api" };
    }

    if (model.modelId !== "gpt-5.6-sol") {
      return { eligible: false, reason: "unsupported_model" };
    }

    return { eligible: true };
  }
}
