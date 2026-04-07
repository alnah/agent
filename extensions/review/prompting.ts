/**
 * Review prompt builders.
 *
 * Combines the shared review rubric with target-specific prompts, optional
 * shared instructions, one-off user instructions, and project guidelines.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { getMergeBase } from "./git.ts";
import type { ReviewTarget } from "./targets.ts";

const UNCOMMITTED_PROMPT =
  "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.";

const LOCAL_CHANGES_REVIEW_INSTRUCTIONS =
  "Also include local working-tree changes (staged, unstaged, and untracked files) from this branch. Use `git status --porcelain`, `git diff`, `git diff --staged`, and `git ls-files --others --exclude-standard` so local fixes are part of this review cycle.";

const BASE_BRANCH_PROMPT_WITH_MERGE_BASE =
  "Review the code changes against the base branch '{baseBranch}'. The merge base commit for this comparison is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes relative to {baseBranch}. Provide prioritized, actionable findings.";

const BASE_BRANCH_PROMPT_FALLBACK =
  'Review the code changes against the base branch \'{branch}\'. Start by finding the merge diff between the current branch and {branch}\'s upstream e.g. (`git merge-base HEAD "$(git rev-parse --abbrev-ref "{branch}@{upstream}")"`), then run `git diff` against that SHA to see what changes we would merge into the {branch} branch. Provide prioritized, actionable findings.';

const COMMIT_PROMPT_WITH_TITLE =
  'Review the code changes introduced by commit {sha} ("{title}"). Provide prioritized, actionable findings.';

const COMMIT_PROMPT =
  "Review the code changes introduced by commit {sha}. Provide prioritized, actionable findings.";

const PULL_REQUEST_PROMPT =
  "Review pull request #{prNumber} (\"{title}\") against the base branch '{baseBranch}'. The merge base commit for this comparison is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes that would be merged. Provide prioritized, actionable findings.";

const PULL_REQUEST_PROMPT_FALLBACK =
  "Review pull request #{prNumber} (\"{title}\") against the base branch '{baseBranch}'. Start by finding the merge base between the current branch and {baseBranch} (e.g., `git merge-base HEAD {baseBranch}`), then run `git diff` against that SHA to see the changes that would be merged. Provide prioritized, actionable findings.";

const FOLDER_REVIEW_PROMPT =
  "Review the code in the following paths: {paths}. This is a snapshot review (not a diff). Read the files directly in these paths and provide prioritized, actionable findings.";

export const REVIEW_RUBRIC = `# Review Guidelines

You are acting as a code reviewer for a proposed code change made by another engineer.

Below are default guidelines for determining what to flag. These are not the final word — if you encounter more specific guidelines elsewhere (in a developer message, user message, file, or project review guidelines appended below), those override these general instructions.

## Determining what to flag

Flag issues that:
1. Meaningfully impact the accuracy, performance, security, or maintainability of the code.
2. Are discrete and actionable (not general issues or multiple combined issues).
3. Don't demand rigor inconsistent with the rest of the codebase.
4. Were introduced in the changes being reviewed (not pre-existing bugs).
5. The author would likely fix if aware of them.
6. Don't rely on unstated assumptions about the codebase or author's intent.
7. Have provable impact on other parts of the code — it is not enough to speculate that a change may disrupt another part, you must identify the parts that are provably affected.
8. Are clearly not intentional changes by the author.
9. Be particularly careful with untrusted user input and follow the specific guidelines to review.
10. Treat silent local error recovery (especially parsing/IO/network fallbacks) as high-signal review candidates unless there is explicit boundary-level justification.

## Untrusted User Input

1. Be careful with open redirects, they must always be checked to only go to trusted domains (?next_page=...)
2. Always flag SQL that is not parametrized
3. In systems with user supplied URL input, http fetches always need to be protected against access to local resources (intercept DNS resolver!)
4. Escape, don't sanitize if you have the option (eg: HTML escaping)

## Comment guidelines

1. Be clear about why the issue is a problem.
2. Communicate severity appropriately - don't exaggerate.
3. Be brief - at most 1 paragraph.
4. Keep code snippets under 3 lines, wrapped in inline code or code blocks.
5. Use \`\`\`suggestion blocks ONLY for concrete replacement code (minimal lines; no commentary inside the block). Preserve the exact leading whitespace of the replaced lines.
6. Explicitly state scenarios/environments where the issue arises.
7. Use a matter-of-fact tone - helpful AI assistant, not accusatory.
8. Write for quick comprehension without close reading.
9. Avoid excessive flattery or unhelpful phrases like "Great job...".

## Review priorities

1. Surface critical non-blocking human callouts (migrations, dependency churn, auth/permissions, compatibility, destructive operations) at the end.
2. Prefer simple, direct solutions over wrappers or abstractions without clear value.
3. Treat back pressure handling as critical to system stability.
4. Apply system-level thinking; flag changes that increase operational risk or on-call wakeups.
5. Ensure that errors are always checked against codes or stable identifiers, never error messages.

## Fail-fast error handling (strict)

When reviewing added or modified error handling, default to fail-fast behavior.

1. Evaluate every new or changed \`try/catch\`: identify what can fail and why local handling is correct at that exact layer.
2. Prefer propagation over local recovery. If the current scope cannot fully recover while preserving correctness, rethrow (optionally with context) instead of returning fallbacks.
3. Flag catch blocks that hide failure signals (e.g. returning \`null\`/\`[]\`/\`false\`, swallowing JSON parse failures, logging-and-continue, or “best effort” silent recovery).
4. JSON parsing/decoding should fail loudly by default. Quiet fallback parsing is only acceptable with an explicit compatibility requirement and clear tested behavior.
5. Boundary handlers (HTTP routes, CLI entrypoints, supervisors) may translate errors, but must not pretend success or silently degrade.
6. If a catch exists only to satisfy lint/style without real handling, treat it as a bug.
7. When uncertain, prefer crashing fast over silent degradation.

## Required human callouts (non-blocking, at the very end)

After findings/verdict, you MUST append this final section:

## Human Reviewer Callouts (Non-Blocking)

Include only applicable callouts (no yes/no lines):

- **This change adds a database migration:** <files/details>
- **This change introduces a new dependency:** <package(s)/details>
- **This change changes a dependency (or the lockfile):** <files/package(s)/details>
- **This change modifies auth/permission behavior:** <what changed and where>
- **This change introduces backwards-incompatible public schema/API/contract changes:** <what changed and where>
- **This change includes irreversible or destructive operations:** <operation and scope>

Rules for this section:
1. These are informational callouts for the human reviewer, not fix items.
2. Do not include them in Findings unless there is an independent defect.
3. These callouts alone must not change the verdict.
4. Only include callouts that apply to the reviewed change.
5. Keep each emitted callout bold exactly as written.
6. If none apply, write "- (none)".

## Priority levels

Tag each finding with a priority level in the title:
- [P0] - Drop everything to fix. Blocking release/operations. Only for universal issues that do not depend on assumptions about inputs.
- [P1] - Urgent. Should be addressed in the next cycle.
- [P2] - Normal. To be fixed eventually.
- [P3] - Low. Nice to have.

## Output format

Provide your findings in a clear, structured format:
1. List each finding with its priority tag, file location, and explanation.
2. Findings must reference locations that overlap with the actual diff — don't flag pre-existing code.
3. Keep line references as short as possible (avoid ranges over 5-10 lines; pick the most suitable subrange).
4. Provide an overall verdict: "correct" (no blocking issues) or "needs attention" (has blocking issues).
5. Ignore trivial style issues unless they obscure meaning or violate documented standards.
6. Do not generate a full PR fix — only flag issues and optionally provide short suggestion blocks.
7. End with the required "Human Reviewer Callouts (Non-Blocking)" section and all applicable bold callouts (no yes/no).

Output all findings the author would fix if they knew about them. If there are no qualifying findings, explicitly state the code looks good. Don't stop at the first finding - list every qualifying issue. Then append the required non-blocking callouts section.`;

/**
 * Looks for `REVIEW_GUIDELINES.md` next to the nearest `.pi` directory.
 *
 * Returns `null` when the repository has no project-specific review guidelines
 * or when the guideline file cannot be read.
 */
export async function loadProjectReviewGuidelines(
  cwd: string,
): Promise<string | null> {
  let currentDir = path.resolve(cwd);

  while (true) {
    const piDir = path.join(currentDir, ".pi");
    const guidelinesPath = path.join(currentDir, "REVIEW_GUIDELINES.md");

    const piStats = await fs.stat(piDir).catch(() => null);
    if (piStats?.isDirectory()) {
      const guidelineStats = await fs.stat(guidelinesPath).catch(() => null);
      if (guidelineStats?.isFile()) {
        try {
          const content = await fs.readFile(guidelinesPath, "utf8");
          const trimmed = content.trim();
          return trimmed ? trimmed : null;
        } catch {
          return null;
        }
      }
      return null;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

/**
 * Builds the target-specific review prompt.
 *
 * Branch and PR reviews prefer an exact merge base when available. Optional
 * local-change instructions are appended verbatim for loop-fixing mode.
 */
export async function buildReviewPrompt(
  pi: ExtensionAPI,
  target: ReviewTarget,
  options?: { includeLocalChanges?: boolean },
): Promise<string> {
  const includeLocalChanges = options?.includeLocalChanges === true;

  switch (target.type) {
    case "uncommitted":
      return UNCOMMITTED_PROMPT;

    case "baseBranch": {
      const mergeBase = await getMergeBase(pi, target.branch);
      const basePrompt = mergeBase
        ? BASE_BRANCH_PROMPT_WITH_MERGE_BASE.replace(
            /{baseBranch}/g,
            target.branch,
          ).replace(/{mergeBaseSha}/g, mergeBase)
        : BASE_BRANCH_PROMPT_FALLBACK.replace(/{branch}/g, target.branch);
      return includeLocalChanges
        ? `${basePrompt} ${LOCAL_CHANGES_REVIEW_INSTRUCTIONS}`
        : basePrompt;
    }

    case "commit":
      if (target.title) {
        return COMMIT_PROMPT_WITH_TITLE.replace("{sha}", target.sha).replace(
          "{title}",
          target.title,
        );
      }
      return COMMIT_PROMPT.replace("{sha}", target.sha);

    case "pullRequest": {
      const mergeBase = await getMergeBase(pi, target.baseBranch);
      const basePrompt = mergeBase
        ? PULL_REQUEST_PROMPT.replace(/{prNumber}/g, String(target.prNumber))
            .replace(/{title}/g, target.title)
            .replace(/{baseBranch}/g, target.baseBranch)
            .replace(/{mergeBaseSha}/g, mergeBase)
        : PULL_REQUEST_PROMPT_FALLBACK.replace(
            /{prNumber}/g,
            String(target.prNumber),
          )
            .replace(/{title}/g, target.title)
            .replace(/{baseBranch}/g, target.baseBranch);
      return includeLocalChanges
        ? `${basePrompt} ${LOCAL_CHANGES_REVIEW_INSTRUCTIONS}`
        : basePrompt;
    }

    case "folder":
      return FOLDER_REVIEW_PROMPT.replace("{paths}", target.paths.join(", "));
  }
}

/**
 * Builds the full prompt sent to the reviewing agent.
 *
 * Shared instructions, one-off extra instructions, and project guidelines are
 * appended only when present so the current prompt text stays unchanged.
 */
export async function buildFullReviewPrompt(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  target: ReviewTarget,
  options?: {
    includeLocalChanges?: boolean;
    sharedInstructions?: string;
    extraInstruction?: string;
  },
): Promise<string> {
  const prompt = await buildReviewPrompt(pi, target, {
    includeLocalChanges: options?.includeLocalChanges === true,
  });
  const projectGuidelines = await loadProjectReviewGuidelines(ctx.cwd);

  let fullPrompt = `${REVIEW_RUBRIC}\n\n---\n\nPlease perform a code review with the following focus:\n\n${prompt}`;

  if (options?.sharedInstructions?.trim()) {
    fullPrompt += `\n\nShared custom review instructions (applies to all reviews):\n\n${options.sharedInstructions.trim()}`;
  }

  if (options?.extraInstruction?.trim()) {
    fullPrompt += `\n\nAdditional user-provided review instruction:\n\n${options.extraInstruction.trim()}`;
  }

  if (projectGuidelines) {
    fullPrompt += `\n\nThis project has additional instructions for code reviews:\n\n${projectGuidelines}`;
  }

  return fullPrompt;
}

export const REVIEW_SUMMARY_PROMPT = `We are leaving a code-review branch and returning to the main coding branch.
Create a structured handoff that can be used immediately to implement fixes.

You MUST summarize the review that happened in this branch so findings can be acted on.
Do not omit findings: include every actionable issue that was identified.

Required sections (in order):

## Review Scope
- What was reviewed (files/paths, changes, and scope)

## Verdict
- "correct" or "needs attention"

## Findings
For EACH finding, include:
- Priority tag ([P0]..[P3]) and short title
- File location (\`path/to/file.ext:line\`)
- Why it matters (brief)
- What should change (brief, actionable)

## Fix Queue
1. Ordered implementation checklist (highest priority first)

## Constraints & Preferences
- Any constraints or preferences mentioned during review
- Or "(none)"

## Human Reviewer Callouts (Non-Blocking)
Include only applicable callouts (no yes/no lines):
- **This change adds a database migration:** <files/details>
- **This change introduces a new dependency:** <package(s)/details>
- **This change changes a dependency (or the lockfile):** <files/package(s)/details>
- **This change modifies auth/permission behavior:** <what changed and where>
- **This change introduces backwards-incompatible public schema/API/contract changes:** <what changed and where>
- **This change includes irreversible or destructive operations:** <operation and scope>

If none apply, write "- (none)".

These are informational callouts for humans and are not fix items by themselves.

Preserve exact file paths, function names, and error messages where available.`;

export const REVIEW_FIX_FINDINGS_PROMPT = `Use the latest review summary in this session and implement the review findings now.

Instructions:
1. Treat the summary's Findings/Fix Queue as a checklist.
2. Fix in priority order: P0, P1, then P2 (include P3 if quick and safe).
3. If a finding is invalid/already fixed/not possible right now, briefly explain why and continue.
4. Treat "Human Reviewer Callouts (Non-Blocking)" as informational only; do not convert them into fix tasks unless there is a separate explicit finding.
5. Follow fail-fast error handling: do not add local catch/fallback recovery unless this scope is an explicit boundary that can safely translate the failure.
6. If you add or keep a \`try/catch\`, explain the expected failure mode and either rethrow with context or return a boundary-safe error response.
7. JSON parsing/decoding should fail loudly by default; avoid silent fallback parsing.
8. Run relevant tests/checks for touched code where practical.
9. End with: fixed items, deferred/skipped items (with reasons), and verification results.`;
