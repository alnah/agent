import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PriorityModeController } from "./core/controller.ts";
import { PriorityEligibilityPolicy } from "./core/eligibility.ts";
import { PriorityPayloadDecorator } from "./core/payload.ts";
import { PriorityStartupPolicy } from "./core/preference.ts";
import {
  InMemoryPriorityModeState,
  PriorityCommandParser,
} from "./core/state.ts";
import { registerPriorityFireworksProvider } from "./pi/provider.ts";
import { registerPiRuntime } from "./pi/runtime.ts";
import { GlobalPriorityStore } from "./pi/stores.ts";

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
