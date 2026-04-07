import path from "node:path";
import {
  isReadToolResult,
  type CustomEntry,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolResultEvent,
} from "@mariozechner/pi-coding-agent";
import { normalizeReadPath } from "./files.ts";

/**
 * Path metadata used to map read tool activity back to a discovered skill.
 *
 * Skill observation works from resolved file paths rather than slash-command
 * names, so the tracker keeps both the skill file and its containing directory.
 */
export type SkillIndexEntry = {
  name: string;
  skillFilePath: string;
  skillDir: string;
};

/**
 * Persisted payload stored when `/window` observes a skill file read.
 *
 * The extension only needs enough data to restore the observed skill name and
 * retain the resolved path for debugging or future migrations.
 */
export type SkillReadEntryData = {
  name: string;
  path: string;
};

/**
 * Session entry key used to persist skill reads observed by `/window`.
 *
 * The extension keeps this separate from LLM-visible messages so observation
 * state survives reloads and resumes without polluting model context.
 */
export const SKILL_READ_ENTRY = "window:skill_read";
const LEGACY_SKILL_READ_ENTRY = "context:skill_read";

/**
 * Removes Pi's `skill:` slash-command prefix from a skill name.
 *
 * The view renders human-facing skill labels, so it normalizes command names to
 * the underlying skill identifier before display or matching.
 */
export function normalizeSkillName(name: string): string {
  return name.startsWith("skill:") ? name.slice("skill:".length) : name;
}

/**
 * Builds a path-based index of currently discoverable skills.
 *
 * Read-tool observation only records file paths, so the extension needs a fast
 * way to map those paths back to the best matching skill.
 */
export function buildSkillIndex(
  pi: ExtensionAPI,
  cwd: string,
): SkillIndexEntry[] {
  return pi
    .getCommands()
    .filter((c) => c.source === "skill")
    .map((c) => {
      const p = c.sourceInfo?.path
        ? normalizeReadPath(c.sourceInfo.path, cwd)
        : "";
      return {
        name: normalizeSkillName(c.name),
        skillFilePath: p,
        skillDir: p ? path.dirname(p) : "",
      };
    })
    .filter((x) => x.name && x.skillDir);
}

/**
 * Reconstructs skill-read state from persisted custom session entries.
 *
 * The tracker reads both the current and legacy entry names so old sessions
 * keep their observed-skill state after the rename from `context` to `window`.
 */
export function getSkillsObservedViaReadFromSession(
  ctx: ExtensionContext,
): Set<string> {
  const out = new Set<string>();
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom") continue;

    const customEntry = entry as CustomEntry<unknown>;
    if (
      customEntry.customType !== SKILL_READ_ENTRY &&
      customEntry.customType !== LEGACY_SKILL_READ_ENTRY
    ) {
      continue;
    }

    const data = customEntry.data;
    if (
      data &&
      typeof data === "object" &&
      typeof (data as SkillReadEntryData).name === "string"
    ) {
      out.add((data as SkillReadEntryData).name);
    }
  }
  return out;
}

/**
 * Creates the runtime state used to observe skill reads during a session.
 *
 * `/window` does not get a canonical “skill loaded” event from Pi, so it keeps
 * a best-effort cache keyed by session and updates it from successful `read`
 * tool results.
 */
export function createSkillReadTracker(pi: ExtensionAPI) {
  let lastSessionId: string | null = null;
  let cachedSkillsObservedViaRead = new Set<string>();
  let cachedSkillIndex: SkillIndexEntry[] = [];

  const ensureCaches = (ctx: ExtensionContext) => {
    const sid = ctx.sessionManager.getSessionId();
    if (sid !== lastSessionId) {
      lastSessionId = sid;
      cachedSkillsObservedViaRead = getSkillsObservedViaReadFromSession(ctx);
      cachedSkillIndex = buildSkillIndex(pi, ctx.cwd);
    }
    if (cachedSkillIndex.length === 0) {
      cachedSkillIndex = buildSkillIndex(pi, ctx.cwd);
    }
  };

  const refreshSkillIndex = (cwd: string) => {
    cachedSkillIndex = buildSkillIndex(pi, cwd);
  };

  const matchSkillForPath = (absPath: string): string | null => {
    let best: SkillIndexEntry | null = null;
    for (const s of cachedSkillIndex) {
      if (!s.skillDir) continue;
      if (
        absPath === s.skillFilePath ||
        absPath.startsWith(s.skillDir + path.sep)
      ) {
        if (!best || s.skillDir.length > best.skillDir.length) best = s;
      }
    }
    return best?.name ?? null;
  };

  const onToolResult = (event: ToolResultEvent, ctx: ExtensionContext) => {
    if (!isReadToolResult(event) || event.isError) return;

    const p = typeof event.input.path === "string" ? event.input.path : "";
    if (!p) return;

    ensureCaches(ctx);
    const abs = normalizeReadPath(p, ctx.cwd);
    const skillName = matchSkillForPath(abs);
    if (!skillName) return;

    if (!cachedSkillsObservedViaRead.has(skillName)) {
      cachedSkillsObservedViaRead.add(skillName);
      pi.appendEntry<SkillReadEntryData>(SKILL_READ_ENTRY, {
        name: skillName,
        path: abs,
      });
    }
  };

  return {
    refreshSkillIndex,
    getSkillsObservedViaReadFromSession,
    onToolResult,
  };
}
