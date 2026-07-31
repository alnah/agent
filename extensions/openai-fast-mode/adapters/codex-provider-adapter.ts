import {
  type Context,
  clampThinkingLevel,
  type Model,
  type OpenAICodexResponsesOptions,
  type Provider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FastModeEligibilityPolicy } from "../domain/fast-mode-policy.ts";
import type { InMemoryFastModeState } from "../domain/fast-mode-state.ts";
import type { PriorityPayloadDecorator } from "../domain/priority-payload-decorator.ts";

const CODEX_PROVIDER_ID = "openai-codex";
type CodexApi = "openai-codex-responses";
type CodexProvider = Provider<CodexApi>;

function isCodexProvider(provider: Provider): provider is CodexProvider {
  if (provider.id !== CODEX_PROVIDER_ID) return false;
  const models = provider.getModels();
  return (
    models.length > 0 &&
    models.every((model) => model.api === "openai-codex-responses")
  );
}

/** Returns a fresh builtin provider so wrappers never stack across reloads. */
export function getBuiltinCodexProvider(): CodexProvider {
  const provider = builtinProviders().find(
    (candidate) => candidate.id === CODEX_PROVIDER_ID,
  );
  if (!provider || !isCodexProvider(provider)) {
    throw new Error("Builtin OpenAI Codex provider contract is unavailable");
  }
  return provider;
}

function shouldUsePriority(
  model: Model<CodexApi>,
  state: InMemoryFastModeState,
  policy: FastModeEligibilityPolicy,
): boolean {
  const snapshot = state.snapshot();
  if (snapshot.mode !== "armed" || snapshot.fault) return false;
  return policy.evaluate({
    provider: model.provider,
    api: model.api,
    modelId: model.id,
  }).eligible;
}

function createPriorityPayloadHandler(
  original: OpenAICodexResponsesOptions["onPayload"],
  state: InMemoryFastModeState,
  decorator: PriorityPayloadDecorator,
): NonNullable<OpenAICodexResponsesOptions["onPayload"]> {
  return async (payload, model) => {
    const transformed = original ? await original(payload, model) : undefined;
    const candidate = transformed === undefined ? payload : transformed;
    const result = decorator.decorate(candidate);
    if (result.kind === "failure") {
      state.setFault(result.fault);
      throw new Error(result.fault.message);
    }
    return result.payload;
  };
}

function createPriorityOptions(
  options: OpenAICodexResponsesOptions | undefined,
  state: InMemoryFastModeState,
  decorator: PriorityPayloadDecorator,
): OpenAICodexResponsesOptions {
  return {
    ...options,
    serviceTier: "priority",
    onPayload: createPriorityPayloadHandler(
      options?.onPayload,
      state,
      decorator,
    ),
  };
}

function streamCodex(
  base: CodexProvider,
  model: Model<CodexApi>,
  context: Context,
  options: OpenAICodexResponsesOptions | undefined,
) {
  return base.stream(model, context, options);
}

function streamPrioritySimple(
  base: CodexProvider,
  model: Model<CodexApi>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  state: InMemoryFastModeState,
  decorator: PriorityPayloadDecorator,
) {
  const clampedReasoning = options?.reasoning
    ? clampThinkingLevel(model, options.reasoning)
    : undefined;
  const reasoningEffort =
    clampedReasoning === "off" ? undefined : clampedReasoning;
  const {
    reasoning: _reasoning,
    thinkingBudgets: _thinkingBudgets,
    ...rest
  } = options ?? {};
  return streamCodex(
    base,
    model,
    context,
    createPriorityOptions({ ...rest, reasoningEffort }, state, decorator),
  );
}

/** Delegates all native behavior and adds priority only for active Codex Sol. */
export function createPriorityCodexProvider(
  base: CodexProvider,
  state: InMemoryFastModeState,
  policy: FastModeEligibilityPolicy,
  decorator: PriorityPayloadDecorator,
): CodexProvider {
  const refreshModels = base.refreshModels?.bind(base);
  const filterModels = base.filterModels?.bind(base);
  return {
    id: base.id,
    name: base.name,
    baseUrl: base.baseUrl,
    headers: base.headers,
    auth: base.auth,
    getModels: () => base.getModels(),
    refreshModels: refreshModels
      ? (context) => refreshModels(context)
      : undefined,
    filterModels: filterModels
      ? (models, credential) => filterModels(models, credential)
      : undefined,
    stream(model, context, options) {
      if (!shouldUsePriority(model, state, policy)) {
        return base.stream(model, context, options);
      }
      return streamCodex(
        base,
        model,
        context,
        createPriorityOptions(options, state, decorator),
      );
    },
    streamSimple(model, context, options) {
      if (!shouldUsePriority(model, state, policy)) {
        return base.streamSimple(model, context, options);
      }
      return streamPrioritySimple(
        base,
        model,
        context,
        options,
        state,
        decorator,
      );
    },
  };
}

/** Installs the wrapper and restores the builtin provider during teardown. */
export function registerPriorityCodexProvider(
  pi: ExtensionAPI,
  state: InMemoryFastModeState,
  policy: FastModeEligibilityPolicy,
  decorator: PriorityPayloadDecorator,
): void {
  const provider = createPriorityCodexProvider(
    getBuiltinCodexProvider(),
    state,
    policy,
    decorator,
  );
  pi.registerProvider(provider);
  pi.on("session_shutdown", () => {
    pi.unregisterProvider(CODEX_PROVIDER_ID);
  });
}
