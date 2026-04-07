/**
 * Review git and GitHub helpers.
 *
 * Wraps repository queries used by the selector and direct review commands.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Resolves the merge base between `HEAD` and a branch.
 *
 * Prefers the branch upstream when available, then falls back to the branch
 * name directly. Returns `null` when neither lookup succeeds.
 */
export async function getMergeBase(
  pi: ExtensionAPI,
  branch: string,
): Promise<string | null> {
  try {
    const { stdout: upstream, code: upstreamCode } = await pi.exec("git", [
      "rev-parse",
      "--abbrev-ref",
      `${branch}@{upstream}`,
    ]);

    if (upstreamCode === 0 && upstream.trim()) {
      const { stdout: mergeBase, code } = await pi.exec("git", [
        "merge-base",
        "HEAD",
        upstream.trim(),
      ]);
      if (code === 0 && mergeBase.trim()) {
        return mergeBase.trim();
      }
    }

    const { stdout: mergeBase, code } = await pi.exec("git", [
      "merge-base",
      "HEAD",
      branch,
    ]);
    if (code === 0 && mergeBase.trim()) {
      return mergeBase.trim();
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Lists local branches as short ref names.
 */
export async function getLocalBranches(pi: ExtensionAPI): Promise<string[]> {
  const { stdout, code } = await pi.exec("git", [
    "branch",
    "--format=%(refname:short)",
  ]);
  if (code !== 0) return [];
  return stdout
    .trim()
    .split("\n")
    .filter((branch) => branch.trim());
}

/**
 * Lists recent commits for the commit selector.
 */
export async function getRecentCommits(
  pi: ExtensionAPI,
  limit = 10,
): Promise<Array<{ sha: string; title: string }>> {
  const { stdout, code } = await pi.exec("git", [
    "log",
    "--oneline",
    "-n",
    `${limit}`,
  ]);
  if (code !== 0) return [];

  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [sha, ...rest] = line.trim().split(" ");
      return { sha, title: rest.join(" ") };
    });
}

/**
 * Returns whether any staged, unstaged, or untracked changes exist.
 */
export async function hasUncommittedChanges(
  pi: ExtensionAPI,
): Promise<boolean> {
  const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
  return code === 0 && stdout.trim().length > 0;
}

/**
 * Returns whether tracked-file changes would block branch switching.
 *
 * Untracked files are ignored because they do not prevent checking out a PR.
 */
export async function hasPendingChanges(pi: ExtensionAPI): Promise<boolean> {
  const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
  if (code !== 0) return false;

  const lines = stdout
    .trim()
    .split("\n")
    .filter((line) => line.trim());
  const trackedChanges = lines.filter((line) => !line.startsWith("??"));
  return trackedChanges.length > 0;
}

/**
 * Parses a PR number or GitHub PR URL into a numeric PR id.
 */
export function parsePrReference(ref: string): number | null {
  const trimmed = ref.trim();

  const num = parseInt(trimmed, 10);
  if (!Number.isNaN(num) && num > 0) {
    return num;
  }

  const urlMatch = trimmed.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  if (urlMatch) {
    return parseInt(urlMatch[1], 10);
  }

  return null;
}

/**
 * Reads pull request metadata from GitHub CLI.
 *
 * Returns `null` when `gh` cannot resolve the PR or when its JSON output is
 * malformed.
 */
export async function getPrInfo(
  pi: ExtensionAPI,
  prNumber: number,
): Promise<{ baseBranch: string; title: string; headBranch: string } | null> {
  const { stdout, code } = await pi.exec("gh", [
    "pr",
    "view",
    String(prNumber),
    "--json",
    "baseRefName,title,headRefName",
  ]);

  if (code !== 0) return null;

  try {
    const data = JSON.parse(stdout);
    return {
      baseBranch: data.baseRefName,
      title: data.title,
      headBranch: data.headRefName,
    };
  } catch {
    return null;
  }
}

/**
 * Checks out a pull request locally with GitHub CLI.
 */
export async function checkoutPr(
  pi: ExtensionAPI,
  prNumber: number,
): Promise<{ success: boolean; error?: string }> {
  const { stdout, stderr, code } = await pi.exec("gh", [
    "pr",
    "checkout",
    String(prNumber),
  ]);

  if (code !== 0) {
    return {
      success: false,
      error: stderr || stdout || "Failed to checkout PR",
    };
  }

  return { success: true };
}

/**
 * Returns the current branch name, or `null` outside a normal branch state.
 */
export async function getCurrentBranch(
  pi: ExtensionAPI,
): Promise<string | null> {
  const { stdout, code } = await pi.exec("git", ["branch", "--show-current"]);
  if (code === 0 && stdout.trim()) {
    return stdout.trim();
  }
  return null;
}

/**
 * Returns the repository default branch.
 *
 * Prefers `origin/HEAD`, then falls back to `main`, `master`, and finally
 * `main` when no stronger signal exists.
 */
export async function getDefaultBranch(pi: ExtensionAPI): Promise<string> {
  const { stdout, code } = await pi.exec("git", [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "--short",
  ]);
  if (code === 0 && stdout.trim()) {
    return stdout.trim().replace("origin/", "");
  }

  const branches = await getLocalBranches(pi);
  if (branches.includes("main")) return "main";
  if (branches.includes("master")) return "master";

  return "main";
}
