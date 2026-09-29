import type { PriorityModeFault } from "./state.ts";

export type PriorityPayloadTransformResult =
  | { readonly kind: "unchanged"; readonly payload: unknown }
  | {
      readonly kind: "decorated";
      readonly payload: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "failure";
      readonly payload: unknown;
      readonly fault: PriorityModeFault;
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
  decorate(payload: unknown): PriorityPayloadTransformResult {
    if (!isPayloadObject(payload)) {
      return {
        kind: "failure",
        payload,
        fault: {
          code: "invalid_provider_payload",
          message:
            "Cannot enable priority mode: provider payload is not an object",
        },
      };
    }

    return {
      kind: "decorated",
      payload: { ...payload, service_tier: "priority" },
    };
  }
}
