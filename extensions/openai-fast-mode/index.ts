import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPriorityCodexProvider } from "./adapters/codex-provider-adapter.ts";
import { registerPiRuntime } from "./adapters/pi-runtime-adapter.ts";
import { FastModeController } from "./application/fast-mode-controller.ts";
import { FastCommandParser } from "./domain/fast-command.ts";
import { FastModeEligibilityPolicy } from "./domain/fast-mode-policy.ts";
import { InMemoryFastModeState } from "./domain/fast-mode-state.ts";
import { PriorityPayloadDecorator } from "./domain/priority-payload-decorator.ts";

/** Composition root for the OpenAI fast mode extension. */
export default function openAIFastModeExtension(pi: ExtensionAPI): void {
  const state = new InMemoryFastModeState();
  const policy = new FastModeEligibilityPolicy();
  const decorator = new PriorityPayloadDecorator();
  const controller = new FastModeController(
    new FastCommandParser(),
    state,
    policy,
    decorator,
  );

  registerPriorityCodexProvider(pi, state, policy, decorator);
  registerPiRuntime(pi, controller);
}
