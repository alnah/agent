/**
 * Session parsing helpers for this extension.
 *
 * These helpers extract file references and file mutations from session entries
 * so the picker can surface both repository files and conversation context.
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import {
  formatDisplayPath,
  toCanonicalPath,
  toCanonicalPathMaybeMissing,
} from "./paths.ts";

export type ContentBlock = {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  arguments?: Record<string, unknown>;
};

export type FileReference = {
  path: string;
  display: string;
  exists: boolean;
  isDirectory: boolean;
};

export type FileToolName = "write" | "edit";

export type SessionFileChange = {
  operations: Set<FileToolName>;
  lastTimestamp: number;
};

export type SessionEntries = SessionEntry[];

const FILE_TAG_REGEX = /<file\s+name=["']([^"']+)["']>/g;
const FILE_URL_REGEX = /file:\/\/[^\s"'<>]+/g;
const PATH_REGEX = /(?:^|[\s"'`([{<])((?:~|\/)[^\s"'`<>)}\]]+)/g;

const extractFileReferencesFromText = (text: string): string[] => {
  const refs: string[] = [];

  for (const match of text.matchAll(FILE_TAG_REGEX)) {
    refs.push(match[1]);
  }

  for (const match of text.matchAll(FILE_URL_REGEX)) {
    refs.push(match[0]);
  }

  for (const match of text.matchAll(PATH_REGEX)) {
    refs.push(match[1]);
  }

  return refs;
};

const extractPathsFromToolArgs = (args: unknown): string[] => {
  if (!args || typeof args !== "object") {
    return [];
  }

  const refs: string[] = [];
  const record = args as Record<string, unknown>;
  const directKeys = [
    "path",
    "file",
    "filePath",
    "filepath",
    "fileName",
    "filename",
  ] as const;
  const listKeys = ["paths", "files", "filePaths"] as const;

  for (const key of directKeys) {
    const value = record[key];
    if (typeof value === "string") {
      refs.push(value);
    }
  }

  for (const key of listKeys) {
    const value = record[key];
    if (!Array.isArray(value)) {
      continue;
    }

    for (const item of value) {
      if (typeof item === "string") {
        refs.push(item);
      }
    }
  }

  return refs;
};

const extractFileReferencesFromContent = (content: unknown): string[] => {
  if (typeof content === "string") {
    return extractFileReferencesFromText(content);
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const refs: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const block = part as ContentBlock;
    if (block.type === "text" && typeof block.text === "string") {
      refs.push(...extractFileReferencesFromText(block.text));
    }

    if (block.type === "toolCall") {
      refs.push(...extractPathsFromToolArgs(block.arguments));
    }
  }

  return refs;
};

const extractFileReferencesFromEntry = (
  entry: SessionEntries[number],
): string[] => {
  if (entry.type === "message") {
    const message = entry.message;
    return "content" in message
      ? extractFileReferencesFromContent(message.content)
      : [];
  }

  if (entry.type === "custom_message") {
    return extractFileReferencesFromContent(entry.content);
  }

  return [];
};

const sanitizeReference = (raw: string): string => {
  let value = raw.trim();
  value = value.replace(/^["'`(<[]+/, "");
  value = value.replace(/[>"'`,;).\]]+$/, "");
  value = value.replace(/[.,;:]+$/, "");
  return value;
};

const isCommentLikeReference = (value: string): boolean =>
  value.startsWith("//");

const stripLineSuffix = (value: string): string => {
  const result = value.replace(/#L\d+(C\d+)?$/i, "");
  const lastSeparator = Math.max(
    result.lastIndexOf("/"),
    result.lastIndexOf("\\"),
  );
  const segmentStart = lastSeparator >= 0 ? lastSeparator + 1 : 0;
  const segment = result.slice(segmentStart);
  const colonIndex = segment.indexOf(":");
  if (colonIndex >= 0 && /\d/.test(segment[colonIndex + 1] ?? "")) {
    return result.slice(0, segmentStart + colonIndex);
  }

  const lastColon = result.lastIndexOf(":");
  if (lastColon > lastSeparator) {
    const suffix = result.slice(lastColon + 1);
    if (/^\d+(?::\d+)?$/.test(suffix)) {
      return result.slice(0, lastColon);
    }
  }

  return result;
};

const normalizeReferencePath = (raw: string, cwd: string): string | null => {
  let candidate = sanitizeReference(raw);
  if (!candidate || isCommentLikeReference(candidate)) {
    return null;
  }

  if (candidate.startsWith("file://")) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      return null;
    }
  }

  candidate = stripLineSuffix(candidate);
  if (!candidate || isCommentLikeReference(candidate)) {
    return null;
  }

  if (candidate.startsWith("~")) {
    candidate = path.join(os.homedir(), candidate.slice(1));
  }

  if (!path.isAbsolute(candidate)) {
    candidate = path.resolve(cwd, candidate);
  }

  candidate = path.normalize(candidate);
  const root = path.parse(candidate).root;
  if (candidate.length > root.length) {
    candidate = candidate.replace(/[\\/]+$/, "");
  }

  return candidate;
};

/**
 * Scans recent session entries backwards and returns the most recent unique file
 * references that still parse as local paths.
 */
export const collectRecentFileReferences = (
  entries: SessionEntries,
  cwd: string,
  limit: number,
): FileReference[] => {
  const results: FileReference[] = [];
  const seen = new Set<string>();

  for (let i = entries.length - 1; i >= 0 && results.length < limit; i -= 1) {
    const refs = extractFileReferencesFromEntry(entries[i]);
    for (let j = refs.length - 1; j >= 0 && results.length < limit; j -= 1) {
      const normalized = normalizeReferencePath(refs[j], cwd);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      const canonical = toCanonicalPathMaybeMissing(normalized);
      if (!canonical) {
        continue;
      }

      results.push({
        path: canonical.exists ? canonical.canonicalPath : normalized,
        display: formatDisplayPath(normalized, cwd),
        exists: canonical.exists,
        isDirectory: canonical.isDirectory,
      });
    }
  }

  return results;
};

/**
 * Returns the newest existing file reference mentioned in the current branch.
 */
export const findLatestFileReference = (
  entries: SessionEntries,
  cwd: string,
): FileReference | null => {
  const refs = collectRecentFileReferences(entries, cwd, 100);
  return refs.find((ref) => ref.exists) ?? null;
};

/**
 * Reconstructs file mutations from assistant file tool calls and their matching
 * tool results on the current session branch.
 */
export const collectSessionFileChanges = (
  entries: SessionEntries,
  cwd: string,
): Map<string, SessionFileChange> => {
  const toolCalls = new Map<string, { path: string; name: FileToolName }>();
  const fileChanges = new Map<string, SessionFileChange>();

  for (const entry of entries) {
    if (entry.type !== "message") {
      continue;
    }

    const msg = entry.message;
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type !== "toolCall") {
          continue;
        }

        const name = block.name as FileToolName;
        if (name !== "write" && name !== "edit") {
          continue;
        }

        const filePath = block.arguments?.path;
        if (typeof filePath === "string") {
          toolCalls.set(block.id, { path: filePath, name });
        }
      }
      continue;
    }

    if (msg.role !== "toolResult") {
      continue;
    }

    const toolCall = toolCalls.get(msg.toolCallId);
    if (!toolCall) {
      continue;
    }

    const resolvedPath = path.isAbsolute(toolCall.path)
      ? toolCall.path
      : path.resolve(cwd, toolCall.path);
    const canonical = toCanonicalPath(resolvedPath);
    if (!canonical) {
      continue;
    }

    const existing = fileChanges.get(canonical.canonicalPath);
    if (existing) {
      existing.operations.add(toolCall.name);
      existing.lastTimestamp = Math.max(existing.lastTimestamp, msg.timestamp);
      continue;
    }

    fileChanges.set(canonical.canonicalPath, {
      operations: new Set([toolCall.name]),
      lastTimestamp: msg.timestamp,
    });
  }

  return fileChanges;
};
