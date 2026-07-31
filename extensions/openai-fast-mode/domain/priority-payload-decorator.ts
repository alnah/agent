import type { FastModeFault } from "./fast-mode-state.ts";

export type PayloadTransformResult =
  | { readonly kind: "unchanged"; readonly payload: unknown }
  | {
      readonly kind: "decorated";
      readonly payload: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "failure";
      readonly payload: unknown;
      readonly fault: FastModeFault;
    };

function isPayloadObject(
  payload: unknown,
): payload is Readonly<Record<string, unknown>> {
  return (
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
  );
}

/** Produces the only provider payload transformation owned by V1. */
export class PriorityPayloadDecorator {
  decorate(payload: unknown): PayloadTransformResult {
    if (!isPayloadObject(payload)) {
      return {
        kind: "failure",
        payload,
        fault: {
          code: "invalid_provider_payload",
          message: "Cannot enable fast mode: provider payload is not an object",
        },
      };
    }

    return {
      kind: "decorated",
      payload: { ...payload, service_tier: "priority" },
    };
  }
}
