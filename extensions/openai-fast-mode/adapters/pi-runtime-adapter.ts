import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FastModeController } from "../application/fast-mode-controller.ts";
import type { ModelSnapshot } from "../domain/model-snapshot.ts";
import { PiViewAdapter } from "./pi-view-adapter.ts";

const FAST_FLAG = "fast";

interface PiModelInput {
  readonly provider: string;
  readonly api: string;
  readonly id: string;
}

/** Converts Pi's model into the minimal domain contract. */
export function toModelSnapshot(
  model: PiModelInput | undefined,
): ModelSnapshot | undefined {
  if (!model) return undefined;
  return {
    provider: model.provider,
    api: model.api,
    modelId: model.id,
  };
}

/** Registers Pi callbacks and delegates behavior to the application layer. */
export function registerPiRuntime(
  pi: ExtensionAPI,
  controller: FastModeController,
): void {
  pi.registerFlag(FAST_FLAG, {
    description: "Request OpenAI priority service tier",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("fast", {
    description: "Show OpenAI fast mode status",
    handler: async (args, context) => {
      controller.handleCommand(
        args,
        toModelSnapshot(context.model),
        new PiViewAdapter(context),
      );
    },
  });

  pi.on("session_start", (_event, context) => {
    controller.initialize(
      pi.getFlag(FAST_FLAG) === true,
      toModelSnapshot(context.model),
      new PiViewAdapter(context),
    );
  });

  pi.on("model_select", (event, context) => {
    const model = toModelSnapshot(event.model);
    if (model) {
      controller.handleModelSelection(model, new PiViewAdapter(context));
    }
  });

  pi.on("before_provider_request", (event, context) => {
    const result = controller.transformProviderPayload(
      toModelSnapshot(context.model),
      event.payload,
    );
    return result.payload;
  });
}
