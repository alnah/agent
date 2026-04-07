/**
 * Review selectors and editors.
 *
 * Hosts the interactive review-target picker plus the branch, commit, folder,
 * and pull-request selectors used by `/review`.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
  Container,
  fuzzyFilter,
  Input,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
} from "@mariozechner/pi-tui";
import { parseReviewPaths } from "./arguments.ts";
import {
  checkoutPr,
  getCurrentBranch,
  getDefaultBranch,
  getLocalBranches,
  getPrInfo,
  getRecentCommits,
  hasPendingChanges,
  hasUncommittedChanges,
  parsePrReference,
} from "./git.ts";
import type { ReviewTarget } from "./targets.ts";

const REVIEW_PRESETS = [
  {
    value: "uncommitted",
    label: "Review uncommitted changes",
    description: "",
  },
  {
    value: "baseBranch",
    label: "Review against a base branch",
    description: "(local)",
  },
  { value: "commit", label: "Review a commit", description: "" },
  {
    value: "pullRequest",
    label: "Review a pull request",
    description: "(GitHub PR)",
  },
  {
    value: "folder",
    label: "Review a folder (or more)",
    description: "(snapshot, not diff)",
  },
] as const;

const TOGGLE_LOOP_FIXING_VALUE = "toggleLoopFixing" as const;
const TOGGLE_CUSTOM_INSTRUCTIONS_VALUE = "toggleCustomInstructions" as const;

type ReviewPresetValue =
  | (typeof REVIEW_PRESETS)[number]["value"]
  | typeof TOGGLE_LOOP_FIXING_VALUE
  | typeof TOGGLE_CUSTOM_INSTRUCTIONS_VALUE;

/**
 * State and callbacks used by the interactive review selector.
 */
export type SelectorState = {
  loopFixingEnabled: boolean;
  customInstructions?: string;
  setLoopFixingEnabled(enabled: boolean): void;
  setCustomInstructions(instructions: string | undefined): void;
};

/**
 * Chooses the smart default review mode from the current git state.
 */
async function getSmartDefault(
  pi: ExtensionAPI,
): Promise<"uncommitted" | "baseBranch" | "commit"> {
  if (await hasUncommittedChanges(pi)) {
    return "uncommitted";
  }

  const currentBranch = await getCurrentBranch(pi);
  const defaultBranch = await getDefaultBranch(pi);
  if (currentBranch && currentBranch !== defaultBranch) {
    return "baseBranch";
  }

  return "commit";
}

/**
 * Shows the top-level review preset selector.
 *
 * The selector can also mutate shared review settings before returning a target.
 */
export async function showReviewSelector(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: SelectorState,
): Promise<ReviewTarget | null> {
  const smartDefault = await getSmartDefault(pi);
  const presetItems: SelectItem[] = REVIEW_PRESETS.map((preset) => ({
    value: preset.value,
    label: preset.label,
    description: preset.description,
  }));
  const smartDefaultIndex = presetItems.findIndex(
    (item) => item.value === smartDefault,
  );

  while (true) {
    const customInstructionsLabel = state.customInstructions
      ? "Remove custom review instructions"
      : "Add custom review instructions";
    const customInstructionsDescription = state.customInstructions
      ? "(currently set)"
      : "(applies to all review modes)";
    const loopToggleLabel = state.loopFixingEnabled
      ? "Disable Loop Fixing"
      : "Enable Loop Fixing";
    const loopToggleDescription = state.loopFixingEnabled
      ? "(currently on)"
      : "(currently off)";
    const items: SelectItem[] = [
      ...presetItems,
      {
        value: TOGGLE_CUSTOM_INSTRUCTIONS_VALUE,
        label: customInstructionsLabel,
        description: customInstructionsDescription,
      },
      {
        value: TOGGLE_LOOP_FIXING_VALUE,
        label: loopToggleLabel,
        description: loopToggleDescription,
      },
    ];

    const result = await ctx.ui.custom<ReviewPresetValue | null>(
      (tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
        container.addChild(
          new Text(theme.fg("accent", theme.bold("Select a review preset"))),
        );

        const selectList = new SelectList(items, Math.min(items.length, 10), {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", text),
          description: (text) => theme.fg("muted", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: (text) => theme.fg("warning", text),
        });

        if (smartDefaultIndex >= 0) {
          selectList.setSelectedIndex(smartDefaultIndex);
        }

        selectList.onSelect = (item) => done(item.value as ReviewPresetValue);
        selectList.onCancel = () => done(null);

        container.addChild(selectList);
        container.addChild(
          new Text(theme.fg("dim", "Press enter to confirm or esc to go back")),
        );
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            selectList.handleInput(data);
            tui.requestRender();
          },
        };
      },
    );

    if (!result) return null;

    if (result === TOGGLE_LOOP_FIXING_VALUE) {
      const nextEnabled = !state.loopFixingEnabled;
      state.setLoopFixingEnabled(nextEnabled);
      state.loopFixingEnabled = nextEnabled;
      ctx.ui.notify(
        nextEnabled ? "Loop fixing enabled" : "Loop fixing disabled",
        "info",
      );
      continue;
    }

    if (result === TOGGLE_CUSTOM_INSTRUCTIONS_VALUE) {
      if (state.customInstructions) {
        state.setCustomInstructions(undefined);
        state.customInstructions = undefined;
        ctx.ui.notify("Custom review instructions removed", "info");
        continue;
      }

      const customInstructions = await ctx.ui.editor(
        "Enter custom review instructions (applies to all review modes):",
        "",
      );

      if (!customInstructions?.trim()) {
        ctx.ui.notify("Custom review instructions not changed", "info");
        continue;
      }

      state.setCustomInstructions(customInstructions);
      state.customInstructions = customInstructions.trim();
      ctx.ui.notify("Custom review instructions saved", "info");
      continue;
    }

    switch (result) {
      case "uncommitted":
        return { type: "uncommitted" };

      case "baseBranch": {
        const target = await showBranchSelector(pi, ctx);
        if (target) return target;
        break;
      }

      case "commit": {
        if (state.loopFixingEnabled) {
          ctx.ui.notify("Loop mode does not work with commit review.", "error");
          break;
        }
        const target = await showCommitSelector(pi, ctx);
        if (target) return target;
        break;
      }

      case "folder": {
        const target = await showFolderInput(ctx);
        if (target) return target;
        break;
      }

      case "pullRequest": {
        const target = await showPrInput(pi, ctx);
        if (target) return target;
        break;
      }

      default:
        return null;
    }
  }
}

/**
 * Shows the base-branch selector used by branch reviews.
 */
async function showBranchSelector(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<ReviewTarget | null> {
  const branches = await getLocalBranches(pi);
  const currentBranch = await getCurrentBranch(pi);
  const defaultBranch = await getDefaultBranch(pi);

  const candidateBranches = currentBranch
    ? branches.filter((branch) => branch !== currentBranch)
    : branches;

  if (candidateBranches.length === 0) {
    ctx.ui.notify(
      currentBranch
        ? `No other branches found (current branch: ${currentBranch})`
        : "No branches found",
      "error",
    );
    return null;
  }

  const sortedBranches = candidateBranches.sort((a, b) => {
    if (a === defaultBranch) return -1;
    if (b === defaultBranch) return 1;
    return a.localeCompare(b);
  });

  const items: SelectItem[] = sortedBranches.map((branch) => ({
    value: branch,
    label: branch,
    description: branch === defaultBranch ? "(default)" : "",
  }));

  const result = await ctx.ui.custom<string | null>(
    (tui, theme, keybindings, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
      container.addChild(
        new Text(theme.fg("accent", theme.bold("Select base branch"))),
      );

      const searchInput = new Input();
      container.addChild(searchInput);
      container.addChild(new Spacer(1));

      const listContainer = new Container();
      container.addChild(listContainer);
      container.addChild(
        new Text(
          theme.fg("dim", "Type to filter • enter to select • esc to cancel"),
        ),
      );
      container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

      let filteredItems = items;
      let selectList: SelectList | null = null;

      const updateList = () => {
        listContainer.clear();
        if (filteredItems.length === 0) {
          listContainer.addChild(
            new Text(theme.fg("warning", "  No matching branches")),
          );
          selectList = null;
          return;
        }

        selectList = new SelectList(
          filteredItems,
          Math.min(filteredItems.length, 10),
          {
            selectedPrefix: (text) => theme.fg("accent", text),
            selectedText: (text) => theme.fg("accent", text),
            description: (text) => theme.fg("muted", text),
            scrollInfo: (text) => theme.fg("dim", text),
            noMatch: (text) => theme.fg("warning", text),
          },
        );

        selectList.onSelect = (item) => done(item.value);
        selectList.onCancel = () => done(null);
        listContainer.addChild(selectList);
      };

      const applyFilter = () => {
        const query = searchInput.getValue();
        filteredItems = query
          ? fuzzyFilter(
              items,
              query,
              (item) => `${item.label} ${item.value} ${item.description ?? ""}`,
            )
          : items;
        updateList();
      };

      applyFilter();

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          if (
            keybindings.matches(data, "tui.select.up") ||
            keybindings.matches(data, "tui.select.down") ||
            keybindings.matches(data, "tui.select.confirm") ||
            keybindings.matches(data, "tui.select.cancel")
          ) {
            if (selectList) {
              selectList.handleInput(data);
            } else if (keybindings.matches(data, "tui.select.cancel")) {
              done(null);
            }
            tui.requestRender();
            return;
          }

          searchInput.handleInput(data);
          applyFilter();
          tui.requestRender();
        },
      };
    },
  );

  if (!result) return null;
  return { type: "baseBranch", branch: result };
}

/**
 * Shows the recent-commit selector used by commit reviews.
 */
async function showCommitSelector(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<ReviewTarget | null> {
  const commits = await getRecentCommits(pi, 20);

  if (commits.length === 0) {
    ctx.ui.notify("No commits found", "error");
    return null;
  }

  const items: SelectItem[] = commits.map((commit) => ({
    value: commit.sha,
    label: `${commit.sha.slice(0, 7)} ${commit.title}`,
    description: "",
  }));

  const result = await ctx.ui.custom<{ sha: string; title: string } | null>(
    (tui, theme, keybindings, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
      container.addChild(
        new Text(theme.fg("accent", theme.bold("Select commit to review"))),
      );

      const searchInput = new Input();
      container.addChild(searchInput);
      container.addChild(new Spacer(1));

      const listContainer = new Container();
      container.addChild(listContainer);
      container.addChild(
        new Text(
          theme.fg("dim", "Type to filter • enter to select • esc to cancel"),
        ),
      );
      container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

      let filteredItems = items;
      let selectList: SelectList | null = null;

      const updateList = () => {
        listContainer.clear();
        if (filteredItems.length === 0) {
          listContainer.addChild(
            new Text(theme.fg("warning", "  No matching commits")),
          );
          selectList = null;
          return;
        }

        selectList = new SelectList(
          filteredItems,
          Math.min(filteredItems.length, 10),
          {
            selectedPrefix: (text) => theme.fg("accent", text),
            selectedText: (text) => theme.fg("accent", text),
            description: (text) => theme.fg("muted", text),
            scrollInfo: (text) => theme.fg("dim", text),
            noMatch: (text) => theme.fg("warning", text),
          },
        );

        selectList.onSelect = (item) => {
          const commit = commits.find(
            (candidate) => candidate.sha === item.value,
          );
          if (commit) {
            done(commit);
          } else {
            done(null);
          }
        };
        selectList.onCancel = () => done(null);
        listContainer.addChild(selectList);
      };

      const applyFilter = () => {
        const query = searchInput.getValue();
        filteredItems = query
          ? fuzzyFilter(
              items,
              query,
              (item) => `${item.label} ${item.value} ${item.description ?? ""}`,
            )
          : items;
        updateList();
      };

      applyFilter();

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          if (
            keybindings.matches(data, "tui.select.up") ||
            keybindings.matches(data, "tui.select.down") ||
            keybindings.matches(data, "tui.select.confirm") ||
            keybindings.matches(data, "tui.select.cancel")
          ) {
            if (selectList) {
              selectList.handleInput(data);
            } else if (keybindings.matches(data, "tui.select.cancel")) {
              done(null);
            }
            tui.requestRender();
            return;
          }

          searchInput.handleInput(data);
          applyFilter();
          tui.requestRender();
        },
      };
    },
  );

  if (!result) return null;
  return { type: "commit", sha: result.sha, title: result.title };
}

/**
 * Prompts for a folder or file list used by snapshot reviews.
 */
async function showFolderInput(
  ctx: ExtensionContext,
): Promise<ReviewTarget | null> {
  const result = await ctx.ui.editor(
    "Enter folders/files to review (space-separated or one per line):",
    ".",
  );

  if (!result?.trim()) return null;
  const paths = parseReviewPaths(result);
  if (paths.length === 0) return null;

  return { type: "folder", paths };
}

/**
 * Prompts for a PR reference, fetches metadata, and checks the PR out locally.
 */
async function showPrInput(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<ReviewTarget | null> {
  if (await hasPendingChanges(pi)) {
    ctx.ui.notify(
      "Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.",
      "error",
    );
    return null;
  }

  const prRef = await ctx.ui.editor(
    "Enter PR number or URL (e.g. 123 or https://github.com/owner/repo/pull/123):",
    "",
  );

  if (!prRef?.trim()) return null;

  const prNumber = parsePrReference(prRef);
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

  if (await hasPendingChanges(pi)) {
    ctx.ui.notify(
      "Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.",
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
