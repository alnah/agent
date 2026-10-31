/**
 * Filesystem side of media reading: config lookup, refs, and transport bytes.
 *
 * Source files are hashed when read and verified again before every request,
 * so a changed or missing file becomes an explicit omission instead of stale
 * bytes. Size is bounded only by the provider: the declared
 * `inputLimits.maxRequestBytes`, when present, is enforced by the caller.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { parseJsonc } from "../core/jsonc.ts";
import { type MediaKind, type MediaRef, mediaMimeType } from "../core/media.ts";
import {
  extractAudioMp3,
  extractAudioWav,
  findFfmpeg,
  findFfprobe,
  hasAudioStream,
  normalizeVideo,
} from "./ffmpeg.ts";

const CACHE_DIRECTORY = "pi-media-v1";

const PASSTHROUGH_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm"]);

/**
 * Reads and caches `models.json`, re-reading it when the file changes.
 */
export class ModelsConfigReader {
  private cache: { mtimeMs: number; config: unknown } | undefined;

  constructor(private readonly filePath: string) {}

  async read(): Promise<unknown> {
    try {
      const stats = await fs.stat(this.filePath);
      if (this.cache && this.cache.mtimeMs === stats.mtimeMs) {
        return this.cache.config;
      }
      const config = parseJsonc(await fs.readFile(this.filePath, "utf8"));
      this.cache = { mtimeMs: stats.mtimeMs, config };
      return config;
    } catch {
      return {};
    }
  }
}

/**
 * Resolves a user-supplied path against the session working directory.
 */
export function resolveMediaPath(input: string, cwd: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return resolve(cwd, input);
}

/**
 * Validates a media file and returns its persisted ref.
 */
export async function createMediaRef(
  path: string,
  kind: MediaKind,
  signal?: AbortSignal,
): Promise<MediaRef> {
  const mimeType = mediaMimeType(path, kind);
  if (!mimeType) throw new Error(`Unsupported ${kind} file type: ${path}`);
  const stats = await fs.stat(path);
  if (!stats.isFile()) throw new Error(`Not a regular file: ${path}`);
  const { size, sha256 } = await hashFile(path, signal);
  return { version: 1, kind, path, size, sha256, mimeType };
}

export interface MediaTransport {
  readonly data: Buffer;
  readonly mimeType: string;
  readonly audio?: { readonly data: Buffer; readonly mimeType: string };
}

export interface PrepareTransportOptions {
  readonly signal?: AbortSignal;
  /** Extract and attach the video's audio track when the model accepts audio. */
  readonly includeAudio?: boolean;
}

/**
 * Verifies a ref and returns the bytes to send to the provider.
 *
 * Video is normalized through ffmpeg and cached by content hash; audio passes
 * through unchanged. When `includeAudio` is set, a video's audio track is
 * extracted separately and cached under the same hash. No size cap is applied
 * here: the provider limit is enforced against the serialized request.
 */
export async function prepareTransport(
  ref: MediaRef,
  options: PrepareTransportOptions = {},
): Promise<MediaTransport> {
  const { size, sha256 } = await hashFile(ref.path, options.signal);
  if (size !== ref.size || sha256 !== ref.sha256) {
    throw new Error(
      `${ref.kind} changed since it was read; read the file again`,
    );
  }

  if (ref.kind === "audio") {
    return {
      data: await fs.readFile(ref.path, { signal: options.signal }),
      mimeType: ref.mimeType,
    };
  }

  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) {
    if (PASSTHROUGH_VIDEO_MIME_TYPES.has(ref.mimeType)) {
      return {
        data: await fs.readFile(ref.path, { signal: options.signal }),
        mimeType: ref.mimeType,
      };
    }
    throw new Error(
      `Reading ${ref.mimeType} requires ffmpeg on PATH, or set PI_MEDIA_FFMPEG`,
    );
  }

  const data = await ensureNormalizedVideo(ffmpeg, ref, options.signal);
  if (!options.includeAudio) return { data, mimeType: "video/mp4" };

  const audio = await ensureVideoAudio(ffmpeg, ref, options.signal);
  return audio === undefined
    ? { data, mimeType: "video/mp4" }
    : { data, mimeType: "video/mp4", audio };
}

/**
 * Returns the cached 640px H.264 MP4, normalizing it on first use.
 */
async function ensureNormalizedVideo(
  ffmpeg: string,
  ref: MediaRef,
  signal?: AbortSignal,
): Promise<Buffer> {
  const cached = join(tmpdir(), CACHE_DIRECTORY, `${ref.sha256}-640.mp4`);
  try {
    return await fs.readFile(cached);
  } catch {
    // Cache miss: normalize below.
  }

  await fs.mkdir(dirname(cached), { recursive: true });
  const pending = join(
    dirname(cached),
    `${ref.sha256}-${process.pid}-${Date.now()}.mp4`,
  );
  try {
    await normalizeVideo(ffmpeg, ref.path, pending, signal);
    await fs.rename(pending, cached);
  } finally {
    await fs.rm(pending, { force: true });
  }
  return await fs.readFile(cached);
}

/**
 * Returns the cached audio track of a video, or undefined when it has none.
 *
 * MP3 is preferred; WAV is the fallback for builds without an MP3 encoder.
 * When the file has no audio stream, extraction is skipped after an ffprobe
 * check.
 */
async function ensureVideoAudio(
  ffmpeg: string,
  ref: MediaRef,
  signal?: AbortSignal,
): Promise<{ data: Buffer; mimeType: string } | undefined> {
  const directory = join(tmpdir(), CACHE_DIRECTORY);
  const mp3 = join(directory, `${ref.sha256}-audio.mp3`);
  try {
    return { data: await fs.readFile(mp3), mimeType: "audio/mpeg" };
  } catch {
    // Cache miss: extract below.
  }
  const wav = join(directory, `${ref.sha256}-audio.wav`);
  try {
    return { data: await fs.readFile(wav), mimeType: "audio/wav" };
  } catch {
    // Cache miss: extract below.
  }

  const probe = await findFfprobe(ffmpeg);
  if (probe) {
    try {
      if (!(await hasAudioStream(probe, ref.path, signal))) return undefined;
    } catch {
      // Probe failed: attempt extraction anyway.
    }
  }

  await fs.mkdir(directory, { recursive: true });
  const pendingMp3 = join(
    directory,
    `${ref.sha256}-${process.pid}-${Date.now()}.mp3`,
  );
  try {
    await extractAudioMp3(ffmpeg, ref.path, pendingMp3, signal);
    await fs.rename(pendingMp3, mp3);
    return { data: await fs.readFile(mp3), mimeType: "audio/mpeg" };
  } catch {
    await fs.rm(pendingMp3, { force: true });
  }

  const pendingWav = join(
    directory,
    `${ref.sha256}-${process.pid}-${Date.now()}.wav`,
  );
  try {
    await extractAudioWav(ffmpeg, ref.path, pendingWav, signal);
    await fs.rename(pendingWav, wav);
    return { data: await fs.readFile(wav), mimeType: "audio/wav" };
  } catch {
    await fs.rm(pendingWav, { force: true });
  }

  return undefined;
}

/**
 * Hashes a file without loading it into memory.
 */
async function hashFile(
  path: string,
  signal?: AbortSignal,
): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path, { signal })) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    hash.update(buffer);
  }
  return { size, sha256: hash.digest("hex") };
}
