import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FastModeController } from "../application/fast-mode-controller.ts";
import { PiViewAdapter } from "./pi-view-adapter.ts";

const FAST_FLAG = "fast";

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
    description: "Show OpenAI fast mode skeleton status",
    handler: async (_args, context) => {
      controller.handleCommand(new PiViewAdapter(context));
    },
  });

  pi.on("session_start", () => {
    controller.initialize(pi.getFlag(FAST_FLAG) === true);
  });

  pi.on("model_select", () => {
    controller.handleModelSelection();
  });

  pi.on("before_provider_request", (event) => {
    return controller.transformProviderPayload(event.payload);
  });
}
