/**
 * Optional ffmpeg integration for video normalization.
 *
 * Video is normalized to a 640px H.264 MP4 so any provider that accepts
 * `video_url` or `input_video` receives a predictable payload. When ffmpeg is
 * missing, only formats the endpoint is likely to decode pass through as-is.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BUFFER_BYTES = 1024 * 1024;

/**
 * Returns the ffmpeg executable from `PI_MEDIA_FFMPEG` or `PATH`, or undefined
 * when none responds.
 */
export async function findFfmpeg(): Promise<string | undefined> {
  const candidate = process.env.PI_MEDIA_FFMPEG?.trim() || "ffmpeg";
  try {
    await execFileAsync(candidate, ["-version"], {
      timeout: 10_000,
      maxBuffer: MAX_BUFFER_BYTES,
    });
    return candidate;
  } catch {
    return undefined;
  }
}

/**
 * Returns the ffprobe executable matching `ffmpeg`, or undefined when none
 * responds.
 */
export async function findFfprobe(ffmpeg: string): Promise<string | undefined> {
  const explicit = process.env.PI_MEDIA_FFPROBE?.trim();
  const candidates = explicit
    ? [explicit]
    : [ffmpeg.replace(/ffmpeg$/, "ffprobe"), "ffprobe"];
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["-version"], {
        timeout: 10_000,
        maxBuffer: MAX_BUFFER_BYTES,
      });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

/**
 * Returns whether a media file has at least one audio stream.
 */
export async function hasAudioStream(
  ffprobe: string,
  source: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const { stdout } = await execFileAsync(
    ffprobe,
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      source,
    ],
    { signal, timeout: 30_000, maxBuffer: MAX_BUFFER_BYTES },
  );
  return stdout.trim().length > 0;
}

/**
 * Extracts the first audio stream as mono 16 kHz MP3.
 */
export async function extractAudioMp3(
  ffmpeg: string,
  source: string,
  target: string,
  signal?: AbortSignal,
): Promise<void> {
  await execFileAsync(
    ffmpeg,
    [
      "-nostdin",
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "64k",
      target,
    ],
    { signal, timeout: FFMPEG_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES },
  );
}

/**
 * Extracts the first audio stream as mono 16 kHz WAV.
 *
 * Fallback for builds without the MP3 encoder.
 */
export async function extractAudioWav(
  ffmpeg: string,
  source: string,
  target: string,
  signal?: AbortSignal,
): Promise<void> {
  await execFileAsync(
    ffmpeg,
    [
      "-nostdin",
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      target,
    ],
    { signal, timeout: FFMPEG_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES },
  );
}

/**
 * Normalizes a video to a square-pixel 640px H.264 MP4 without audio.
 *
 * The audio track is dropped: the model receives visual content only, matching
 * what the video transport parts carry.
 */
export async function normalizeVideo(
  ffmpeg: string,
  source: string,
  target: string,
  signal?: AbortSignal,
): Promise<void> {
  await execFileAsync(
    ffmpeg,
    [
      "-nostdin",
      "-v",
      "error",
      "-y",
      "-i",
      source,
      "-map",
      "0:v:0",
      "-an",
      "-vf",
      "scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-map_metadata",
      "-1",
      "-metadata:s:v:0",
      "rotate=0",
      "-movflags",
      "+faststart",
      target,
    ],
    { signal, timeout: FFMPEG_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES },
  );
}
