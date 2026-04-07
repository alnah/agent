/**
 * Loop preset selector.
 *
 * Shows the interactive preset picker used by `/loop` when no valid arguments
 * were provided on the command line.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
  Container,
  type SelectItem,
  SelectList,
  Text,
} from "@mariozechner/pi-tui";
import { buildPrompt } from "./prompting.ts";
import type { LoopStateData } from "./state.ts";

const LOOP_PRESETS = [
  { value: "tests", label: "Until tests pass", description: "" },
  { value: "custom", label: "Until custom condition", description: "" },
  { value: "self", label: "Self driven (agent decides)", description: "" },
] as const;

/**
 * Lets the user choose a loop preset and optional custom condition.
 *
 * Returns `null` when the selector or the custom-condition editor is cancelled.
 */
export async function showLoopSelector(
  ctx: ExtensionContext,
): Promise<LoopStateData | null> {
  const items: SelectItem[] = LOOP_PRESETS.map((preset) => ({
    value: preset.value,
    label: preset.label,
    description: preset.description,
  }));

  const selection = await ctx.ui.custom<string | null>(
    (tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
      container.addChild(
        new Text(theme.fg("accent", theme.bold("Select a loop preset"))),
      );

      const selectList = new SelectList(items, Math.min(items.length, 10), {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      });

      selectList.onSelect = (item) => done(item.value);
      selectList.onCancel = () => done(null);

      container.addChild(selectList);
      container.addChild(
        new Text(theme.fg("dim", "Press enter to confirm or esc to cancel")),
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

  if (!selection) return null;

  switch (selection) {
    case "tests":
      return { active: true, mode: "tests", prompt: buildPrompt("tests") };
    case "self":
      return { active: true, mode: "self", prompt: buildPrompt("self") };
    case "custom": {
      const condition = await ctx.ui.editor(
        "Enter loop breakout condition:",
        "",
      );
      if (!condition?.trim()) return null;
      return {
        active: true,
        mode: "custom",
        condition: condition.trim(),
        prompt: buildPrompt("custom", condition.trim()),
      };
    }
    default:
      return null;
  }
}
