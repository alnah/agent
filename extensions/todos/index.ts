import { StringEnum } from "@mariozechner/pi-ai";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { createTodoExecutor } from "./executor.ts";
import { filterTodos, getTodosDir } from "./parsing.ts";
import { buildRefinePrompt, buildWorkPrompt } from "./prompts.ts";
import {
  ensureTodosDir,
  garbageCollectTodos,
  listTodos,
  readTodoSettings,
} from "./storage.ts";
import {
  quickActionPrompt,
  TodoActionMenuComponent,
  TodoDeleteConfirmComponent,
  TodoDetailOverlayComponent,
  TodoSelectorComponent,
} from "./ui.ts";

const TODO_TOOL_DESCRIPTION =
  "Manage file-based todos stored under .pi/todos. Claim tasks before working on them, release them when handing off, and close them when done.";
const TODO_TOOL_PROMPT_SNIPPET =
  "Use this project file/markdown todo tool to list, create, update, append, claim, release, and close shared tasks.";
const TODO_TOOL_PROMPT_GUIDELINES = [
  "Prefer this tool over ad hoc markdown edits when the user is managing project todos.",
  "Claim tasks before working on them so parallel sessions do not overlap.",
  "Release tasks when handing off work or when you stop owning them.",
  "Close or mark todos done when the work is complete.",
];

/**
 * JSON schema for the shared `todo` tool parameters.
 *
 * Pi uses this structure to validate and present tool calls. The schema stays
 * intentionally small and maps directly to the executor actions.
 */
const TodoParams = Type.Object({
  action: StringEnum([
    "list",
    "list-all",
    "get",
    "create",
    "update",
    "append",
    "delete",
    "claim",
    "release",
  ]),
  id: Type.Optional(
    Type.String({ description: "Todo id (TODO-<hex> or raw hex filename)" }),
  ),
  title: Type.Optional(
    Type.String({ description: "Short summary shown in lists" }),
  ),
  status: Type.Optional(Type.String({ description: "Todo status" })),
  tags: Type.Optional(Type.Array(Type.String({ description: "Todo tag" }))),
  body: Type.Optional(
    Type.String({
      description:
        "Long-form details (markdown). Update replaces; append adds.",
    }),
  ),
  force: Type.Optional(
    Type.Boolean({ description: "Override another session's assignment" }),
  ),
});

export { buildRefinePrompt, buildWorkPrompt };

/**
 * Resolves the todos directory for the active workspace.
 *
 * Tool execution, session startup, and the command UI should all operate on the
 * same filesystem location, including any `PI_TODO_PATH` override.
 */
function getProjectTodosDir(ctx) {
  return getTodosDir(ctx.cwd);
}

/**
 * Extracts the runtime fields consumed by the todo executor.
 *
 * The executor only needs stable session metadata and a timestamp, not the full
 * Pi context object.
 */
function getToolRuntime(ctx) {
  return {
    sessionId: ctx.sessionManager?.getSessionId?.(),
    sessionFile: ctx.sessionManager?.getSessionFile?.(),
    hasUI: ctx.hasUI,
    now: new Date(),
  };
}

/**
 * Wraps one line of text in Pi's minimal renderable view shape.
 *
 * The tool call and result renderers often only need static text, so this
 * helper avoids duplicating the same tiny component contract.
 */
function createTextView(text) {
  return {
    render(width) {
      const lines = String(text ?? "").split(/\r?\n/);
      if (typeof width !== "number" || width < 1) return lines;
      return lines.map((line) => truncateToWidth(line, width));
    },
    invalidate() {},
  };
}

/**
 * Renders the compact label shown for a todo tool invocation.
 *
 * The UI should expose the action first, then optional id and title fragments,
 * so transcript scanning stays fast.
 */
function renderTodoToolCall(args, theme) {
  const parts = [
    theme.fg("toolTitle", theme.bold("todo ")),
    String(args?.action || ""),
  ];
  if (args?.id) parts.push(` ${args.id}`);
  if (args?.title) parts.push(` ${args.title}`);
  return createTextView(parts.join(""));
}

/**
 * Renders a concise summary for the tool result panel.
 *
 * Partial results stay intentionally terse, while completed mutations prefer a
 * canonical todo summary when a concrete todo object is available.
 */
function renderTodoToolResult(result, options, theme) {
  if (options?.isPartial)
    return createTextView(theme.fg("muted", "Working..."));
  const todo = result?.details?.todo;
  if (todo) return createTextView(`${todo.id} ${todo.title} [${todo.status}]`);
  const text =
    result?.content?.find?.((entry) => entry?.type === "text")?.text || "";
  return createTextView(text);
}

/**
 * Builds the fallback grouped summary for non-interactive runs.
 *
 * The plain terminal path mirrors the selector buckets so assigned, open, and
 * closed work remain easy to scan without the custom UI.
 */
function buildPlainSummary(todos) {
  const assigned = todos.filter(
    (todo) => todo.status === "open" && todo.assigned_to_session,
  );
  const open = todos.filter(
    (todo) => todo.status === "open" && !todo.assigned_to_session,
  );
  const closed = todos.filter((todo) => todo.status !== "open");
  const toLines = (label, items) =>
    [
      `${label} (${items.length}):`,
      ...(items.length
        ? items.map(
            (todo) =>
              ` ${todo.id.startsWith("TODO-") ? todo.id : `TODO-${todo.id}`} ${todo.title}`,
          )
        : [" none"]),
    ].join("\n");
  return [
    toLines("Assigned todos", assigned),
    toLines("Open todos", open),
    toLines("Closed todos", closed),
  ].join("\n\n");
}

/**
 * Registers the shared todo tool plus the interactive `/todos` command.
 *
 * On session start it ensures storage exists and applies garbage collection.
 * The command falls back to plain text outside the UI and otherwise opens the
 * selector, action menus, and detail overlay workflow.
 */
export default function registerTodos(pi) {
  pi.on("session_start", async (_event, ctx) => {
    const todosDir = getProjectTodosDir(ctx);
    await ensureTodosDir(todosDir);
    await garbageCollectTodos(
      todosDir,
      await readTodoSettings(todosDir),
      new Date(),
    );
  });

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description: TODO_TOOL_DESCRIPTION,
    promptSnippet: TODO_TOOL_PROMPT_SNIPPET,
    promptGuidelines: TODO_TOOL_PROMPT_GUIDELINES,
    parameters: TodoParams,
    renderCall: renderTodoToolCall,
    renderResult: renderTodoToolResult,
    async execute(_toolCallId, input, _signal, _onUpdate, ctx) {
      return createTodoExecutor({ todosDir: getProjectTodosDir(ctx) })(
        input,
        getToolRuntime(ctx),
      );
    },
  });

  pi.registerCommand("todos", {
    description: "List todos from .pi/todos",
    handler: async (args, ctx) => {
      const todosDir = getProjectTodosDir(ctx);
      const executor = createTodoExecutor({ todosDir });
      const currentSessionId = ctx.sessionManager?.getSessionId?.();
      const searchTerm = String(args || "").trim();
      const allTodos = await listTodos(todosDir);
      const refreshTodos = async () =>
        (await executor({ action: "list-all" }, getToolRuntime(ctx))).details
          .todos;

      if (!ctx.hasUI || !ctx.ui?.custom) {
        console.log(buildPlainSummary(filterTodos(allTodos, searchTerm)));
        return;
      }

      let nextPrompt = null;
      let pendingUiAction = Promise.resolve();
      await ctx.ui.custom((tui, theme, keybindings, done) => {
        let selector = null;
        let actionMenu = null;
        let deleteConfirm = null;
        let activeComponent = null;
        let wrapperFocused = false;

        const setActiveComponent = (component) => {
          if (activeComponent && "focused" in activeComponent)
            activeComponent.focused = false;
          activeComponent = component;
          if (activeComponent && "focused" in activeComponent)
            activeComponent.focused = wrapperFocused;
          tui.requestRender();
        };

        const resolveTodoRecord = async (todo) => {
          return (
            await executor({ action: "get", id: todo.id }, getToolRuntime(ctx))
          ).details.todo;
        };

        const openTodoOverlay = async (record) => {
          return (
            (await ctx.ui.custom(
              (overlayTui, overlayTheme, overlayKeybindings, overlayDone) =>
                new TodoDetailOverlayComponent(
                  overlayTui,
                  overlayTheme,
                  overlayKeybindings,
                  record,
                  overlayDone,
                ),
              {
                overlay: true,
                overlayOptions: {
                  width: "80%",
                  maxHeight: "80%",
                  anchor: "center",
                },
              },
            )) || "back"
          );
        };

        const applyTodoAction = async (record, action) => {
          if (action === "refine") {
            nextPrompt = buildRefinePrompt(
              record.id,
              record.title || "(untitled)",
            );
            done();
            return "exit";
          }
          if (action === "work") {
            nextPrompt = buildWorkPrompt(
              record.id,
              record.title || "(untitled)",
            );
            done();
            return "exit";
          }
          if (action === "view") return "stay";
          if (action === "release") {
            await executor(
              { action: "release", id: record.id, force: true },
              getToolRuntime(ctx),
            );
            selector?.setTodos(await refreshTodos());
            ctx.ui.notify(`Released TODO-${record.id}`, "info");
            return "stay";
          }
          if (action === "delete") {
            await executor(
              { action: "delete", id: record.id },
              getToolRuntime(ctx),
            );
            selector?.setTodos(await refreshTodos());
            ctx.ui.notify(`Deleted TODO-${record.id}`, "info");
            return "stay";
          }
          const nextStatus = action === "close" ? "closed" : "open";
          await executor(
            { action: "update", id: record.id, status: nextStatus },
            getToolRuntime(ctx),
          );
          selector?.setTodos(await refreshTodos());
          ctx.ui.notify(
            `${action === "close" ? "Closed" : "Reopened"} TODO-${record.id}`,
            "info",
          );
          return "stay";
        };

        const handleActionSelection = async (record, action) => {
          if (action === "view") {
            const overlayAction = await openTodoOverlay(record);
            if (overlayAction === "work") {
              await applyTodoAction(record, "work");
              return;
            }
            if (overlayAction === "refine") {
              await applyTodoAction(record, "refine");
              return;
            }
            if (actionMenu) setActiveComponent(actionMenu);
            return;
          }

          if (action === "delete") {
            deleteConfirm = new TodoDeleteConfirmComponent(
              theme,
              `Delete todo TODO-${record.id}? This cannot be undone.`,
              (confirmed) => {
                if (!confirmed) {
                  setActiveComponent(actionMenu);
                  return;
                }
                pendingUiAction = (async () => {
                  await applyTodoAction(record, "delete");
                  setActiveComponent(selector);
                })();
              },
            );
            setActiveComponent(deleteConfirm);
            return;
          }

          const result = await applyTodoAction(record, action);
          if (result === "stay") setActiveComponent(selector);
        };

        const handleSelect = async (todo) => {
          const record = await resolveTodoRecord(todo);
          actionMenu = new TodoActionMenuComponent(
            theme,
            record,
            (action) => {
              pendingUiAction = handleActionSelection(record, action);
            },
            () => setActiveComponent(selector),
          );
          setActiveComponent(actionMenu);
        };

        selector = new TodoSelectorComponent(
          tui,
          theme,
          keybindings,
          filterTodos(allTodos, searchTerm),
          (todo) => {
            void handleSelect(todo);
          },
          () => done(),
          searchTerm || undefined,
          currentSessionId,
          (todo, action) => {
            nextPrompt = quickActionPrompt(todo, action);
            done();
          },
        );

        setActiveComponent(selector);

        return {
          get focused() {
            return wrapperFocused;
          },
          set focused(value) {
            wrapperFocused = value;
            if (activeComponent && "focused" in activeComponent)
              activeComponent.focused = value;
          },
          getSearchValue() {
            return selector?.getSearchValue?.();
          },
          render(width) {
            return activeComponent ? activeComponent.render(width) : [];
          },
          invalidate() {
            activeComponent?.invalidate?.();
          },
          handleInput(data) {
            return activeComponent?.handleInput?.(data);
          },
        };
      });

      await pendingUiAction;
      if (nextPrompt) ctx.ui.setEditorText(nextPrompt);
    },
  });
}
