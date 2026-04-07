import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  formatTodoId,
  getTodosDir,
  isClosedStatus,
  validateTodoId,
} from "./parsing.ts";
import {
  ensureTodoExists,
  ensureTodosDir,
  garbageCollectTodos,
  getTodoPath,
  listTodos,
  readTodoFile,
  readTodoSettings,
  writeTodoFile,
} from "./storage.ts";

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;
const TODO_OUTPUT_PREFIX = "todo-output-";

type TodoRuntime = {
  sessionId?: string;
  sessionFile?: string;
  hasUI?: boolean;
  now?: Date;
};

type QueueFileMutation = <T>(
  targetPath: string,
  work: () => Promise<T>,
) => Promise<T>;

type TodoExecutorOptions = {
  todosDir: string;
  queueFileMutation?: QueueFileMutation;
  tempDir?: string;
};

/**
 * Provides the default mutation queue implementation.
 *
 * The executor can be wrapped by a real file-serialization layer in tests or
 * future integrations, but the default behavior runs the work immediately.
 */
function defaultQueueFileMutation<T>(
  _targetPath: string,
  work: () => Promise<T>,
): Promise<T> {
  return Promise.resolve().then(work);
}

/**
 * Normalizes runtime metadata passed to the executor.
 *
 * Tool calls can come from different Pi surfaces, so this helper collapses the
 * optional runtime fields into one predictable shape.
 */
function makeRuntimeContext(runtime: TodoRuntime = {}) {
  return {
    sessionId: runtime.sessionId,
    sessionFile: runtime.sessionFile,
    hasUI: Boolean(runtime.hasUI),
    now: runtime.now instanceof Date ? runtime.now : new Date(),
  };
}

/**
 * Derives the best available session identifier.
 *
 * Claim and release operations need a stable assignment string even when only a
 * subset of session metadata is available.
 */
function ensureSessionId(runtime: TodoRuntime) {
  return runtime.sessionId || runtime.sessionFile || "unknown-session";
}

/**
 * Cleans body text supplied by tool input.
 *
 * Mutations should not preserve accidental leading blank lines or trailing
 * whitespace from user prompts.
 */
function cleanBodyInput(body) {
  return typeof body === "string"
    ? body.replace(/^\n+/, "").replace(/\s+$/, "")
    : "";
}

/**
 * Filters an arbitrary value down to a string array.
 *
 * Tool parameters are loosely typed at runtime, so tag handling strips out any
 * non-string entries before persistence.
 */
function filterStringList(values) {
  return Array.isArray(values)
    ? values.filter((value) => typeof value === "string")
    : [];
}

/**
 * Appends a markdown fragment to an existing todo body.
 *
 * The helper keeps exactly one blank line between existing and new content and
 * preserves the original body unchanged when the addition is empty.
 */
function appendBody(existingBody, addition) {
  const left = String(existingBody || "").replace(/\s+$/, "");
  const right = cleanBodyInput(addition);
  if (!right) return existingBody;
  return left ? `${left}\n\n${right}\n` : `${right}\n`;
}

/**
 * Builds the short human-readable todo label used in responses.
 *
 * Result text consistently includes the formatted id and title when present.
 */
function summarizeTodo(todo) {
  return `${formatTodoId(todo.id)} ${todo.title}`.trim();
}

/**
 * Allocates an unused random todo id.
 *
 * The executor retries several times against the filesystem before giving up so
 * id collisions remain extremely unlikely without hiding persistent failures.
 */
async function createUniqueTodoId(todosDir) {
  for (let i = 0; i < 32; i += 1) {
    const id = crypto.randomBytes(4).toString("hex");
    const existing = await ensureTodoExists(getTodoPath(todosDir, id), id);
    if (!existing) return id;
  }
  throw new Error("Unable to allocate a unique todo id");
}

/**
 * Writes oversized tool output to a temporary file.
 *
 * Large `get` results follow the same truncation contract as other Pi tools by
 * persisting the full payload outside the transcript.
 */
async function writeTempOutput(text, tempDir) {
  const baseDir = tempDir || os.tmpdir();
  await fs.mkdir(baseDir, { recursive: true });
  const filePath = path.join(
    baseDir,
    `${TODO_OUTPUT_PREFIX}${crypto.randomUUID()}.txt`,
  );
  await fs.writeFile(filePath, text, "utf8");
  return filePath;
}

/**
 * Truncates text to Pi-style transcript limits when needed.
 *
 * The function enforces both line and byte caps. When truncation happens it
 * saves the full content to a temp file and returns its location.
 */
async function maybeTruncateText(text, tempDir) {
  const lines = String(text).split("\n");
  const withinLines =
    lines.length <= MAX_LINES ? lines : lines.slice(0, MAX_LINES);
  let output = withinLines.join("\n");
  let truncated = lines.length > MAX_LINES;
  if (Buffer.byteLength(output, "utf8") > MAX_BYTES) {
    truncated = true;
    output = Buffer.from(output, "utf8")
      .subarray(0, MAX_BYTES)
      .toString("utf8");
  }
  if (!truncated) return { text: output, truncation: undefined };
  const filePath = await writeTempOutput(text, tempDir);
  return {
    text: `${output}\n\n[Output truncated: ${Math.min(lines.length, MAX_LINES)} of ${lines.length} lines. Full output saved to: ${filePath}]`,
    truncation: { filePath },
  };
}

/**
 * Formats the text body for list operations.
 *
 * Empty results use a dedicated message instead of returning a blank string.
 */
function formatListText(todos) {
  return todos.length
    ? todos.map((todo) => `- ${formatTodoId(todo.id)} ${todo.title}`).join("\n")
    : "No todos.";
}

/**
 * Builds the standard tool result envelope.
 *
 * Every action returns text content plus structured details so both humans and
 * callers can consume the outcome.
 */
function makeResult(action, text, details) {
  return {
    content: [{ type: "text", text }],
    details: { action, ...details },
  };
}

/**
 * Loads a todo or throws a consistent not-found error.
 *
 * Mutation paths all need the same missing-todo behavior and error wording.
 */
async function requireTodo(filePath, id) {
  const todo = await ensureTodoExists(filePath, id);
  if (!todo) throw new Error(`Todo ${formatTodoId(id)} not found`);
  return todo;
}

/**
 * Runs one todo file mutation through the configured queue.
 *
 * The queue abstraction lets tests and future runtimes serialize conflicting
 * writes while keeping the executor logic straightforward.
 */
async function mutateTodoFile<T>(
  queueFileMutation: QueueFileMutation,
  filePath: string,
  work: () => Promise<T>,
): Promise<T> {
  let result: { value: T } | null = null;
  await queueFileMutation(filePath, async () => {
    result = { value: await work() };
  });
  if (!result) {
    throw new Error(`Todo mutation produced no result for ${filePath}`);
  }
  return result.value;
}

/**
 * Creates the todo tool executor bound to one storage directory.
 *
 * The returned function handles listing, reading, creating, mutating, claiming,
 * releasing, deleting, and garbage-collecting todos. It normalizes runtime
 * context up front and returns a structured result for every successful action.
 */
export function createTodoExecutor(options: TodoExecutorOptions) {
  const todosDir = options.todosDir;
  const queueFileMutation =
    options.queueFileMutation || defaultQueueFileMutation;
  const tempDir = options.tempDir;

  if (!todosDir) throw new Error("todosDir required");

  return async function execute(input, runtimeInput = {}) {
    const runtime = makeRuntimeContext(runtimeInput);
    await ensureTodosDir(todosDir);
    const action = String(input?.action || "");

    if (action === "list" || action === "list-all") {
      const todos = await listTodos(todosDir);
      const visible =
        action === "list"
          ? todos.filter((todo) => !isClosedStatus(todo.status))
          : todos;
      return makeResult(action, formatListText(visible), {
        todos: visible,
        currentSessionId: runtime.sessionId,
      });
    }

    if (action === "get") {
      const id = validateTodoId(input.id);
      const todo = await requireTodo(getTodoPath(todosDir, id), id);
      const fullText = JSON.stringify(todo, null, 2);
      const { text, truncation } = await maybeTruncateText(fullText, tempDir);
      return makeResult(
        action,
        truncation ? text.replace(/^\{[\s\S]*?\n\n?/, "") : text,
        {
          todo,
          truncation,
        },
      );
    }

    if (action === "create") {
      const title = typeof input.title === "string" ? input.title.trim() : "";
      if (!title) throw new Error("title required");
      const id = await createUniqueTodoId(todosDir);
      const todo = {
        id,
        title,
        tags: filterStringList(input.tags),
        status:
          input.status === "closed" || input.status === "done"
            ? input.status
            : "open",
        created_at: runtime.now.toISOString(),
        body: cleanBodyInput(input.body),
      };
      const filePath = getTodoPath(todosDir, id);
      await mutateTodoFile(queueFileMutation, filePath, async () => {
        await writeTodoFile(filePath, todo);
      });
      return makeResult(action, `Created ${summarizeTodo(todo)}`, { todo });
    }

    const id = validateTodoId(input.id);
    const filePath = getTodoPath(todosDir, id);

    if (action === "update") {
      const updated = await mutateTodoFile(
        queueFileMutation,
        filePath,
        async () => {
          const current = await requireTodo(filePath, id);
          const nextTodo = {
            ...current,
            title:
              typeof input.title === "string" ? input.title : current.title,
            tags: Array.isArray(input.tags)
              ? filterStringList(input.tags)
              : current.tags,
            status:
              typeof input.status === "string" ? input.status : current.status,
            body:
              typeof input.body === "string"
                ? cleanBodyInput(input.body)
                : current.body.replace(/\s+$/, ""),
          };
          if (isClosedStatus(nextTodo.status))
            nextTodo.assigned_to_session = undefined;
          await writeTodoFile(filePath, nextTodo);
          return nextTodo;
        },
      );
      return makeResult(action, `Updated ${formatTodoId(id)}`, {
        todo: updated,
      });
    }

    if (action === "append") {
      const todo = await mutateTodoFile(
        queueFileMutation,
        filePath,
        async () => {
          const current = await requireTodo(filePath, id);
          const nextBody = appendBody(current.body, input.body);
          if (nextBody === current.body) return current;
          await writeTodoFile(filePath, { ...current, body: nextBody });
          return readTodoFile(filePath, id);
        },
      );
      return makeResult(action, `Appended to ${formatTodoId(id)}`, { todo });
    }

    if (action === "claim") {
      const todo = await mutateTodoFile(
        queueFileMutation,
        filePath,
        async () => {
          const current = await requireTodo(filePath, id);
          if (isClosedStatus(current.status))
            throw new Error(`Todo ${formatTodoId(id)} is closed`);
          const sessionId = ensureSessionId(runtime);
          if (
            current.assigned_to_session &&
            current.assigned_to_session !== sessionId &&
            !input.force
          ) {
            throw new Error(
              `Todo ${formatTodoId(id)} is already assigned to session ${current.assigned_to_session}`,
            );
          }
          const nextTodo = { ...current, assigned_to_session: sessionId };
          await writeTodoFile(filePath, nextTodo);
          return nextTodo;
        },
      );
      return makeResult(action, `Claimed ${formatTodoId(id)}`, { todo });
    }

    if (action === "release") {
      const todo = await mutateTodoFile(
        queueFileMutation,
        filePath,
        async () => {
          const current = await requireTodo(filePath, id);
          const sessionId = ensureSessionId(runtime);
          if (
            current.assigned_to_session &&
            current.assigned_to_session !== sessionId &&
            !input.force
          ) {
            throw new Error(
              `Todo ${formatTodoId(id)} is assigned to session ${current.assigned_to_session}; use force to release it.`,
            );
          }
          const nextTodo = { ...current, assigned_to_session: undefined };
          await writeTodoFile(filePath, nextTodo);
          return nextTodo;
        },
      );
      return makeResult(action, `Released ${formatTodoId(id)}`, { todo });
    }

    if (action === "delete") {
      const todo = await mutateTodoFile(
        queueFileMutation,
        filePath,
        async () => {
          const current = await requireTodo(filePath, id);
          await fs.rm(filePath, { force: true });
          return current;
        },
      );
      return makeResult(action, `Deleted ${formatTodoId(id)}`, { todo });
    }

    if (action === "gc") {
      const settings = await readTodoSettings(todosDir);
      const removed = await garbageCollectTodos(
        todosDir,
        settings,
        runtime.now,
      );
      return makeResult(
        action,
        removed.length
          ? `Removed ${removed.length} todos.`
          : "No todos removed.",
        { removed },
      );
    }

    throw new Error(`Unknown action: ${action}`);
  };
}

export { getTodosDir };
