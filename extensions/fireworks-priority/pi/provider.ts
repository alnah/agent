import type {
  Api,
  AssistantMessageEventStream,
  Model,
  Provider,
  SimpleStreamOptions,
  StreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { scalePriorityCost } from "../core/cost.ts";
import type { PriorityEligibilityPolicy } from "../core/eligibility.ts";
import type { PriorityPayloadDecorator } from "../core/payload.ts";
import type { InMemoryPriorityModeState } from "../core/state.ts";

const FIREWORKS_PROVIDER_ID = "fireworks";

type PayloadHook = (payload: unknown, model: unknown) => unknown;

interface PayloadOptions {
  onPayload?: PayloadHook;
}

/** Provider members added after pi-ai 0.85.1, delegated when present. */
interface ProviderExtensions {
  getAllModels?: () => unknown;
  filterAllModels?: (models: unknown, credential: unknown) => unknown;
  generateImages?: (
    model: unknown,
    context: unknown,
    options?: unknown,
  ) => unknown;
  classify?: (model: unknown, context: unknown, options?: unknown) => unknown;
}

function isFireworksProvider(provider: Provider): boolean {
  // Only the provider identity and a non-empty chat catalog are required. Per-API
  // support stays in PriorityEligibilityPolicy so a future catalog addition with
  // another API cannot break extension loading.
  return (
    provider.id === FIREWORKS_PROVIDER_ID && provider.getModels().length > 0
  );
}

/** Returns a fresh builtin provider so wrappers never stack across reloads. */
export function getBuiltinFireworksProvider(): Provider {
  const provider = builtinProviders().find(
    (candidate) => candidate.id === FIREWORKS_PROVIDER_ID,
  );
  if (!provider || !isFireworksProvider(provider)) {
    throw new Error("Builtin Fireworks provider contract is unavailable");
  }
  return provider;
}

function createPriorityPayloadHook(
  original: PayloadHook | undefined,
  state: InMemoryPriorityModeState,
  decorator: PriorityPayloadDecorator,
): PayloadHook {
  return async (payload, model) => {
    const replaced = original ? await original(payload, model) : undefined;
    const candidate = replaced === undefined ? payload : replaced;
    const result = decorator.decorate(candidate);
    if (result.kind === "failure") {
      state.setFault(result.fault);
      throw new Error(result.fault.message);
    }
    return result.payload;
  };
}

function withPriorityOptions<T extends object>(
  options: T | undefined,
  state: InMemoryPriorityModeState,
  decorator: PriorityPayloadDecorator,
): T {
  const original = (options as PayloadOptions | undefined)?.onPayload;
  return {
    ...(options ?? {}),
    onPayload: createPriorityPayloadHook(original, state, decorator),
  } as T;
}

function withPriorityCost(model: Model<Api>, multiplier: number): Model<Api> {
  return { ...model, cost: scalePriorityCost(model.cost, multiplier) };
}

/** Delegates all native behavior and adds priority only for armed targets. */
export function createPriorityFireworksProvider(
  base: Provider,
  state: InMemoryPriorityModeState,
  policy: PriorityEligibilityPolicy,
  decorator: PriorityPayloadDecorator,
): Provider {
  const refreshModels = base.refreshModels?.bind(base);
  const filterModels = base.filterModels?.bind(base);
  const fetchDeferred = base.fetchDeferred?.bind(base);
  const cancelDeferred = base.cancelDeferred?.bind(base);
  const baseExtensions = base as ProviderExtensions;
  const getAllModels = baseExtensions.getAllModels?.bind(base);
  const filterAllModels = baseExtensions.filterAllModels?.bind(base);
  const generateImages = baseExtensions.generateImages?.bind(base);
  const classify = baseExtensions.classify?.bind(base);

  const multiplierFor = (model: Model<Api>): number | undefined => {
    const snapshot = state.snapshot();
    if (snapshot.mode !== "armed" || snapshot.fault) return undefined;
    const result = policy.evaluate({
      provider: model.provider,
      api: model.api,
      modelId: model.id,
    });
    return result.eligible ? result.multiplier : undefined;
  };

  const provider: Provider = {
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
    stream(
      model: Model<Api>,
      context: TranscriptContext,
      options?: StreamOptions,
    ): AssistantMessageEventStream {
      const multiplier = multiplierFor(model);
      if (multiplier === undefined) return base.stream(model, context, options);
      return base.stream(
        withPriorityCost(model, multiplier),
        context,
        withPriorityOptions(options, state, decorator),
      );
    },
    streamSimple(
      model: Model<Api>,
      context: TranscriptContext,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      const multiplier = multiplierFor(model);
      if (multiplier === undefined) {
        return base.streamSimple(model, context, options);
      }
      return base.streamSimple(
        withPriorityCost(model, multiplier),
        context,
        withPriorityOptions(options, state, decorator),
      );
    },
    fetchDeferred: fetchDeferred
      ? (model, handle, options) => fetchDeferred(model, handle, options)
      : undefined,
    cancelDeferred: cancelDeferred
      ? (model, handle, options) => cancelDeferred(model, handle, options)
      : undefined,
  };

  if (getAllModels) {
    (provider as ProviderExtensions).getAllModels = () => getAllModels();
  }
  if (filterAllModels) {
    (provider as ProviderExtensions).filterAllModels = (models, credential) =>
      filterAllModels(models, credential);
  }
  if (generateImages) {
    (provider as ProviderExtensions).generateImages = (
      model,
      context,
      options,
    ) => generateImages(model, context, options);
  }
  if (classify) {
    (provider as ProviderExtensions).classify = (model, context, options) =>
      classify(model, context, options);
  }

  return provider;
}

/** Installs the wrapper and restores the builtin provider during teardown. */
export function registerPriorityFireworksProvider(
  pi: ExtensionAPI,
  state: InMemoryPriorityModeState,
  policy: PriorityEligibilityPolicy,
  decorator: PriorityPayloadDecorator,
): void {
  const provider = createPriorityFireworksProvider(
    getBuiltinFireworksProvider(),
    state,
    policy,
    decorator,
  );
  pi.registerProvider(provider);
  pi.on("session_shutdown", () => {
    pi.unregisterProvider(FIREWORKS_PROVIDER_ID);
  });
}
