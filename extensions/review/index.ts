/**
 * Code review extension.
 *
 * Registers `/review` and `/end-review`, supports review loop fixing, and keeps
 * the current review branch workflow unchanged while delegating parsing, git,
 * prompting, selector, and state details to dedicated modules.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";
import { parseArgs } from "./arguments.ts";
import { hasBlockingReviewFindings } from "./findings.ts";
import {
  checkoutPr,
  getPrInfo,
  hasPendingChanges,
  parsePrReference,
} from "./git.ts";
import {
  buildFullReviewPrompt,
  REVIEW_FIX_FINDINGS_PROMPT,
  REVIEW_SUMMARY_PROMPT,
} from "./prompting.ts";
import { showReviewSelector } from "./selector.ts";
import { getLastAssistantSnapshot, waitForLoopTurnToStart } from "./session.ts";
import {
  ANCHOR_TYPE,
  applyAllPersistedState,
  getCustomInstructions,
  getOriginId,
  getPersistedSessionState,
  isEndInProgress,
  isLoopFixingEnabled,
  isLoopInProgress,
  persistSettings,
  STATE_TYPE,
  setCustomInstructions,
  setEndInProgress,
  setLoopFixingEnabled,
  setLoopInProgress,
  setOriginId,
  setWidget,
} from "./state.ts";
import {
  getUserFacingHint,
  isLoopCompatibleTarget,
  type ReviewTarget,
} from "./targets.ts";

export { parseArgs } from "./arguments.ts";
export { hasBlockingReviewFindings } from "./findings.ts";
export {
  buildFullReviewPrompt,
  buildReviewPrompt,
  loadProjectReviewGuidelines,
  REVIEW_FIX_FINDINGS_PROMPT,
  REVIEW_RUBRIC,
  REVIEW_SUMMARY_PROMPT,
} from "./prompting.ts";
export { showReviewSelector } from "./selector.ts";
export { getLastAssistantSnapshot, waitForLoopTurnToStart } from "./session.ts";
export {
  getUserFacingHint,
  isLoopCompatibleTarget,
  type ReviewTarget,
} from "./targets.ts";

const REVIEW_LOOP_MAX_ITERATIONS = 10;

type EndReviewAction = "returnOnly" | "returnAndFix" | "returnAndSummarize";
type EndReviewActionResult = "ok" | "cancelled" | "error";
type EndReviewActionOptions = {
  showSummaryLoader?: boolean;
  notifySuccess?: boolean;
};

/**
 * Persists the loop-fixing setting after changing it.
 */
function setLoopFixingEnabledWithPersistence(
  pi: ExtensionAPI,
  enabled: boolean,
): void {
  setLoopFixingEnabled(enabled);
  persistSettings(pi);
}

/**
 * Persists shared custom review instructions after changing them.
 */
function setCustomInstructionsWithPersistence(
  pi: ExtensionAPI,
  instructions: string | undefined,
): void {
  setCustomInstructions(instructions);
  persistSettings(pi);
}

/**
 * Executes a review by optionally branching, building the prompt, and sending it.
 *
 * Fresh-session reviews persist an origin leaf so `/end-review` can navigate
 * back later without changing the current workflow.
 */
async function executeReview(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  target: ReviewTarget,
  useFreshSession: boolean,
  options?: { includeLocalChanges?: boolean; extraInstruction?: string },
): Promise<boolean> {
  if (getOriginId()) {
    ctx.ui.notify(
      "Already in a review. Use /end-review to finish first.",
      "warning",
    );
    return false;
  }

  if (useFreshSession) {
    let originId = ctx.sessionManager.getLeafId() ?? undefined;
    if (!originId) {
      pi.appendEntry(ANCHOR_TYPE, {
        createdAt: new Date().toISOString(),
      });
      originId = ctx.sessionManager.getLeafId() ?? undefined;
    }
    if (!originId) {
      ctx.ui.notify("Failed to determine review origin.", "error");
      return false;
    }
    setOriginId(originId);

    const lockedOriginId = originId;
    const entries = ctx.sessionManager.getEntries();
    const firstUserMessage = entries.find(
      (entry) => entry.type === "message" && entry.message.role === "user",
    );

    if (firstUserMessage) {
      try {
        const result = await ctx.navigateTree(firstUserMessage.id, {
          summarize: false,
          label: "code-review",
        });
        if (result.cancelled) {
          setOriginId(undefined);
          return false;
        }
      } catch (error) {
        setOriginId(undefined);
        ctx.ui.notify(
          `Failed to start review: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return false;
      }

      ctx.ui.setEditorText("");
    }

    setOriginId(lockedOriginId);
    setWidget(ctx, true);

    pi.appendEntry(STATE_TYPE, {
      active: true,
      originId: lockedOriginId,
    });
  }

  const fullPrompt = await buildFullReviewPrompt(pi, ctx, target, {
    includeLocalChanges: options?.includeLocalChanges === true,
    sharedInstructions: getCustomInstructions(),
    extraInstruction: options?.extraInstruction,
  });
  const hint = getUserFacingHint(target);
  const modeHint = useFreshSession ? " (fresh session)" : "";
  ctx.ui.notify(`Starting review: ${hint}${modeHint}`, "info");

  pi.sendUserMessage(fullPrompt);
  return true;
}

/**
 * Resolves a PR reference, checks it out locally, and returns a review target.
 */
async function handlePrCheckout(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  ref: string,
): Promise<ReviewTarget | null> {
  if (await hasPendingChanges(pi)) {
    ctx.ui.notify(
      "Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.",
      "error",
    );
    return null;
  }

  const prNumber = parsePrReference(ref);
  if (!prNumber) {
    ctx.ui.notify(
      "Invalid PR reference. Enter a number or GitHub PR URL.",
      "error",
    );
    return null;
  }

  ctx.ui.notify(`Fetching PR #${prNumber} info...`, "info");
  const prInfo = await getPrInfo(pi, prNumber);

  if (!prInfo) {
    ctx.ui.notify(
      `Could not find PR #${prNumber}. Make sure gh is authenticated and the PR exists.`,
      "error",
    );
    return null;
  }

  ctx.ui.notify(`Checking out PR #${prNumber}...`, "info");
  const checkoutResult = await checkoutPr(pi, prNumber);

  if (!checkoutResult.success) {
    ctx.ui.notify(`Failed to checkout PR: ${checkoutResult.error}`, "error");
    return null;
  }

  ctx.ui.notify(`Checked out PR #${prNumber} (${prInfo.headBranch})`, "info");

  return {
    type: "pullRequest",
    prNumber,
    baseBranch: prInfo.baseBranch,
    title: prInfo.title,
  };
}

/**
 * Returns the active review origin, restoring it from persisted branch state if needed.
 *
 * If persisted state claims a review is active but lacks an origin id, the
 * function clears that broken state and notifies the user.
 */
function getActiveReviewOrigin(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): string | undefined {
  const currentOriginId = getOriginId();
  if (currentOriginId) {
    return currentOriginId;
  }

  const state = getPersistedSessionState(ctx);
  if (state?.active && state.originId) {
    setOriginId(state.originId);
    return state.originId;
  }

  if (state?.active) {
    setWidget(ctx, false);
    pi.appendEntry(STATE_TYPE, { active: false });
    ctx.ui.notify(
      "Review state was missing origin info; cleared review status.",
      "warning",
    );
  }

  return undefined;
}

/**
 * Clears the active review branch state and widget.
 */
function clearReviewState(pi: ExtensionAPI, ctx: ExtensionContext): void {
  setWidget(ctx, false);
  setOriginId(undefined);
  pi.appendEntry(STATE_TYPE, { active: false });
}

/**
 * Navigates back to the origin while generating a structured review summary.
 *
 * When requested, the navigation is wrapped in a loader with the existing UI
 * text used by `/end-review` and loop fixing.
 */
async function navigateWithSummary(
  ctx: ExtensionCommandContext,
  originId: string,
  showLoader: boolean,
): Promise<{ cancelled: boolean; error?: string } | null> {
  if (showLoader && ctx.hasUI) {
    return ctx.ui.custom<{ cancelled: boolean; error?: string } | null>(
      (tui, theme, _kb, done) => {
        const loader = new BorderedLoader(
          tui,
          theme,
          "Returning and summarizing review branch...",
        );
        loader.onAbort = () => done(null);

        ctx
          .navigateTree(originId, {
            summarize: true,
            customInstructions: REVIEW_SUMMARY_PROMPT,
            replaceInstructions: true,
          })
          .then(done)
          .catch((error) =>
            done({
              cancelled: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );

        return loader;
      },
    );
  }

  try {
    return await ctx.navigateTree(originId, {
      summarize: true,
      customInstructions: REVIEW_SUMMARY_PROMPT,
      replaceInstructions: true,
    });
  } catch (error) {
    return {
      cancelled: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Finishes the active review using one of the existing `/end-review` actions.
 */
async function executeEndReviewAction(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  action: EndReviewAction,
  options: EndReviewActionOptions = {},
): Promise<EndReviewActionResult> {
  const originId = getActiveReviewOrigin(pi, ctx);
  if (!originId) {
    if (!getPersistedSessionState(ctx)?.active) {
      ctx.ui.notify(
        "Not in a review branch (use /review first, or review was started in current session mode)",
        "info",
      );
    }
    return "error";
  }

  const notifySuccess = options.notifySuccess ?? true;

  if (action === "returnOnly") {
    try {
      const result = await ctx.navigateTree(originId, { summarize: false });
      if (result.cancelled) {
        ctx.ui.notify(
          "Navigation cancelled. Use /end-review to try again.",
          "info",
        );
        return "cancelled";
      }
    } catch (error) {
      ctx.ui.notify(
        `Failed to return: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return "error";
    }

    clearReviewState(pi, ctx);
    if (notifySuccess) {
      ctx.ui.notify("Review complete! Returned to original position.", "info");
    }
    return "ok";
  }

  const summaryResult = await navigateWithSummary(
    ctx,
    originId,
    options.showSummaryLoader ?? false,
  );
  if (summaryResult === null) {
    ctx.ui.notify(
      "Summarization cancelled. Use /end-review to try again.",
      "info",
    );
    return "cancelled";
  }

  if (summaryResult.error) {
    ctx.ui.notify(`Summarization failed: ${summaryResult.error}`, "error");
    return "error";
  }

  if (summaryResult.cancelled) {
    ctx.ui.notify(
      "Navigation cancelled. Use /end-review to try again.",
      "info",
    );
    return "cancelled";
  }

  clearReviewState(pi, ctx);

  if (action === "returnAndSummarize") {
    if (!ctx.ui.getEditorText().trim()) {
      ctx.ui.setEditorText("Act on the review findings");
    }
    if (notifySuccess) {
      ctx.ui.notify("Review complete! Returned and summarized.", "info");
    }
    return "ok";
  }

  pi.sendUserMessage(REVIEW_FIX_FINDINGS_PROMPT, { deliverAs: "followUp" });
  if (notifySuccess) {
    ctx.ui.notify(
      "Review complete! Returned and queued a follow-up to fix findings.",
      "info",
    );
  }
  return "ok";
}

/**
 * Runs the existing loop-fixing review cycle until blocking findings disappear.
 *
 * Each pass reviews the branch, inspects the latest assistant output, then
 * either returns to fix findings or finishes by summarizing the review branch.
 */
async function runLoopFixingReview(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  target: ReviewTarget,
  extraInstruction?: string,
): Promise<void> {
  if (isLoopInProgress()) {
    ctx.ui.notify("Loop fixing review is already running.", "warning");
    return;
  }

  setLoopInProgress(true);
  setWidget(ctx, Boolean(getOriginId()));
  try {
    ctx.ui.notify(
      "Loop fixing enabled: using Empty branch mode and cycling until no blocking findings remain.",
      "info",
    );

    for (let pass = 1; pass <= REVIEW_LOOP_MAX_ITERATIONS; pass++) {
      const reviewBaselineAssistantId = getLastAssistantSnapshot(ctx)?.id;
      const started = await executeReview(pi, ctx, target, true, {
        includeLocalChanges: true,
        extraInstruction,
      });
      if (!started) {
        ctx.ui.notify(
          "Loop fixing stopped before starting the review pass.",
          "warning",
        );
        return;
      }

      const reviewTurnStarted = await waitForLoopTurnToStart(
        ctx,
        reviewBaselineAssistantId,
      );
      if (!reviewTurnStarted) {
        ctx.ui.notify(
          "Loop fixing stopped: review pass did not start in time.",
          "error",
        );
        return;
      }

      await ctx.waitForIdle();

      const reviewSnapshot = getLastAssistantSnapshot(ctx);
      if (!reviewSnapshot || reviewSnapshot.id === reviewBaselineAssistantId) {
        ctx.ui.notify(
          "Loop fixing stopped: could not read the review result.",
          "warning",
        );
        return;
      }

      if (reviewSnapshot.stopReason === "aborted") {
        ctx.ui.notify("Loop fixing stopped: review was aborted.", "warning");
        return;
      }

      if (reviewSnapshot.stopReason === "error") {
        ctx.ui.notify(
          "Loop fixing stopped: review failed with an error.",
          "error",
        );
        return;
      }

      if (reviewSnapshot.stopReason === "length") {
        ctx.ui.notify(
          "Loop fixing stopped: review output was truncated (stopReason=length).",
          "warning",
        );
        return;
      }

      if (!hasBlockingReviewFindings(reviewSnapshot.text)) {
        const finalized = await executeEndReviewAction(
          pi,
          ctx,
          "returnAndSummarize",
          {
            showSummaryLoader: true,
            notifySuccess: false,
          },
        );
        if (finalized !== "ok") {
          return;
        }

        ctx.ui.notify(
          "Loop fixing complete: no blocking findings remain.",
          "info",
        );
        return;
      }

      ctx.ui.notify(
        `Loop fixing pass ${pass}: found blocking findings, returning to fix them...`,
        "info",
      );

      const fixBaselineAssistantId = getLastAssistantSnapshot(ctx)?.id;
      const sentFixPrompt = await executeEndReviewAction(
        pi,
        ctx,
        "returnAndFix",
        {
          showSummaryLoader: true,
          notifySuccess: false,
        },
      );
      if (sentFixPrompt !== "ok") {
        return;
      }

      const fixTurnStarted = await waitForLoopTurnToStart(
        ctx,
        fixBaselineAssistantId,
      );
      if (!fixTurnStarted) {
        ctx.ui.notify(
          "Loop fixing stopped: fix pass did not start in time.",
          "error",
        );
        return;
      }

      await ctx.waitForIdle();

      const fixSnapshot = getLastAssistantSnapshot(ctx);
      if (!fixSnapshot || fixSnapshot.id === fixBaselineAssistantId) {
        ctx.ui.notify(
          "Loop fixing stopped: could not read the fix pass result.",
          "warning",
        );
        return;
      }
      if (fixSnapshot.stopReason === "aborted") {
        ctx.ui.notify("Loop fixing stopped: fix pass was aborted.", "warning");
        return;
      }
      if (fixSnapshot.stopReason === "error") {
        ctx.ui.notify(
          "Loop fixing stopped: fix pass failed with an error.",
          "error",
        );
        return;
      }
      if (fixSnapshot.stopReason === "length") {
        ctx.ui.notify(
          "Loop fixing stopped: fix pass output was truncated (stopReason=length).",
          "warning",
        );
        return;
      }
    }

    ctx.ui.notify(
      `Loop fixing stopped after ${REVIEW_LOOP_MAX_ITERATIONS} passes (safety limit reached).`,
      "warning",
    );
  } finally {
    setLoopInProgress(false);
    setWidget(ctx, Boolean(getOriginId()));
  }
}

/**
 * Runs the interactive `/end-review` flow.
 */
async function runEndReview(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("End-review requires interactive mode", "error");
    return;
  }

  if (isLoopInProgress()) {
    ctx.ui.notify(
      "Loop fixing review is running. Wait for it to finish.",
      "info",
    );
    return;
  }

  if (isEndInProgress()) {
    ctx.ui.notify("/end-review is already running", "info");
    return;
  }

  setEndInProgress(true);
  try {
    const choice = await ctx.ui.select("Finish review:", [
      "Return only",
      "Return and fix findings",
      "Return and summarize",
    ]);

    if (choice === undefined) {
      ctx.ui.notify("Cancelled. Use /end-review to try again.", "info");
      return;
    }

    const action: EndReviewAction =
      choice === "Return and fix findings"
        ? "returnAndFix"
        : choice === "Return and summarize"
          ? "returnAndSummarize"
          : "returnOnly";

    await executeEndReviewAction(pi, ctx, action, {
      showSummaryLoader: true,
      notifySuccess: true,
    });
  } finally {
    setEndInProgress(false);
  }
}

export default function reviewExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    applyAllPersistedState(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    applyAllPersistedState(ctx);
  });

  pi.registerCommand("review", {
    description:
      "Review code changes (PR, uncommitted, branch, commit, or folder)",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Review requires interactive mode", "error");
        return;
      }

      if (isLoopInProgress()) {
        ctx.ui.notify("Loop fixing review is already running.", "warning");
        return;
      }

      if (getOriginId()) {
        ctx.ui.notify(
          "Already in a review. Use /end-review to finish first.",
          "warning",
        );
        return;
      }

      const { code } = await pi.exec("git", ["rev-parse", "--git-dir"]);
      if (code !== 0) {
        ctx.ui.notify("Not a git repository", "error");
        return;
      }

      let target: ReviewTarget | null = null;
      let fromSelector = false;
      let extraInstruction: string | undefined;
      const parsed = parseArgs(args);
      if (parsed.error) {
        ctx.ui.notify(parsed.error, "error");
        return;
      }
      extraInstruction = parsed.extraInstruction?.trim() || undefined;

      if (parsed.target) {
        if (parsed.target.type === "pr") {
          target = await handlePrCheckout(pi, ctx, parsed.target.ref);
          if (!target) {
            ctx.ui.notify(
              "PR review failed. Returning to review menu.",
              "warning",
            );
          }
        } else {
          target = parsed.target;
        }
      }

      if (!target) {
        fromSelector = true;
      }

      while (true) {
        if (!target && fromSelector) {
          target = await showReviewSelector(pi, ctx, {
            loopFixingEnabled: isLoopFixingEnabled(),
            customInstructions: getCustomInstructions(),
            setLoopFixingEnabled(enabled) {
              setLoopFixingEnabledWithPersistence(pi, enabled);
            },
            setCustomInstructions(instructions) {
              setCustomInstructionsWithPersistence(pi, instructions);
            },
          });
        }

        if (!target) {
          ctx.ui.notify("Review cancelled", "info");
          return;
        }

        if (isLoopFixingEnabled() && !isLoopCompatibleTarget(target)) {
          ctx.ui.notify("Loop mode does not work with commit review.", "error");
          if (fromSelector) {
            target = null;
            continue;
          }
          return;
        }

        if (isLoopFixingEnabled()) {
          await runLoopFixingReview(pi, ctx, target, extraInstruction);
          return;
        }

        const entries = ctx.sessionManager.getEntries();
        const messageCount = entries.filter(
          (entry) => entry.type === "message",
        ).length;

        let useFreshSession = messageCount === 0;

        if (messageCount > 0) {
          const choice = await ctx.ui.select("Start review in:", [
            "Empty branch",
            "Current session",
          ]);

          if (choice === undefined) {
            if (fromSelector) {
              target = null;
              continue;
            }
            ctx.ui.notify("Review cancelled", "info");
            return;
          }

          useFreshSession = choice === "Empty branch";
        }

        await executeReview(pi, ctx, target, useFreshSession, {
          extraInstruction,
        });
        return;
      }
    },
  });

  pi.registerCommand("end-review", {
    description: "Complete review and return to original position",
    handler: async (_args, ctx) => {
      await runEndReview(pi, ctx);
    },
  });
}
