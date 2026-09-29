import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PriorityModeController } from "../core/controller.ts";
import type { ModelSnapshot } from "../core/eligibility.ts";
import type {
  PriorityPreferenceStore,
  PriorityStartupPolicy,
} from "../core/preference.ts";
import type { PriorityMode } from "../core/state.ts";
import {
  appendPrioritySessionState,
  readPriorityForkState,
  readPrioritySessionState,
} from "./stores.ts";
import { PiPriorityViewAdapter } from "./view.ts";

const COMMAND_NAME = "fireworks-priority";
const INVALID_SESSION_STATE =
  "Ignored invalid persisted fireworks priority session state.";
const FORK_READ_ERROR =
  "Cannot restore fireworks priority mode from the source session.";
const GLOBAL_READ_ERROR =
  "Cannot read the global fireworks priority preference. Priority mode defaulted to off.";
const SESSION_WRITE_ERROR =
  "Fireworks priority mode changed, but its session state could not be saved.";
const GLOBAL_WRITE_ERROR =
  "Fireworks priority mode changed for this session, but the global default could not be saved.";

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

function appendSessionMode(
  pi: ExtensionAPI,
  mode: PriorityMode,
  view: PiPriorityViewAdapter,
): void {
  try {
    appendPrioritySessionState(pi, mode);
  } catch {
    view.notify(SESSION_WRITE_ERROR, "error");
  }
}

async function saveGlobalMode(
  store: PriorityPreferenceStore,
  mode: PriorityMode,
  view: PiPriorityViewAdapter,
): Promise<void> {
  try {
    await store.save(mode);
  } catch {
    view.notify(GLOBAL_WRITE_ERROR, "error");
  }
}

async function initializeSession(
  pi: ExtensionAPI,
  controller: PriorityModeController,
  store: PriorityPreferenceStore,
  startupPolicy: PriorityStartupPolicy,
  event: {
    readonly reason: "startup" | "reload" | "new" | "resume" | "fork";
    readonly previousSessionFile?: string;
  },
  context: ExtensionContext,
): Promise<void> {
  const view = new PiPriorityViewAdapter(context);
  const sessionState = readPrioritySessionState(
    context.sessionManager.getBranch(),
  );
  if (sessionState.invalid) view.notify(INVALID_SESSION_STATE, "warning");

  let forkMode: PriorityMode | undefined;
  if (event.reason === "fork" && event.previousSessionFile) {
    try {
      const forkState = readPriorityForkState(event.previousSessionFile);
      forkMode = forkState.mode;
      if (forkState.invalid) view.notify(INVALID_SESSION_STATE, "warning");
    } catch {
      view.notify(FORK_READ_ERROR, "warning");
    }
  }

  let globalMode: PriorityMode | undefined;
  if (forkMode === undefined && sessionState.mode === undefined) {
    try {
      globalMode = await store.load();
    } catch {
      view.notify(GLOBAL_READ_ERROR, "error");
    }
  }

  const mode = startupPolicy.resolve({
    forkMode,
    sessionMode: sessionState.mode,
    globalMode,
  });
  controller.initialize(mode, toModelSnapshot(context.model), view);

  if (
    sessionState.invalid ||
    sessionState.mode === undefined ||
    sessionState.mode !== mode
  ) {
    appendSessionMode(pi, mode, view);
  }
}

/** Registers Pi callbacks and delegates behavior to the application layer. */
export function registerPiRuntime(
  pi: ExtensionAPI,
  controller: PriorityModeController,
  store: PriorityPreferenceStore,
  startupPolicy: PriorityStartupPolicy,
): void {
  pi.registerCommand(COMMAND_NAME, {
    description: "Toggle Fireworks priority service tier",
    handler: async (args, context) => {
      const view = new PiPriorityViewAdapter(context);
      const result = controller.handleCommand(
        args,
        toModelSnapshot(context.model),
        view,
      );
      if (result.kind !== "changed") return;
      appendSessionMode(pi, result.mode, view);
      await saveGlobalMode(store, result.mode, view);
    },
  });

  pi.on("session_start", async (event, context) => {
    await initializeSession(
      pi,
      controller,
      store,
      startupPolicy,
      event,
      context,
    );
  });

  pi.on("session_before_fork", (_event, context) => {
    appendSessionMode(
      pi,
      controller.getMode(),
      new PiPriorityViewAdapter(context),
    );
  });

  pi.on("session_tree", (_event, context) => {
    const view = new PiPriorityViewAdapter(context);
    const sessionState = readPrioritySessionState(
      context.sessionManager.getBranch(),
    );
    if (sessionState.invalid) view.notify(INVALID_SESSION_STATE, "warning");
    if (sessionState.mode !== undefined) {
      controller.restore(
        sessionState.mode,
        toModelSnapshot(context.model),
        view,
      );
    }
  });

  pi.on("model_select", (event, context) => {
    const model = toModelSnapshot(event.model);
    if (model) {
      controller.handleModelSelection(
        model,
        new PiPriorityViewAdapter(context),
      );
    }
  });

  // A provider fault is latched during a request, when no ExtensionContext is
  // available. Refresh the footer on the next message so `fireworks: error`
  // becomes visible without waiting for a command or model change.
  pi.on("message_end", (_event, context) => {
    const model = toModelSnapshot(context.model);
    if (model) {
      controller.handleModelSelection(
        model,
        new PiPriorityViewAdapter(context),
      );
    }
  });
}
