import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { estimateTokens } from "./metrics.ts";

/**
 * Normalizes a read-style path relative to the active working directory.
 *
 * Skill discovery and read-tool observation should resolve paths the same way
 * Pi users expect, including `@` and `~` prefixes.
 */
export function normalizeReadPath(inputPath: string, cwd: string): string {
  // Similar to pi's resolveToCwd/resolveReadPath, but simplified.
  let p = inputPath;
  if (p.startsWith("@")) p = p.slice(1);
  if (p === "~") p = os.homedir();
  else if (p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
  if (!path.isAbsolute(p)) p = path.resolve(cwd, p);
  return path.resolve(p);
}

/**
 * Resolves the effective Pi agent directory.
 *
 * Context files can come from user-scoped agent state, so `/window` mirrors
 * Pi's environment-based directory lookup before falling back to `~/.pi/agent`.
 */
export function getAgentDir(): string {
  // Mirrors pi's behavior reasonably well.
  const envCandidates = ["PI_CODING_AGENT_DIR", "TAU_CODING_AGENT_DIR"];
  let envDir: string | undefined;
  for (const k of envCandidates) {
    if (process.env[k]) {
      envDir = process.env[k];
      break;
    }
  }
  if (!envDir) {
    for (const [k, v] of Object.entries(process.env)) {
      if (k.endsWith("_CODING_AGENT_DIR") && v) {
        envDir = v;
        break;
      }
    }
  }

  if (envDir) {
    if (envDir === "~") return os.homedir();
    if (envDir.startsWith("~/"))
      return path.join(os.homedir(), envDir.slice(2));
    return envDir;
  }
  return path.join(os.homedir(), ".pi", "agent");
}

/**
 * Reads a UTF-8 file if it is present and accessible.
 *
 * Context-file discovery is best-effort. Missing or unreadable files should be
 * ignored rather than surfacing as command failures.
 */
export async function readFileIfExists(
  filePath: string,
): Promise<{ path: string; content: string; bytes: number } | null> {
  try {
    const buf = await fs.readFile(filePath);
    return {
      path: filePath,
      content: buf.toString("utf8"),
      bytes: buf.byteLength,
    };
  } catch {
    return null;
  }
}

/**
 * Collects AGENTS/CLAUDE files that would affect the current session context.
 *
 * The command shows both where this context comes from and an approximate token
 * contribution for each file, following Pi's root-to-cwd traversal order.
 */
export async function loadProjectContextFiles(
  cwd: string,
): Promise<Array<{ path: string; tokens: number; bytes: number }>> {
  const out: Array<{ path: string; tokens: number; bytes: number }> = [];
  const seen = new Set<string>();

  const loadFromDir = async (dir: string) => {
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const p = path.join(dir, name);
      const f = await readFileIfExists(p);
      if (f && !seen.has(f.path)) {
        seen.add(f.path);
        out.push({
          path: f.path,
          tokens: estimateTokens(f.content),
          bytes: f.bytes,
        });
        // pi loads at most one of those per dir
        return;
      }
    }
  };

  await loadFromDir(getAgentDir());

  // Ancestors: root → cwd (same order as pi)
  const stack: string[] = [];
  let current = path.resolve(cwd);
  while (true) {
    stack.push(current);
    const parent = path.resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  stack.reverse();
  for (const dir of stack) await loadFromDir(dir);

  return out;
}

/**
 * Shortens an absolute path for display relative to the current cwd.
 *
 * `/window` needs readable output in narrow terminal layouts, so local paths
 * are compacted while preserving absolute paths outside the project tree.
 */
export function shortenPath(p: string, cwd: string): string {
  const rp = path.resolve(p);
  const rc = path.resolve(cwd);
  if (rp === rc) return ".";
  if (rp.startsWith(rc + path.sep)) return `./${rp.slice(rc.length + 1)}`;
  return rp;
}

/**
 * Formats an extension source path into a human-meaningful label.
 *
 * Directory entrypoints such as `foo/index.ts` should render as `foo/` so the
 * extension list remains informative after auto-discovery.
 */
export function formatExtensionSourceLabel(p: string): string {
  if (p === "<unknown>") return p;
  const base = path.basename(p);
  if (base === "index.ts" || base === "index.js") {
    return `${path.basename(path.dirname(p))}/`;
  }
  return base;
}
