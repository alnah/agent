/**
 * Tags media tool results in a request-local message clone.
 *
 * Pi restores the original messages after the `context` event, so markers only
 * ever exist in the serialized request. The ref map keyed by marker lets the
 * provider hook resolve each marker back to its file.
 */

import { createHash } from "node:crypto";

import type { ContextEvent } from "@earendil-works/pi-coding-agent";

import { type MediaRef, mediaMarker } from "../core/media.ts";

type ContextMessages = ContextEvent["messages"];

interface ToolResultLike {
  readonly role?: unknown;
  readonly toolCallId?: unknown;
  readonly toolName?: unknown;
  readonly content?: unknown;
  readonly details?: unknown;
  readonly isError?: unknown;
}

export interface TaggedMediaContext {
  readonly messages: ContextMessages;
  readonly refs: Map<string, MediaRef>;
}

/**
 * Appends a marker to every media read result and returns the ref map.
 */
export function tagMediaToolResults(
  messages: ContextMessages,
): TaggedMediaContext {
  const refs = new Map<string, MediaRef>();
  const tagged = messages.map((message) => {
    const ref = mediaRefOf(message);
    if (!ref) return message;
    const key = mediaRefKey(message as ToolResultLike, ref);
    refs.set(key, ref);
    const content = Array.isArray((message as ToolResultLike).content)
      ? ((message as ToolResultLike).content as unknown[])
      : [];
    return {
      ...(message as object),
      content: [...content, { type: "text", text: mediaMarker(key) }],
    } as ContextMessages[number];
  });
  return { messages: tagged, refs };
}

function mediaRefOf(message: unknown): MediaRef | undefined {
  const candidate = message as ToolResultLike;
  if (
    candidate.role !== "toolResult" ||
    candidate.toolName !== "read" ||
    candidate.isError === true
  ) {
    return undefined;
  }
  const details = candidate.details;
  if (typeof details !== "object" || details === null) return undefined;
  const ref = (details as { media?: MediaRef }).media;
  return ref?.version === 1 ? ref : undefined;
}

function mediaRefKey(message: ToolResultLike, ref: MediaRef): string {
  return createHash("sha256")
    .update(JSON.stringify([message.toolCallId ?? "", ref.path, ref.sha256]))
    .digest("hex");
}
