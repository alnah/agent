/**
 * Path normalization and canonicalization helpers for this extension.
 *
 * These helpers are intentionally small and side-effect free except for the
 * filesystem lookups needed to resolve real paths.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

const safeStat = (targetPath: string) => {
  try {
    return statSync(targetPath);
  } catch {
    return null;
  }
};

const safeRealpath = (targetPath: string): string | null => {
  try {
    return realpathSync(targetPath);
  } catch {
    return null;
  }
};

/**
 * Returns true when `targetPath` is the same as `basePath` or nested inside it.
 */
export const isPathInside = (basePath: string, targetPath: string): boolean => {
  const relativePath = path.relative(basePath, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
};

/**
 * Formats an absolute path for UI display, preferring a cwd-relative path.
 */
export const formatDisplayPath = (
  absolutePath: string,
  cwd: string,
): string => {
  const normalizedCwd = path.resolve(cwd);
  if (absolutePath.startsWith(normalizedCwd + path.sep)) {
    return path.relative(normalizedCwd, absolutePath);
  }

  return absolutePath;
};

/**
 * Resolves an existing path to its canonical on-disk location.
 *
 * Returns `null` when the path does not exist or cannot be resolved safely.
 */
export const toCanonicalPath = (
  inputPath: string,
): { canonicalPath: string; isDirectory: boolean } | null => {
  const resolvedPath = path.resolve(inputPath);
  if (!existsSync(resolvedPath)) {
    return null;
  }

  const canonicalPath = safeRealpath(resolvedPath);
  if (!canonicalPath) {
    return null;
  }

  const stats = safeStat(canonicalPath);
  if (!stats) {
    return null;
  }

  return {
    canonicalPath,
    isDirectory: stats.isDirectory(),
  };
};

/**
 * Resolves a path even when the target is currently missing.
 *
 * Existing files are canonicalized through `realpath()`. Missing files fall
 * back to their normalized absolute path so callers can still reason about the
 * intended target consistently.
 */
export const toCanonicalPathMaybeMissing = (
  inputPath: string,
): { canonicalPath: string; isDirectory: boolean; exists: boolean } | null => {
  const resolvedPath = path.resolve(inputPath);
  if (!existsSync(resolvedPath)) {
    return {
      canonicalPath: path.normalize(resolvedPath),
      isDirectory: false,
      exists: false,
    };
  }

  const canonicalPath = safeRealpath(resolvedPath);
  if (!canonicalPath) {
    return {
      canonicalPath: path.normalize(resolvedPath),
      isDirectory: false,
      exists: true,
    };
  }

  const stats = safeStat(canonicalPath);
  if (!stats) {
    return {
      canonicalPath,
      isDirectory: false,
      exists: true,
    };
  }

  return {
    canonicalPath,
    isDirectory: stats.isDirectory(),
    exists: true,
  };
};
