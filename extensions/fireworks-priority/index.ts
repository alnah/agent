import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPriorityFireworksProvider } from "./adapters/fireworks-provider-adapter.ts";
import { GlobalPriorityStore } from "./adapters/global-priority-store.ts";
import { registerPiRuntime } from "./adapters/pi-runtime-adapter.ts";
import { PriorityModeController } from "./application/priority-mode-controller.ts";
import { PriorityStartupPolicy } from "./application/priority-startup-policy.ts";
import { PriorityCommandParser } from "./domain/priority-command.ts";
import { PriorityEligibilityPolicy } from "./domain/priority-eligibility-policy.ts";
import { InMemoryPriorityModeState } from "./domain/priority-mode-state.ts";
import { PriorityPayloadDecorator } from "./domain/priority-payload-decorator.ts";

/** Composition root for the Fireworks priority mode extension. */
export default function fireworksPriorityExtension(pi: ExtensionAPI): void {
  const state = new InMemoryPriorityModeState();
  const policy = new PriorityEligibilityPolicy();
  const decorator = new PriorityPayloadDecorator();
  const controller = new PriorityModeController(
    new PriorityCommandParser(),
    state,
    policy,
  );

  registerPriorityFireworksProvider(pi, state, policy, decorator);
  registerPiRuntime(
    pi,
    controller,
    new GlobalPriorityStore(),
    new PriorityStartupPolicy(),
  );
}
