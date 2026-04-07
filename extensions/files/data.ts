/**
 * File picker data assembly for this extension.
 *
 * This module merges repository state, session references, and session file
 * changes into the single ordered list consumed by the UI.
 */

import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { FileEntry, GitStatusEntry } from "./models.ts";
import {
  toCanonicalPath as baseToCanonicalPath,
  toCanonicalPathMaybeMissing as baseToCanonicalPathMaybeMissing,
  formatDisplayPath,
  isPathInside,
} from "./paths.ts";
import { createExecCommand, type ExecCommand } from "./runtime.ts";
import {
  collectRecentFileReferences,
  collectSessionFileChanges,
} from "./session.ts";

const splitNullSeparated = (value: string): string[] =>
  value.split("\0").filter(Boolean);

type CanonicalPath = { canonicalPath: string; isDirectory: boolean };
type CanonicalPathMaybeMissing = CanonicalPath & { exists: boolean };

export type PathResolver = {
  toCanonicalPath: (inputPath: string) => CanonicalPath | null;
  toCanonicalPathMaybeMissing: (
    inputPath: string,
  ) => CanonicalPathMaybeMissing | null;
};

export type BuildFileEntriesDeps = {
  execCommand: ExecCommand;
  createPathResolver: () => PathResolver;
  collectRecentFileReferences: typeof collectRecentFileReferences;
  collectSessionFileChanges: typeof collectSessionFileChanges;
};

/**
 * Result of building the file picker model for the current session.
 */
export type BuildFileEntriesResult = {
  files: FileEntry[];
  gitRoot: string | null;
};

/**
 * Creates a per-build resolver that memoizes canonical path lookups.
 */
export const createPathResolver = (): PathResolver => {
  const canonicalPathCache = new Map<string, CanonicalPath | null>();
  const maybeMissingCache = new Map<string, CanonicalPathMaybeMissing | null>();

  return {
    toCanonicalPath(inputPath: string) {
      const resolvedPath = path.resolve(inputPath);
      if (canonicalPathCache.has(resolvedPath)) {
        return canonicalPathCache.get(resolvedPath) ?? null;
      }

      const result = baseToCanonicalPath(resolvedPath);
      canonicalPathCache.set(resolvedPath, result);
      return result;
    },
    toCanonicalPathMaybeMissing(inputPath: string) {
      const resolvedPath = path.resolve(inputPath);
      if (maybeMissingCache.has(resolvedPath)) {
        return maybeMissingCache.get(resolvedPath) ?? null;
      }

      const result = baseToCanonicalPathMaybeMissing(resolvedPath);
      maybeMissingCache.set(resolvedPath, result);
      return result;
    },
  };
};

const getGitRoot = async (
  cwd: string,
  deps: Pick<BuildFileEntriesDeps, "execCommand">,
): Promise<string | null> => {
  const result = await deps.execCommand(
    "git",
    ["rev-parse", "--show-toplevel"],
    {
      cwd,
    },
  );
  if (result.code !== 0) {
    return null;
  }

  const root = result.stdout.trim();
  return root ? root : null;
};

const getGitStatusMap = (
  stdout: string,
  cwd: string,
  pathResolver: PathResolver,
): Map<string, GitStatusEntry> => {
  const statusMap = new Map<string, GitStatusEntry>();
  const entries = splitNullSeparated(stdout);

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry || entry.length < 4) {
      continue;
    }

    const status = entry.slice(0, 2);
    const statusLabel = status.replace(/\s/g, "") || status.trim();
    let filePath = entry.slice(3);
    if ((status.startsWith("R") || status.startsWith("C")) && entries[i + 1]) {
      filePath = entries[i + 1];
      i += 1;
    }
    if (!filePath) {
      continue;
    }

    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(cwd, filePath);
    const canonical = pathResolver.toCanonicalPathMaybeMissing(resolvedPath);
    if (!canonical) {
      continue;
    }

    statusMap.set(canonical.canonicalPath, {
      status: statusLabel,
      exists: canonical.exists,
      isDirectory: canonical.isDirectory,
    });
  }

  return statusMap;
};

const getGitFiles = (
  stdout: string,
  gitRoot: string,
  pathResolver: PathResolver,
): { trackedSet: Set<string>; files: Array<CanonicalPath> } => {
  const trackedSet = new Set<string>();
  const files: Array<CanonicalPath> = [];

  for (const entry of splitNullSeparated(stdout)) {
    if (entry.length < 3) {
      continue;
    }

    const marker = entry[0];
    const relativePath = entry.slice(2);
    if (!relativePath) {
      continue;
    }

    const canonical = pathResolver.toCanonicalPath(
      path.resolve(gitRoot, relativePath),
    );
    if (!canonical) {
      continue;
    }

    files.push(canonical);
    if (marker !== "?") {
      trackedSet.add(canonical.canonicalPath);
    }
  }

  return { trackedSet, files };
};

const getGitSnapshot = async (
  gitRoot: string,
  pathResolver: PathResolver,
  deps: Pick<BuildFileEntriesDeps, "execCommand">,
): Promise<{
  statusMap: Map<string, GitStatusEntry>;
  trackedSet: Set<string>;
  gitFiles: Array<CanonicalPath>;
}> => {
  const [statusResult, filesResult] = await Promise.all([
    deps.execCommand("git", ["status", "--porcelain=1", "-z"], {
      cwd: gitRoot,
    }),
    deps.execCommand(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "-t"],
      { cwd: gitRoot },
    ),
  ]);

  const statusMap =
    statusResult.code === 0 && statusResult.stdout
      ? getGitStatusMap(statusResult.stdout, gitRoot, pathResolver)
      : new Map<string, GitStatusEntry>();
  const gitListing =
    filesResult.code === 0 && filesResult.stdout
      ? getGitFiles(filesResult.stdout, gitRoot, pathResolver)
      : { trackedSet: new Set<string>(), files: [] as Array<CanonicalPath> };

  return {
    statusMap,
    trackedSet: gitListing.trackedSet,
    gitFiles: gitListing.files,
  };
};

const upsertFileEntry = (
  fileMap: Map<string, FileEntry>,
  cwd: string,
  data: Partial<FileEntry> & { canonicalPath: string; isDirectory: boolean },
): void => {
  const existing = fileMap.get(data.canonicalPath);
  const displayPath =
    data.displayPath ?? formatDisplayPath(data.canonicalPath, cwd);

  if (existing) {
    fileMap.set(data.canonicalPath, {
      ...existing,
      ...data,
      displayPath,
      exists: data.exists ?? existing.exists,
      isDirectory: data.isDirectory ?? existing.isDirectory,
      isReferenced: existing.isReferenced || data.isReferenced === true,
      inRepo: existing.inRepo || data.inRepo === true,
      isTracked: existing.isTracked || data.isTracked === true,
      hasSessionChange:
        existing.hasSessionChange || data.hasSessionChange === true,
      lastTimestamp: Math.max(existing.lastTimestamp, data.lastTimestamp ?? 0),
    });
    return;
  }

  fileMap.set(data.canonicalPath, {
    canonicalPath: data.canonicalPath,
    resolvedPath: data.resolvedPath ?? data.canonicalPath,
    displayPath,
    exists: data.exists ?? true,
    isDirectory: data.isDirectory,
    status: data.status,
    inRepo: data.inRepo ?? false,
    isTracked: data.isTracked ?? false,
    isReferenced: data.isReferenced ?? false,
    hasSessionChange: data.hasSessionChange ?? false,
    lastTimestamp: data.lastTimestamp ?? 0,
  });
};

const isInRepo = (gitRoot: string | null, targetPath: string): boolean =>
  gitRoot !== null && isPathInside(gitRoot, targetPath);

const createBuildFileEntriesDeps = (
  pi: ExtensionAPI,
  overrides: Partial<BuildFileEntriesDeps>,
): BuildFileEntriesDeps => ({
  execCommand: overrides.execCommand ?? createExecCommand(pi),
  createPathResolver: overrides.createPathResolver ?? createPathResolver,
  collectRecentFileReferences:
    overrides.collectRecentFileReferences ?? collectRecentFileReferences,
  collectSessionFileChanges:
    overrides.collectSessionFileChanges ?? collectSessionFileChanges,
});

/**
 * Builds the full file list shown by the picker for the current branch.
 *
 * The result is intentionally UI-ready: each entry already contains merged git
 * status, session metadata, and stable sorting information.
 */
export const buildFileEntries = async (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  overrides: Partial<BuildFileEntriesDeps> = {},
): Promise<BuildFileEntriesResult> => {
  const deps = createBuildFileEntriesDeps(pi, overrides);
  const entries = ctx.sessionManager.getBranch();
  const references = deps
    .collectRecentFileReferences(entries, ctx.cwd, 200)
    .filter((ref) => ref.exists);
  const fileChanges = deps.collectSessionFileChanges(entries, ctx.cwd);
  const gitRoot = await getGitRoot(ctx.cwd, deps);
  const pathResolver = deps.createPathResolver();

  const { statusMap, trackedSet, gitFiles } = gitRoot
    ? await getGitSnapshot(gitRoot, pathResolver, deps)
    : {
        statusMap: new Map<string, GitStatusEntry>(),
        trackedSet: new Set<string>(),
        gitFiles: [] as Array<CanonicalPath>,
      };

  const fileMap = new Map<string, FileEntry>();
  for (const file of gitFiles) {
    upsertFileEntry(fileMap, ctx.cwd, {
      canonicalPath: file.canonicalPath,
      resolvedPath: file.canonicalPath,
      isDirectory: file.isDirectory,
      exists: true,
      status: statusMap.get(file.canonicalPath)?.status,
      inRepo: isInRepo(gitRoot, file.canonicalPath),
      isTracked: trackedSet.has(file.canonicalPath),
    });
  }

  for (const [canonicalPath, statusEntry] of statusMap.entries()) {
    if (fileMap.has(canonicalPath)) {
      continue;
    }

    upsertFileEntry(fileMap, ctx.cwd, {
      canonicalPath,
      resolvedPath: canonicalPath,
      isDirectory: statusEntry.isDirectory,
      exists: statusEntry.exists,
      status: statusEntry.status,
      inRepo: isInRepo(gitRoot, canonicalPath),
      isTracked: trackedSet.has(canonicalPath) || statusEntry.status !== "??",
    });
  }

  for (const ref of references) {
    upsertFileEntry(fileMap, ctx.cwd, {
      canonicalPath: ref.path,
      resolvedPath: ref.path,
      isDirectory: ref.isDirectory,
      exists: true,
      status: statusMap.get(ref.path)?.status,
      inRepo: isInRepo(gitRoot, ref.path),
      isTracked: trackedSet.has(ref.path),
      isReferenced: true,
    });
  }

  for (const [canonicalPath, change] of fileChanges.entries()) {
    const canonical = pathResolver.toCanonicalPath(canonicalPath);
    if (!canonical) {
      continue;
    }

    upsertFileEntry(fileMap, ctx.cwd, {
      canonicalPath: canonical.canonicalPath,
      resolvedPath: canonical.canonicalPath,
      isDirectory: canonical.isDirectory,
      exists: true,
      status: statusMap.get(canonical.canonicalPath)?.status,
      inRepo: isInRepo(gitRoot, canonical.canonicalPath),
      isTracked: trackedSet.has(canonical.canonicalPath),
      hasSessionChange: true,
      lastTimestamp: change.lastTimestamp,
    });
  }

  const files = Array.from(fileMap.values()).sort((a, b) => {
    const aDirty = Boolean(a.status);
    const bDirty = Boolean(b.status);
    if (aDirty !== bDirty) {
      return aDirty ? -1 : 1;
    }
    if (a.inRepo !== b.inRepo) {
      return a.inRepo ? -1 : 1;
    }
    if (a.hasSessionChange !== b.hasSessionChange) {
      return a.hasSessionChange ? -1 : 1;
    }
    if (a.lastTimestamp !== b.lastTimestamp) {
      return b.lastTimestamp - a.lastTimestamp;
    }
    if (a.isReferenced !== b.isReferenced) {
      return a.isReferenced ? -1 : 1;
    }
    return a.displayPath.localeCompare(b.displayPath);
  });

  return { files, gitRoot };
};
