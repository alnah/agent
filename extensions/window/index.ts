/**
 * Registers the `/window` command and the supporting skill-read tracker.
 *
 * This extension exposes a compact view over context-window usage, loaded
 * resources, and session totals without depending on provider-specific APIs.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@mariozechner/pi-coding-agent";
import { createWindowHandler } from "./command.ts";
import { createSkillReadTracker } from "./skills.ts";

export {
  formatExtensionSourceLabel,
  loadProjectContextFiles,
  normalizeReadPath,
  shortenPath,
} from "./files.ts";
export {
  estimateTokens,
  estimateToolDefinitionTokens,
  formatUsd,
  sumSessionUsage,
} from "./metrics.ts";
export type { SkillIndexEntry, SkillReadEntryData } from "./skills.ts";
export {
  buildSkillIndex,
  createSkillReadTracker,
  getSkillsObservedViaReadFromSession,
  normalizeSkillName,
  SKILL_READ_ENTRY,
} from "./skills.ts";
export type { WindowViewData } from "./view.ts";
export {
  joinComma,
  joinCommaStyled,
  renderUsageBar,
  WindowView,
} from "./view.ts";

/**
 * Wires the `/window` command to its command handler and session-side skill
 * observation state.
 *
 * The entrypoint stays intentionally thin so the command, view, and tracking
 * logic can evolve independently.
 */
export default function windowExtension(pi: ExtensionAPI) {
  const skillReadTracker = createSkillReadTracker(pi);
  const handleWindow = createWindowHandler(pi);

  pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
    skillReadTracker.onToolResult(event, ctx);
  });

  pi.registerCommand("window", {
    description: "Show loaded window overview",
    handler: async (args, ctx) => {
      skillReadTracker.refreshSkillIndex(ctx.cwd);
      await handleWindow(args, ctx);
    },
  });
}
