import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import {
  Container,
  type Focusable,
  Input,
  Key,
  type Keybinding,
  type KeybindingsManager,
  Markdown,
  matchesKey,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";
import { filterTodos, formatTodoId, isClosedStatus } from "./parsing.ts";
import { buildRefinePrompt, buildWorkPrompt } from "./prompts.ts";

type Theme = ExtensionContext["ui"]["theme"];

type TodoRecord = {
  id: string;
  title: string;
  tags: string[];
  status: string;
  created_at?: string;
  assigned_to_session?: string;
  body?: string;
};

type TodoQuickAction = "work" | "refine";
type TodoMenuAction =
  | "view"
  | "work"
  | "refine"
  | "close"
  | "reopen"
  | "release"
  | "delete";
type TodoDetailAction = "back" | "work" | "refine";

/**
 * Checks whether incoming key data matches a named binding or fallback value.
 *
 * The UI should work both with Pi keybinding ids and with raw key strings used
 * in tests and simpler runtimes.
 */
function matchesAnyKey(
  keyData: string,
  keybindings: KeybindingsManager | undefined,
  id: Keybinding,
  fallbacks: string[] = [],
): boolean {
  return Boolean(
    keybindings?.matches?.(keyData, id) || fallbacks.includes(keyData),
  );
}

/**
 * Normalizes named keys into the raw sequences expected by `SelectList`.
 *
 * Pi may deliver decoded key names while the select widget still understands
 * terminal-style control sequences.
 */
function normalizeSelectKey(keyData: string): string {
  if (keyData === "enter" || keyData === "return") return "\r";
  if (keyData === "escape" || keyData === "esc") return "\u001b";
  if (keyData === "up") return "\u001b[A";
  if (keyData === "down") return "\u001b[B";
  return keyData;
}

/**
 * Renders assignment metadata for one todo row.
 *
 * The current session is highlighted so users can distinguish their own claimed
 * work from todos held by another session.
 */
function renderAssignmentSuffix(
  theme: Theme,
  todo: TodoRecord,
  currentSessionId?: string,
): string {
  if (!todo.assigned_to_session) return "";
  const isCurrent = todo.assigned_to_session === currentSessionId;
  const color = isCurrent ? "success" : "dim";
  const suffix = isCurrent ? ", current" : "";
  return theme.fg(color, ` (assigned: ${todo.assigned_to_session}${suffix})`);
}

/**
 * Returns the display title for a todo.
 *
 * Empty titles fall back to a placeholder so list rows and prompts stay
 * readable.
 */
function getTodoTitle(todo: TodoRecord): string {
  return todo.title || "(untitled)";
}

/**
 * Returns the display status for a todo.
 *
 * Missing status values are treated as `open`, which matches the storage
 * default.
 */
function getTodoStatus(todo: TodoRecord): string {
  return todo.status || "open";
}

/**
 * Interactive todo picker with live search and quick actions.
 *
 * The selector is the main `/todos` surface. It filters locally, highlights the
 * current row, exposes work/refine shortcuts, and keeps the visible list in
 * sync after mutations.
 */
export class TodoSelectorComponent extends Container implements Focusable {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private readonly currentSessionId?: string;
  private allTodos: TodoRecord[];
  private filteredTodos: TodoRecord[];
  private selectedIndex: number;
  private readonly onSelectCallback: (todo: TodoRecord) => void;
  private readonly onCancelCallback: () => void;
  private readonly onQuickAction?: (
    todo: TodoRecord,
    action: TodoQuickAction,
  ) => void;
  private readonly headerText: Text;
  private readonly searchInput: Input;
  private readonly listContainer: Container;
  private readonly hintText: Text;
  private _focused = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    todos: TodoRecord[],
    onSelect: (todo: TodoRecord) => void,
    onCancel: () => void,
    initialSearchInput?: string,
    currentSessionId?: string,
    onQuickAction?: (todo: TodoRecord, action: TodoQuickAction) => void,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.currentSessionId = currentSessionId;
    this.allTodos = todos;
    this.filteredTodos = todos;
    this.selectedIndex = 0;
    this.onSelectCallback = onSelect;
    this.onCancelCallback = onCancel;
    this.onQuickAction = onQuickAction;
    this._focused = false;

    this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
    this.addChild(new Spacer(1));
    this.headerText = new Text("", 1, 0);
    this.addChild(this.headerText);
    this.addChild(new Spacer(1));

    this.searchInput = new Input();
    if (initialSearchInput) this.searchInput.setValue(initialSearchInput);
    this.searchInput.onSubmit = () => {
      const selected = this.filteredTodos[this.selectedIndex];
      if (selected) this.onSelectCallback(selected);
    };
    this.addChild(this.searchInput);

    this.addChild(new Spacer(1));
    this.listContainer = new Container();
    this.addChild(this.listContainer);

    this.addChild(new Spacer(1));
    this.hintText = new Text("", 1, 0);
    this.addChild(this.hintText);
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

    this.updateHeader();
    this.updateHints();
    this.applyFilter(this.searchInput.getValue());
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  setTodos(todos: TodoRecord[]): void {
    this.allTodos = todos;
    this.updateHeader();
    this.applyFilter(this.searchInput.getValue());
    this.tui.requestRender();
  }

  getSearchValue(): string {
    return this.searchInput.getValue();
  }

  updateHeader(): void {
    const openCount = this.allTodos.filter(
      (todo) => !isClosedStatus(todo.status),
    ).length;
    const closedCount = this.allTodos.length - openCount;
    this.headerText.setText(
      this.theme.fg(
        "accent",
        this.theme.bold(`Todos (${openCount} open, ${closedCount} closed)`),
      ),
    );
  }

  updateHints(): void {
    this.hintText.setText(
      this.theme.fg(
        "dim",
        "Type to search • ↑↓ select • Enter actions • Ctrl+Shift+W work • Ctrl+Shift+R refine • Esc close",
      ),
    );
  }

  applyFilter(query: string): void {
    this.filteredTodos = filterTodos(this.allTodos, query);
    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filteredTodos.length - 1),
    );
    this.updateList();
  }

  updateList(): void {
    this.listContainer.clear();

    if (this.filteredTodos.length === 0) {
      this.listContainer.addChild(
        new Text(this.theme.fg("muted", " No matching todos"), 0, 0),
      );
      return;
    }

    const maxVisible = 10;
    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(maxVisible / 2),
        this.filteredTodos.length - maxVisible,
      ),
    );
    const endIndex = Math.min(
      startIndex + maxVisible,
      this.filteredTodos.length,
    );

    for (let i = startIndex; i < endIndex; i += 1) {
      const todo = this.filteredTodos[i];
      const isSelected = i === this.selectedIndex;
      const closed = isClosedStatus(todo.status);
      const prefix = isSelected ? this.theme.fg("accent", "→ ") : " ";
      const titleColor = isSelected ? "accent" : closed ? "dim" : "text";
      const tagText = todo.tags.length ? ` [${todo.tags.join(", ")}]` : "";
      const assignmentText = renderAssignmentSuffix(
        this.theme,
        todo,
        this.currentSessionId,
      );
      const line =
        prefix +
        this.theme.fg("accent", formatTodoId(todo.id)) +
        " " +
        this.theme.fg(titleColor, getTodoTitle(todo)) +
        this.theme.fg("muted", tagText) +
        assignmentText +
        " " +
        this.theme.fg(closed ? "dim" : "success", `(${getTodoStatus(todo)})`);
      this.listContainer.addChild(new Text(line, 0, 0));
    }

    if (startIndex > 0 || endIndex < this.filteredTodos.length) {
      this.listContainer.addChild(
        new Text(
          this.theme.fg(
            "dim",
            ` (${this.selectedIndex + 1}/${this.filteredTodos.length})`,
          ),
          0,
          0,
        ),
      );
    }
  }

  handleInput(keyData: string): void {
    const kb = this.keybindings;
    if (matchesAnyKey(keyData, kb, "tui.select.up", ["up"])) {
      if (!this.filteredTodos.length) return;
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.filteredTodos.length - 1
          : this.selectedIndex - 1;
      this.updateList();
      return;
    }
    if (matchesAnyKey(keyData, kb, "tui.select.down", ["down"])) {
      if (!this.filteredTodos.length) return;
      this.selectedIndex =
        this.selectedIndex === this.filteredTodos.length - 1
          ? 0
          : this.selectedIndex + 1;
      this.updateList();
      return;
    }
    if (matchesAnyKey(keyData, kb, "tui.select.confirm", ["enter", "return"])) {
      const selected = this.filteredTodos[this.selectedIndex];
      if (selected) this.onSelectCallback(selected);
      return;
    }
    if (matchesAnyKey(keyData, kb, "tui.select.cancel", ["escape", "esc"])) {
      this.onCancelCallback();
      return;
    }
    if (matchesKey(keyData, Key.ctrlShift("r")) || keyData === "ctrl+shift+r") {
      const selected = this.filteredTodos[this.selectedIndex];
      if (selected && this.onQuickAction)
        this.onQuickAction(selected, "refine");
      return;
    }
    if (matchesKey(keyData, Key.ctrlShift("w")) || keyData === "ctrl+shift+w") {
      const selected = this.filteredTodos[this.selectedIndex];
      if (selected && this.onQuickAction) this.onQuickAction(selected, "work");
      return;
    }
    this.searchInput.handleInput(keyData);
    this.applyFilter(this.searchInput.getValue());
  }

  invalidate(): void {
    super.invalidate();
    this.updateHeader();
    this.updateHints();
    this.updateList();
  }
}

/**
 * Action menu shown after selecting one todo.
 *
 * Available actions depend on the todo state so users only see relevant
 * transitions such as close versus reopen.
 */
export class TodoActionMenuComponent extends Container {
  private readonly selectList: SelectList;

  constructor(
    theme: Theme,
    todo: TodoRecord,
    onSelect: (action: TodoMenuAction) => void,
    onCancel: () => void,
  ) {
    super();
    const closed = isClosedStatus(todo.status);
    const options: SelectItem[] = [
      { value: "view", label: "view", description: "View todo" },
      { value: "work", label: "work", description: "Work on todo" },
      { value: "refine", label: "refine", description: "Refine task" },
      ...(closed
        ? [{ value: "reopen", label: "reopen", description: "Reopen todo" }]
        : [{ value: "close", label: "close", description: "Close todo" }]),
      ...(todo.assigned_to_session
        ? [
            {
              value: "release",
              label: "release",
              description: "Release assignment",
            },
          ]
        : []),
      { value: "delete", label: "delete", description: "Delete todo" },
    ];

    this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
    this.addChild(
      new Text(
        theme.fg(
          "accent",
          theme.bold(
            `Actions for ${formatTodoId(todo.id)} "${getTodoTitle(todo)}"`,
          ),
        ),
      ),
    );
    this.selectList = new SelectList(options, options.length, {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    this.selectList.onSelect = (item) => onSelect(item.value as TodoMenuAction);
    this.selectList.onCancel = () => onCancel();
    this.addChild(this.selectList);
    this.addChild(new Text(theme.fg("dim", "Enter to confirm • Esc back")));
    this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
  }

  handleInput(keyData: string): void {
    this.selectList.handleInput(normalizeSelectKey(keyData));
  }
}

/**
 * Confirmation menu for destructive todo deletion.
 *
 * Deletion is irreversible, so the UI requires an explicit yes/no choice before
 * removing the file.
 */
export class TodoDeleteConfirmComponent extends Container {
  private readonly selectList: SelectList;

  constructor(
    theme: Theme,
    message: string,
    onConfirm: (confirmed: boolean) => void,
  ) {
    super();
    const options: SelectItem[] = [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ];

    this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
    this.addChild(new Text(theme.fg("accent", message)));
    this.selectList = new SelectList(options, options.length, {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    this.selectList.onSelect = (item) => onConfirm(item.value === "yes");
    this.selectList.onCancel = () => onConfirm(false);
    this.addChild(this.selectList);
    this.addChild(new Text(theme.fg("dim", "Enter to confirm • Esc back")));
    this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
  }

  handleInput(keyData: string): void {
    this.selectList.handleInput(normalizeSelectKey(keyData));
  }
}

/**
 * Overlay that renders the full todo body and navigation hints.
 *
 * It supports scrolling through markdown details and exposes direct work and
 * refine actions without leaving the overlay first.
 */
export class TodoDetailOverlayComponent {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private readonly todo: TodoRecord;
  private readonly onAction: (action: TodoDetailAction) => void;
  private markdown: Markdown;
  private scrollOffset: number;
  private viewHeight: number;
  private totalLines: number;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    todo: TodoRecord,
    onAction: (action: TodoDetailAction) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.todo = todo;
    this.onAction = onAction;
    this.markdown = new Markdown(
      this.getMarkdownText(),
      1,
      0,
      getMarkdownTheme(),
    );
    this.scrollOffset = 0;
    this.viewHeight = 0;
    this.totalLines = 0;
  }

  getMarkdownText(): string {
    const body = this.todo.body?.trim();
    return body ? body : "_No details yet._";
  }

  handleInput(keyData: string): void {
    if (
      matchesAnyKey(keyData, this.keybindings, "tui.select.cancel", [
        "escape",
        "esc",
      ])
    ) {
      this.onAction("back");
      return;
    }
    if (
      matchesAnyKey(keyData, this.keybindings, "tui.select.confirm", [
        "enter",
        "return",
      ])
    ) {
      this.onAction("work");
      return;
    }
    if (matchesKey(keyData, Key.ctrlShift("r")) || keyData === "ctrl+shift+r") {
      this.onAction("refine");
      return;
    }
    if (matchesAnyKey(keyData, this.keybindings, "tui.select.up", ["up"])) {
      this.scrollBy(-1);
      return;
    }
    if (matchesAnyKey(keyData, this.keybindings, "tui.select.down", ["down"])) {
      this.scrollBy(1);
      return;
    }
    if (
      matchesAnyKey(keyData, this.keybindings, "tui.select.pageUp", [
        "pageUp",
      ]) ||
      matchesKey(keyData, Key.left) ||
      keyData === "left"
    ) {
      this.scrollBy(-(this.viewHeight || 1));
      return;
    }
    if (
      matchesAnyKey(keyData, this.keybindings, "tui.select.pageDown", [
        "pageDown",
      ]) ||
      matchesKey(keyData, Key.right) ||
      keyData === "right"
    ) {
      this.scrollBy(this.viewHeight || 1);
    }
  }

  render(width: number): string[] {
    const maxHeight = this.getMaxHeight();
    const headerLines = 3;
    const footerLines = 3;
    const borderLines = 2;
    const innerWidth = Math.max(10, width - 2);
    const contentHeight = Math.max(
      1,
      maxHeight - headerLines - footerLines - borderLines,
    );

    const markdownLines = this.markdown.render(innerWidth);
    this.totalLines = markdownLines.length;
    this.viewHeight = contentHeight;
    this.scrollOffset = Math.max(
      0,
      Math.min(this.scrollOffset, Math.max(0, this.totalLines - contentHeight)),
    );

    const visibleLines = markdownLines.slice(
      this.scrollOffset,
      this.scrollOffset + contentHeight,
    );
    const lines = [];
    lines.push(this.buildTitleLine(innerWidth));
    lines.push(this.buildMetaLine(innerWidth));
    lines.push("");
    for (const line of visibleLines)
      lines.push(truncateToWidth(line, innerWidth));
    while (lines.length < headerLines + contentHeight) lines.push("");
    lines.push("");
    lines.push(this.buildActionLine(innerWidth));

    const borderColor = (text) => this.theme.fg("borderMuted", text);
    const top = borderColor(`┌${"─".repeat(innerWidth)}┐`);
    const bottom = borderColor(`└${"─".repeat(innerWidth)}┘`);
    const framed = lines.map((line) => {
      const truncated = truncateToWidth(line, innerWidth);
      const padding = Math.max(0, innerWidth - visibleWidth(truncated));
      return (
        borderColor(" ") + truncated + " ".repeat(padding) + borderColor(" ")
      );
    });
    return [top, ...framed, bottom].map((line) => truncateToWidth(line, width));
  }

  invalidate(): void {
    this.markdown = new Markdown(
      this.getMarkdownText(),
      1,
      0,
      getMarkdownTheme(),
    );
  }

  getMaxHeight(): number {
    const rows = this.tui.terminal.rows || 24;
    return Math.max(10, Math.floor(rows * 0.8));
  }

  buildTitleLine(width: number): string {
    const titleText = this.todo.title
      ? ` ${this.todo.title} `
      : ` Todo ${formatTodoId(this.todo.id)} `;
    const titleWidth = visibleWidth(titleText);
    if (titleWidth >= width)
      return truncateToWidth(this.theme.fg("accent", titleText.trim()), width);
    const leftWidth = Math.max(0, Math.floor((width - titleWidth) / 2));
    const rightWidth = Math.max(0, width - titleWidth - leftWidth);
    return (
      this.theme.fg("borderMuted", "─".repeat(leftWidth)) +
      this.theme.fg("accent", titleText) +
      this.theme.fg("borderMuted", "─".repeat(rightWidth))
    );
  }

  buildMetaLine(width: number): string {
    const status = getTodoStatus(this.todo);
    const line =
      this.theme.fg("accent", formatTodoId(this.todo.id)) +
      this.theme.fg("muted", " • ") +
      this.theme.fg(isClosedStatus(status) ? "dim" : "success", status) +
      this.theme.fg("muted", " • ") +
      this.theme.fg(
        "muted",
        this.todo.tags.length ? this.todo.tags.join(", ") : "no tags",
      );
    return truncateToWidth(line, width);
  }

  buildActionLine(width: number): string {
    const work =
      this.theme.fg("accent", "enter") +
      this.theme.fg("muted", " work on todo");
    const refine =
      this.theme.fg("accent", "ctrl+shift+r") +
      this.theme.fg("muted", " refine");
    const back = this.theme.fg("dim", "esc back");
    const nav = this.theme.fg("dim", "↑/↓ move • ←/→ page");
    return truncateToWidth(
      [work, refine, back, nav].join(this.theme.fg("muted", " • ")),
      width,
    );
  }

  scrollBy(delta: number): void {
    const maxScroll = Math.max(0, this.totalLines - this.viewHeight);
    this.scrollOffset = Math.max(
      0,
      Math.min(this.scrollOffset + delta, maxScroll),
    );
  }
}

/**
 * Builds the editor prompt for a selector quick action.
 *
 * Quick actions bypass the intermediate menus, so the command needs one helper
 * that maps the action to the correct prompt builder.
 */
export function quickActionPrompt(
  todo: TodoRecord,
  action: TodoQuickAction,
): string {
  return action === "refine"
    ? buildRefinePrompt(todo.id, getTodoTitle(todo))
    : buildWorkPrompt(todo.id, getTodoTitle(todo));
}
