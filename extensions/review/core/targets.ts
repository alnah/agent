/**
 * Review targets and labels.
 *
 * Defines the supported review scopes and the short user-facing hint shown
 * when a review starts.
 */

/**
 * Supported review scopes.
 *
 * Branch and PR reviews are diff-based, folder reviews read files directly,
 * and uncommitted reviews inspect local staged, unstaged, and untracked work.
 */
export type ReviewTarget =
  | { type: "uncommitted" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string }
  | { type: "pullRequest"; prNumber: number; baseBranch: string; title: string }
  | { type: "folder"; paths: string[] };

/**
 * Builds the short hint used in review-start notifications.
 */
export function getUserFacingHint(target: ReviewTarget): string {
  switch (target.type) {
    case "uncommitted":
      return "current changes";
    case "baseBranch":
      return `changes against '${target.branch}'`;
    case "commit": {
      const shortSha = target.sha.slice(0, 7);
      return target.title
        ? `commit ${shortSha}: ${target.title}`
        : `commit ${shortSha}`;
    }
    case "pullRequest": {
      const shortTitle =
        target.title.length > 30
          ? `${target.title.slice(0, 27)}...`
          : target.title;
      return `PR #${target.prNumber}: ${shortTitle}`;
    }
    case "folder": {
      const joined = target.paths.join(", ");
      return joined.length > 40
        ? `folders: ${joined.slice(0, 37)}...`
        : `folders: ${joined}`;
    }
  }
}

/**
 * Returns whether loop fixing can run against the given target.
 *
 * Commit reviews stay incompatible because loop fixing relies on returning to a
 * mutable branch and re-reviewing updated local changes.
 */
export function isLoopCompatibleTarget(target: ReviewTarget): boolean {
  return target.type !== "commit";
}
