import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { FastModeController } from "../application/fast-mode-controller.ts";
import type { FastModePreferenceStore } from "../application/fast-mode-preference-store.ts";
import type { FastModeStartupPolicy } from "../application/fast-mode-startup-policy.ts";
import type { FastMode } from "../domain/fast-mode-state.ts";
import type { ModelSnapshot } from "../domain/model-snapshot.ts";
import {
  appendFastModeSessionState,
  readFastModeForkState,
  readFastModeSessionState,
} from "./pi-fast-mode-persistence-adapter.ts";
import { PiViewAdapter } from "./pi-view-adapter.ts";

const FAST_FLAG = "fast";
const INVALID_SESSION_STATE =
  "Ignored invalid persisted fast mode session state.";
const FORK_READ_ERROR = "Cannot restore fast mode from the source session.";
const GLOBAL_READ_ERROR =
  "Cannot read the global fast mode preference. Fast mode defaulted to off.";
const SESSION_WRITE_ERROR =
  "Fast mode changed, but its session state could not be saved.";
const GLOBAL_WRITE_ERROR =
  "Fast mode changed for this session, but the global default could not be saved.";

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
  mode: FastMode,
  view: PiViewAdapter,
): void {
  try {
    appendFastModeSessionState(pi, mode);
  } catch {
    view.notify(SESSION_WRITE_ERROR, "error");
  }
}

async function saveGlobalMode(
  store: FastModePreferenceStore,
  mode: FastMode,
  view: PiViewAdapter,
): Promise<void> {
  try {
    await store.save(mode);
  } catch {
    view.notify(GLOBAL_WRITE_ERROR, "error");
  }
}

async function initializeSession(
  pi: ExtensionAPI,
  controller: FastModeController,
  store: FastModePreferenceStore,
  startupPolicy: FastModeStartupPolicy,
  event: {
    readonly reason: "startup" | "reload" | "new" | "resume" | "fork";
    readonly previousSessionFile?: string;
  },
  context: ExtensionContext,
): Promise<void> {
  const view = new PiViewAdapter(context);
  const sessionState = readFastModeSessionState(
    context.sessionManager.getBranch(),
  );
  if (sessionState.invalid) view.notify(INVALID_SESSION_STATE, "warning");

  let forkMode: FastMode | undefined;
  if (event.reason === "fork" && event.previousSessionFile) {
    try {
      const forkState = readFastModeForkState(event.previousSessionFile);
      forkMode = forkState.mode;
      if (forkState.invalid) view.notify(INVALID_SESSION_STATE, "warning");
    } catch {
      view.notify(FORK_READ_ERROR, "warning");
    }
  }

  const forcedByFlag =
    event.reason === "startup" && pi.getFlag(FAST_FLAG) === true;
  let globalMode: FastMode | undefined;
  if (
    !forcedByFlag &&
    forkMode === undefined &&
    sessionState.mode === undefined
  ) {
    try {
      globalMode = await store.load();
    } catch {
      view.notify(GLOBAL_READ_ERROR, "error");
    }
  }

  const mode = startupPolicy.resolve({
    forcedByFlag,
    forkMode,
    sessionMode: sessionState.mode,
    globalMode,
  });
  controller.initialize(mode, toModelSnapshot(context.model), view);

  if (
    forcedByFlag ||
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
  controller: FastModeController,
  store: FastModePreferenceStore,
  startupPolicy: FastModeStartupPolicy,
): void {
  pi.registerFlag(FAST_FLAG, {
    description: "Request OpenAI priority service tier",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("fast", {
    description: "Show OpenAI fast mode status",
    handler: async (args, context) => {
      const view = new PiViewAdapter(context);
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
    appendSessionMode(pi, controller.getMode(), new PiViewAdapter(context));
  });

  pi.on("session_tree", (_event, context) => {
    const view = new PiViewAdapter(context);
    const sessionState = readFastModeSessionState(
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
      controller.handleModelSelection(model, new PiViewAdapter(context));
    }
  });

  pi.on("before_provider_request", (event, context) => {
    const result = controller.transformProviderPayload(
      toModelSnapshot(context.model),
      event.payload,
      new PiViewAdapter(context),
    );
    return result.payload;
  });
}
