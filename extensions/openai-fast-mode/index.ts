import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiRuntime } from "./adapters/pi-runtime-adapter.ts";
import { FastModeController } from "./application/fast-mode-controller.ts";
import { FastModeEligibilityPolicy } from "./domain/fast-mode-policy.ts";

/** Composition root for the OpenAI fast mode extension. */
export default function openAIFastModeExtension(pi: ExtensionAPI): void {
  const controller = new FastModeController(new FastModeEligibilityPolicy());
  registerPiRuntime(pi, controller);
}
