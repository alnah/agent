/**
 * Pure helpers for native media attachments.
 *
 * Pi tool results only carry text and images, so media travels through a
 * three-step pipeline: the read tool stores a JSON ref, the context hook tags
 * the serialized tool result with a marker, and the provider hook rewrites
 * that marker into a native content part in a user message.
 */

export type MediaKind = "video" | "audio";

export type VideoFormat = "video_url" | "input_video";

export type AudioFormat = "input_audio" | "audio_url";

export type AudioPreference = AudioFormat | "auto";

/**
 * Persisted reference to one read media file.
 *
 * The ref is JSON, so it survives the session. Bytes are re-read and verified
 * against `sha256` before every provider request.
 */
export interface MediaRef {
  readonly version: 1;
  readonly kind: MediaKind;
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly mimeType: string;
}

/**
 * Resolved transport capabilities for one model.
 *
 * `false` disables that media kind. Video and audio formats are wire formats,
 * not provider names: `video_url` and `audio_url` use inline data URLs, while
 * `input_video` and `input_audio` use the raw base64 payload.
 */
export interface MediaCapabilities {
  readonly video: VideoFormat | false;
  readonly audio: AudioPreference | false;
}

const VIDEO_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ["mp4", "video/mp4"],
  ["m4v", "video/x-m4v"],
  ["mov", "video/quicktime"],
  ["webm", "video/webm"],
  ["mkv", "video/x-matroska"],
  ["avi", "video/x-msvideo"],
]);

const AUDIO_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ["wav", "audio/wav"],
  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["opus", "audio/opus"],
]);

const MEDIA_MARKER_PATTERN = /\[media-ref:([a-f0-9]{64})\]/g;

type JsonRecord = Record<string, unknown>;

/**
 * Returns the media kind for a path, or undefined for other files.
 */
export function mediaKind(path: string): MediaKind | undefined {
  const extension = extensionOf(path);
  if (VIDEO_MIME_TYPES.has(extension)) return "video";
  if (AUDIO_MIME_TYPES.has(extension)) return "audio";
  return undefined;
}

/**
 * Returns the MIME type for a media path of the given kind.
 */
export function mediaMimeType(
  path: string,
  kind: MediaKind,
): string | undefined {
  const table = kind === "video" ? VIDEO_MIME_TYPES : AUDIO_MIME_TYPES;
  return table.get(extensionOf(path));
}

/**
 * Builds the marker that links a serialized tool result to a media ref.
 */
export function mediaMarker(key: string): string {
  return `[media-ref:${key}]`;
}

/**
 * Chooses the transport format for one ref, or undefined when unsupported.
 */
export function formatForRef(
  ref: MediaRef,
  capabilities: MediaCapabilities,
): VideoFormat | AudioFormat | undefined {
  if (ref.kind === "video") {
    return capabilities.video || undefined;
  }
  if (!capabilities.audio) return undefined;
  return formatForAudio(ref.mimeType, capabilities.audio);
}

/**
 * Chooses the audio transport format for one MIME type.
 *
 * `input_audio` only accepts wav and mp3, so other audio formats fall back to
 * `audio_url` even when the config asks for `input_audio`.
 */
export function formatForAudio(
  mimeType: string,
  preference: AudioPreference,
): AudioFormat {
  const preferred =
    preference === "auto" ? defaultAudioFormat(mimeType) : preference;
  if (preferred === "input_audio") {
    return supportsInputAudio(mimeType) ? "input_audio" : "audio_url";
  }
  return "audio_url";
}

/**
 * Builds a provider video content part.
 */
export function videoBlock(
  mimeType: string,
  format: VideoFormat,
  data: Buffer,
): JsonRecord {
  const base64 = data.toString("base64");
  if (format === "input_video") {
    return { type: "input_video", input_video: { data: base64 } };
  }
  return {
    type: "video_url",
    video_url: { url: `data:${mimeType};base64,${base64}` },
  };
}

/**
 * Builds a provider audio content part.
 */
export function audioBlock(
  mimeType: string,
  format: AudioFormat,
  data: Buffer,
): JsonRecord {
  const base64 = data.toString("base64");
  if (format === "input_audio") {
    return {
      type: "input_audio",
      input_audio: { data: base64, format: inputAudioFormat(mimeType) },
    };
  }
  return {
    type: "audio_url",
    audio_url: { url: `data:${mimeType};base64,${base64}` },
  };
}

/**
 * Removes every marker from a payload without touching other text.
 */
export function cleanMediaMarkers(payload: unknown): unknown {
  return mapPayloadText(payload, (text) => {
    const cleaned = text.replace(MEDIA_MARKER_PATTERN, "");
    return cleaned === text ? text : cleaned.trimEnd();
  });
}

/**
 * Replaces markers with an explicit omission so the model never sees a marker.
 */
export function omitMediaMarkers(
  payload: unknown,
  refs: ReadonlyMap<string, MediaRef>,
  reason: string,
): unknown {
  return mapPayloadText(payload, (text) => {
    let replaced = false;
    const next = text.replace(MEDIA_MARKER_PATTERN, (match, key: string) => {
      if (!refs.has(key)) return match;
      replaced = true;
      return `Previously read media omitted: ${reason}.`;
    });
    return replaced ? next.trimEnd() : text;
  });
}

/**
 * Bytes for one ref plus its extracted audio track, when present.
 */
export interface MediaPayload {
  readonly data: Buffer;
  readonly mimeType: string;
  readonly audio?: { readonly data: Buffer; readonly mimeType: string };
}

/**
 * Rewrites a serialized provider payload with native media parts.
 *
 * Tool messages stay untouched apart from marker cleanup. After each group of
 * consecutive tool messages, a user message carries the text and the native
 * media blocks, mirroring how Pi attaches images from tool results. A video
 * payload with an extracted audio track adds both parts when the model
 * declares audio input.
 */
export async function rewriteMediaPayload(
  payload: unknown,
  refs: ReadonlyMap<string, MediaRef>,
  capabilities: MediaCapabilities,
  load: (ref: MediaRef) => Promise<MediaPayload>,
): Promise<unknown> {
  if (!isRecord(payload) || !Array.isArray(payload.messages)) {
    return cleanMediaMarkers(payload);
  }

  const rawMessages = payload.messages;
  const messages: unknown[] = [];

  for (let index = 0; index < rawMessages.length; index += 1) {
    const message = rawMessages[index];
    messages.push(cleanMessage(message));
    if (!isRecord(message) || message.role !== "tool") continue;

    const group: unknown[] = [message];
    while (
      index + 1 < rawMessages.length &&
      isRecord(rawMessages[index + 1]) &&
      (rawMessages[index + 1] as JsonRecord).role === "tool"
    ) {
      index += 1;
      group.push(rawMessages[index]);
      messages.push(cleanMessage(rawMessages[index]));
    }

    const content: unknown[] = [];
    const seen = new Set<string>();
    for (const toolMessage of group) {
      for (const ref of refsInToolMessage(toolMessage, refs)) {
        if (seen.has(ref.sha256)) continue;
        seen.add(ref.sha256);
        const format = formatForRef(ref, capabilities);
        if (!format) {
          content.push({
            type: "text",
            text: `Previously read ${ref.kind} omitted: the selected model does not accept ${ref.kind} input.`,
          });
          continue;
        }
        const media = await load(ref);
        content.push({
          type: "text",
          text: `Attached ${ref.kind} from ${ref.path}:`,
        });
        if (ref.kind === "video") {
          content.push(
            videoBlock(media.mimeType, format as VideoFormat, media.data),
          );
        } else {
          content.push(
            audioBlock(media.mimeType, format as AudioFormat, media.data),
          );
        }
        if (media.audio && capabilities.audio) {
          const audioFormat = formatForAudio(
            media.audio.mimeType,
            capabilities.audio,
          );
          content.push({
            type: "text",
            text: `Audio track from ${ref.path}:`,
          });
          content.push(
            audioBlock(media.audio.mimeType, audioFormat, media.audio.data),
          );
        }
      }
    }

    if (content.length > 0) {
      messages.push({ role: "user", content });
    }
  }

  return cleanMediaMarkers({ ...payload, messages });
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function defaultAudioFormat(mimeType: string): AudioFormat {
  return supportsInputAudio(mimeType) ? "input_audio" : "audio_url";
}

function supportsInputAudio(mimeType: string): boolean {
  return mimeType === "audio/wav" || mimeType === "audio/mpeg";
}

function inputAudioFormat(mimeType: string): "wav" | "mp3" {
  return mimeType === "audio/wav" ? "wav" : "mp3";
}

function isRecord(value: unknown): value is JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanMessage(message: unknown): unknown {
  if (isRecord(message) && message.role === "tool") {
    return { ...message, content: cleanMediaMarkers(message.content) };
  }
  return message;
}

function refsInToolMessage(
  message: unknown,
  refs: ReadonlyMap<string, MediaRef>,
): MediaRef[] {
  if (!isRecord(message)) return [];
  const text = collectText(message.content);
  const found: MediaRef[] = [];
  for (const match of text.matchAll(MEDIA_MARKER_PATTERN)) {
    const ref = refs.get(match[1]);
    if (ref) found.push(ref);
  }
  return found;
}

function collectText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      isRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("\n");
}

function mapPayloadText(
  value: unknown,
  transform: (text: string) => string,
): unknown {
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value)) {
    return value.map((item) => mapPayloadText(item, transform));
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).map(
      ([key, item]) => [key, mapPayloadText(item, transform)] as const,
    );
    return Object.fromEntries(entries);
  }
  return value;
}
