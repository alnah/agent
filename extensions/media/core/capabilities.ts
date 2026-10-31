/**
 * Resolves per-model media capabilities from `models.json`.
 *
 * Capabilities are opt-in. A model without a `media` setting accepts no media,
 * so the extension fails closed instead of sending parts the endpoint rejects.
 *
 * Supported shapes, read from the matching `models[]` entry and then from
 * `modelOverrides[id]`:
 *
 * ```json
 * { "media": { "video": true, "audio": true } }
 * { "media": { "video": "input_video", "audio": "audio_url" } }
 * { "video": true, "audio": "input_audio" }
 * ```
 *
 * The provider request limit, when declared, comes from Pi's native
 * `inputLimits.maxRequestBytes` field on the same entry. The extension never
 * invents its own size cap.
 */

import type {
  AudioPreference,
  MediaCapabilities,
  VideoFormat,
} from "./media.ts";

export const NO_MEDIA_CAPABILITIES: MediaCapabilities = Object.freeze({
  video: false as const,
  audio: false as const,
});

const VIDEO_FORMATS: readonly VideoFormat[] = ["video_url", "input_video"];
const AUDIO_FORMATS: readonly AudioPreference[] = ["input_audio", "audio_url"];

type JsonRecord = Record<string, unknown>;

export interface ResolvedModelMedia {
  readonly capabilities: MediaCapabilities;
  /** Declared maximum serialized provider request size, when configured. */
  readonly maxRequestBytes?: number;
}

/**
 * Resolves media capabilities and the declared request limit for one model.
 *
 * Values from `modelOverrides` win over the matching `models[]` entry, and the
 * nested `media` object wins over flat `video` and `audio` fields.
 */
export function resolveModelMedia(
  config: unknown,
  providerId: string,
  modelId: string,
): ResolvedModelMedia {
  const candidates = modelCandidates(config, providerId, modelId);

  let video: VideoFormat | false = false;
  let audio: AudioPreference | false = false;
  let maxRequestBytes: number | undefined;

  for (const candidate of candidates) {
    const media = isRecord(candidate.media) ? candidate.media : {};
    video = applyVideo(video, candidate.video ?? media.video);
    audio = applyAudio(audio, candidate.audio ?? media.audio);

    const limits = candidate.inputLimits;
    if (isRecord(limits)) {
      const value = limits.maxRequestBytes;
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        maxRequestBytes = value;
      }
    }
  }

  const capabilities: MediaCapabilities = { video, audio };
  return maxRequestBytes === undefined
    ? { capabilities }
    : { capabilities, maxRequestBytes };
}

/**
 * Collects the model entries that apply, in increasing precedence order.
 */
function modelCandidates(
  config: unknown,
  providerId: string,
  modelId: string,
): JsonRecord[] {
  const providers = isRecord(config) ? config.providers : undefined;
  const provider = isRecord(providers) ? providers[providerId] : undefined;
  if (!isRecord(provider)) return [];

  const candidates: JsonRecord[] = [];
  if (Array.isArray(provider.models)) {
    for (const entry of provider.models) {
      if (isRecord(entry) && entry.id === modelId) candidates.push(entry);
    }
  }
  const overrides = provider.modelOverrides;
  if (isRecord(overrides) && isRecord(overrides[modelId])) {
    candidates.push(overrides[modelId] as JsonRecord);
  }
  return candidates;
}

function applyVideo(
  current: VideoFormat | false,
  value: unknown,
): VideoFormat | false {
  if (value === undefined) return current;
  if (value === true) return "video_url";
  if (
    typeof value === "string" &&
    (VIDEO_FORMATS as readonly string[]).includes(value)
  ) {
    return value as VideoFormat;
  }
  return false;
}

function applyAudio(
  current: AudioPreference | false,
  value: unknown,
): AudioPreference | false {
  if (value === undefined) return current;
  if (value === true) return "auto";
  if (
    typeof value === "string" &&
    (AUDIO_FORMATS as readonly string[]).includes(value)
  ) {
    return value as AudioPreference;
  }
  return false;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
