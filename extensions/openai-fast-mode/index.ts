import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiRuntime } from "./adapters/pi-runtime-adapter.ts";
import { FastModeController } from "./application/fast-mode-controller.ts";
import { FastCommandParser } from "./domain/fast-command.ts";
import { FastModeEligibilityPolicy } from "./domain/fast-mode-policy.ts";
import { InMemoryFastModeState } from "./domain/fast-mode-state.ts";
import { PriorityPayloadDecorator } from "./domain/priority-payload-decorator.ts";

/** Composition root for the OpenAI fast mode extension. */
export default function openAIFastModeExtension(pi: ExtensionAPI): void {
  const controller = new FastModeController(
    new FastCommandParser(),
    new InMemoryFastModeState(),
    new FastModeEligibilityPolicy(),
    new PriorityPayloadDecorator(),
  );
  registerPiRuntime(pi, controller);
}
