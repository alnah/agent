import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  isClosedStatus,
  parseFrontMatter,
  parseTodoContent,
  serializeTodo,
  sortTodos,
  splitFrontMatter,
  validateTodoId,
} from "./parsing.ts";

const TODO_FILE_SUFFIX = ".md";
const TODO_MARKDOWN_FILE_RE = /^[a-f0-9]{8}\.md$/;
const SETTINGS_FILE = "settings.json";
const DEFAULT_TODO_SETTINGS = Object.freeze({ gc: true, gcDays: 7 });

/**
 * Detects filesystem "not found" errors.
 *
 * Storage helpers treat missing directories and files as normal absence rather
 * than exceptional corruption.
 */
function isEnoent(error) {
  return Boolean(error && error.code === "ENOENT");
}

/**
 * Normalizes persisted todo settings into the supported shape.
 *
 * Invalid or partial JSON should still yield safe defaults for garbage
 * collection behavior.
 */
function normalizeTodoSettings(parsed) {
  return {
    gc: typeof parsed?.gc === "boolean" ? parsed.gc : DEFAULT_TODO_SETTINGS.gc,
    gcDays: Math.max(
      0,
      Math.floor(
        Number.isFinite(parsed?.gcDays)
          ? parsed.gcDays
          : DEFAULT_TODO_SETTINGS.gcDays,
      ),
    ),
  };
}

/**
 * Reports whether a directory entry is a canonical todo markdown file.
 *
 * Settings files, lock files, and macOS AppleDouble sidecars can share the
 * directory, so listing logic accepts only eight-lowercase-hex markdown names.
 */
function isTodoMarkdownFile(fileName) {
  return TODO_MARKDOWN_FILE_RE.test(fileName);
}

/**
 * Extracts the raw todo id from a markdown file name.
 *
 * Callers already filtered by suffix, so the function only strips the trailing
 * `.md` extension.
 */
function todoIdFromFileName(fileName) {
  return fileName.slice(0, -TODO_FILE_SUFFIX.length);
}

/**
 * Parses just the front matter from a todo file payload.
 *
 * List views only need lightweight metadata and should avoid parsing the full
 * body when possible.
 */
function parseTodoFrontMatterText(text, fallbackId) {
  const { frontMatter } = splitFrontMatter(text);
  return parseFrontMatter(frontMatter, fallbackId);
}

/**
 * Reads a todo file and returns only its front matter metadata.
 *
 * This async path is used by directory scans that build the todo list.
 */
async function readTodoFrontMatter(filePath, fallbackId) {
  return parseTodoFrontMatterText(
    await fs.readFile(filePath, "utf8"),
    fallbackId,
  );
}

/**
 * Synchronously reads only the front matter from a todo file.
 *
 * Tests and synchronous consumers share the same parsing logic as the async
 * list path.
 */
function readTodoFrontMatterSync(filePath, fallbackId) {
  return parseTodoFrontMatterText(
    fsSync.readFileSync(filePath, "utf8"),
    fallbackId,
  );
}

/**
 * Ensures the todos directory exists.
 *
 * Most entry points can safely call this unconditionally before reading or
 * writing todo files.
 */
export async function ensureTodosDir(todosDir) {
  await fs.mkdir(todosDir, { recursive: true });
  return todosDir;
}

/**
 * Resolves the markdown file path for a todo id.
 *
 * The id is validated first so path construction stays inside the todos
 * directory.
 */
export function getTodoPath(todosDir, id) {
  return path.join(todosDir, `${validateTodoId(id)}${TODO_FILE_SUFFIX}`);
}

/**
 * Reads persisted settings for the todos directory.
 *
 * Missing or malformed settings fall back to the default garbage collection
 * policy instead of failing the whole extension.
 */
export async function readTodoSettings(todosDir) {
  try {
    const text = await fs.readFile(path.join(todosDir, SETTINGS_FILE), "utf8");
    return normalizeTodoSettings(JSON.parse(text));
  } catch {
    return DEFAULT_TODO_SETTINGS;
  }
}

/**
 * Lists todos asynchronously using front matter only.
 *
 * Missing directories behave like an empty todo set. Returned todos are always
 * sorted into the canonical presentation order.
 */
export async function listTodos(todosDir) {
  try {
    const entries = await fs.readdir(todosDir, { withFileTypes: true });
    const todos = [];
    for (const entry of entries) {
      if (!entry.isFile() || !isTodoMarkdownFile(entry.name)) continue;
      const fallbackId = todoIdFromFileName(entry.name);
      todos.push(
        await readTodoFrontMatter(path.join(todosDir, entry.name), fallbackId),
      );
    }
    return sortTodos(todos);
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
}

/**
 * Lists todos synchronously using front matter only.
 *
 * This mirrors `listTodos()` for consumers that cannot use the async API.
 */
export function listTodosSync(todosDir) {
  try {
    const entries = fsSync.readdirSync(todosDir, { withFileTypes: true });
    const todos = [];
    for (const entry of entries) {
      if (!entry.isFile() || !isTodoMarkdownFile(entry.name)) continue;
      const fallbackId = todoIdFromFileName(entry.name);
      todos.push(
        readTodoFrontMatterSync(path.join(todosDir, entry.name), fallbackId),
      );
    }
    return sortTodos(todos);
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
}

/**
 * Reads and parses the full todo document.
 *
 * Unlike list helpers, this path returns the markdown body together with the
 * metadata.
 */
export async function readTodoFile(filePath, fallbackId) {
  return parseTodoContent(await fs.readFile(filePath, "utf8"), fallbackId);
}

/**
 * Returns the parsed todo when the file exists.
 *
 * Missing todo files map to `null` so callers can distinguish absence from real
 * IO failures.
 */
export async function ensureTodoExists(filePath, fallbackId) {
  try {
    return await readTodoFile(filePath, fallbackId);
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

/**
 * Writes one todo document to disk.
 *
 * Parent directories are created on demand and serialization is delegated to
 * the canonical parser module.
 */
export async function writeTodoFile(filePath, todo) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serializeTodo(todo), "utf8");
  return filePath;
}

/**
 * Deletes old closed todos according to the current settings.
 *
 * Only closed items older than the configured retention window are removed, and
 * the function returns the ids that were deleted.
 */
export async function garbageCollectTodos(
  todosDir,
  settings,
  now = new Date(),
) {
  if (!settings?.gc) return [];
  const cutoffMs =
    now.getTime() - Math.max(0, settings.gcDays) * 24 * 60 * 60 * 1000;
  const removed = [];

  for (const todo of await listTodos(todosDir)) {
    if (!isClosedStatus(todo.status)) continue;
    const createdMs = Date.parse(todo.created_at || "");
    if (!Number.isFinite(createdMs) || createdMs > cutoffMs) continue;
    await fs.rm(getTodoPath(todosDir, todo.id), { force: true });
    removed.push(todo.id);
  }

  return removed;
}
