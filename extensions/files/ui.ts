/**
 * TUI pickers for this extension.
 *
 * Following the style used in pi's examples, this module keeps a short module
 * docstring plus focused docstrings on the exported UI entry points.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import type { SelectItem } from "@mariozechner/pi-tui";
import {
  Container,
  fuzzyFilter,
  Input,
  matchesKey,
  SelectList,
  Spacer,
  Text,
} from "@mariozechner/pi-tui";
import type { ActionAvailability, FileAction, FileEntry } from "./models.ts";
import { getActionDescriptions } from "./operability.ts";

export type ActionSelectorOptions = ActionAvailability;

export type FileSelectionResult = {
  selected: FileEntry | null;
  quickAction: "diff" | null;
};

const createListTheme = (theme: {
  fg: (color: string, text: string) => string;
}) => ({
  selectedPrefix: (text: string) => theme.fg("accent", text),
  selectedText: (text: string) => theme.fg("accent", text),
  description: (text: string) => theme.fg("muted", text),
  scrollInfo: (text: string) => theme.fg("dim", text),
  noMatch: (text: string) => theme.fg("warning", text),
});

const buildActionItems = (options: ActionSelectorOptions): SelectItem[] => {
  const descriptions = getActionDescriptions(options);

  return [
    {
      value: "diff",
      label: options.canDiff
        ? "Diff in VS Code"
        : "Diff in VS Code [unavailable]",
      description: descriptions.diff,
    },
    {
      value: "reveal",
      label: options.canReveal
        ? "Reveal in Finder"
        : "Reveal in Finder [unavailable]",
      description: descriptions.reveal,
    },
    {
      value: "open",
      label: options.canOpen ? "Open" : "Open [unavailable]",
      description: descriptions.open,
    },
    {
      value: "addToPrompt",
      label: "Add to prompt",
      description: descriptions.addToPrompt,
    },
    {
      value: "quicklook",
      label: options.canQuickLook
        ? "Open in Quick Look"
        : "Open in Quick Look [unavailable]",
      description: descriptions.quicklook,
    },
    {
      value: "edit",
      label: options.canEdit ? "Edit" : "Edit [unavailable]",
      description: descriptions.edit,
    },
  ];
};

const buildFileItems = (files: FileEntry[]): SelectItem[] =>
  files.map((file) => ({
    value: file.canonicalPath,
    label: `${file.displayPath}${file.isDirectory ? " [directory]" : ""}${
      file.status ? ` [${file.status}]` : ""
    }`,
  }));

/**
 * Shows the action picker for the currently selected file.
 */
export const showActionSelector = async (
  ctx: ExtensionContext,
  options: ActionSelectorOptions,
): Promise<FileAction | null> => {
  const actions = buildActionItems(options);

  return ctx.ui.custom<FileAction | null>((tui, theme, _kb, done) => {
    const container = new Container();
    const listTheme = createListTheme(theme);
    const selectList = new SelectList(actions, actions.length, listTheme);

    selectList.onSelect = (item) => done(item.value as FileAction);
    selectList.onCancel = () => done(null);

    container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
    container.addChild(
      new Text(theme.fg("accent", theme.bold("Choose action"))),
    );
    container.addChild(selectList);
    container.addChild(
      new Text(
        theme.fg(
          "dim",
          "Press enter to confirm • unavailable actions explain what is missing • esc to cancel",
        ),
      ),
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
  });
};

/**
 * Shows the file picker with fuzzy filtering and quick diff support.
 */
export const showFileSelector = async (
  ctx: ExtensionContext,
  files: FileEntry[],
  selectedPath?: string | null,
  gitRoot?: string | null,
): Promise<FileSelectionResult> => {
  const items = buildFileItems(files);
  let quickAction: "diff" | null = null;

  const selection = await ctx.ui.custom<string | null>(
    (tui, theme, keybindings, done) => {
      const container = new Container();
      const searchInput = new Input();
      const listContainer = new Container();
      const listTheme = createListTheme(theme);

      container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
      container.addChild(
        new Text(theme.fg("accent", theme.bold(" Select file")), 0, 0),
      );
      container.addChild(searchInput);
      container.addChild(new Spacer(1));
      container.addChild(listContainer);
      container.addChild(
        new Text(
          theme.fg(
            "dim",
            "Type to filter • enter to select • ctrl+shift+d diff • esc to cancel",
          ),
          0,
          0,
        ),
      );
      container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

      let filteredItems = items;
      let selectList: SelectList | null = null;

      const updateList = () => {
        listContainer.clear();
        if (filteredItems.length === 0) {
          listContainer.addChild(
            new Text(theme.fg("warning", "  No matching files"), 0, 0),
          );
          selectList = null;
          return;
        }

        selectList = new SelectList(
          filteredItems,
          Math.min(filteredItems.length, 12),
          listTheme,
        );

        if (selectedPath) {
          const index = filteredItems.findIndex(
            (item) => item.value === selectedPath,
          );
          if (index >= 0) {
            selectList.setSelectedIndex(index);
          }
        }

        selectList.onSelect = (item) => done(item.value as string);
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
          if (matchesKey(data, "ctrl+shift+d")) {
            const selected = selectList?.getSelectedItem();
            if (selected) {
              const file = files.find(
                (entry) => entry.canonicalPath === selected.value,
              );
              const canDiff =
                file?.isTracked && !file.isDirectory && Boolean(gitRoot);
              if (!canDiff) {
                ctx.ui.notify(
                  "Diff is only available for tracked files",
                  "warning",
                );
                return;
              }

              quickAction = "diff";
              done(selected.value as string);
              return;
            }
          }

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

  return {
    selected: selection
      ? (files.find((file) => file.canonicalPath === selection) ?? null)
      : null,
    quickAction,
  };
};
