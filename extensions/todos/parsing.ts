import path from "node:path";

const TODO_ID_RE = /^[a-f0-9]{8}$/;
const CLOSED_STATUSES = new Set(["closed", "done"]);
const DEFAULT_TODOS_DIR = ".pi/todos";
const DEFAULT_TODO_STATUS = "open";

/**
 * Trims a value only when it is already a string.
 *
 * Parsing helpers accept loose input from JSON and front matter, so they need
 * a small coercion-free primitive that treats non-strings as empty.
 */
function toTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Converts optional text fields into either a trimmed string or `undefined`.
 *
 * Blank strings are semantically equivalent to an omitted value for todo
 * metadata such as session assignment.
 */
function toOptionalString(value) {
  const text = toTrimmedString(value);
  return text || undefined;
}

/**
 * Normalizes a todo body before serialization.
 *
 * Stored markdown should not accumulate leading blank lines or trailing
 * whitespace noise across repeated writes.
 */
function trimTodoBody(body) {
  return typeof body === "string"
    ? body.replace(/^\n+/, "").replace(/\s+$/, "")
    : "";
}

/**
 * Removes the separator immediately after parsed front matter.
 *
 * Todo files may use either LF or CRLF newlines, and the body should start at
 * the first meaningful content line rather than with an empty spacer.
 */
function stripFrontMatterBodySeparator(body) {
  if (body.startsWith("\r\n\r\n")) return body.slice(4);
  if (body.startsWith("\n\n")) return body.slice(2);
  if (body.startsWith("\r\n")) return body.slice(2);
  if (body.startsWith("\n")) return body.slice(1);
  return body;
}

/**
 * Resolves the absolute todos directory for a workspace.
 *
 * `PI_TODO_PATH` can override the default relative location, but blank values
 * still fall back to `.pi/todos`.
 */
export function getTodosDir(cwd) {
  const relative = process.env.PI_TODO_PATH;
  return path.resolve(cwd, relative?.trim() ? relative : DEFAULT_TODOS_DIR);
}

/**
 * Normalizes user-facing todo ids into the canonical raw form.
 *
 * The tool accepts `#id`, `TODO-id`, and mixed-case inputs, but storage and
 * validation operate on lowercase eight-character hex ids.
 */
export function normalizeTodoId(value) {
  if (value == null) return "";
  let text = String(value).trim().toLowerCase();
  if (text.startsWith("#")) text = text.slice(1).trim();
  if (text.startsWith("todo-")) text = text.slice(5);
  return text;
}

/**
 * Formats a todo id for display.
 *
 * The persisted id stays compact, while CLI and UI output use the clearer
 * `TODO-xxxxxxxx` prefix.
 */
export function formatTodoId(value) {
  return `TODO-${normalizeTodoId(value)}`;
}

/**
 * Validates and returns the canonical todo id.
 *
 * Every storage path and mutation route should reject malformed ids early so
 * files cannot escape the todos directory or collide unexpectedly.
 */
export function validateTodoId(value) {
  const normalized = normalizeTodoId(value);
  if (!TODO_ID_RE.test(normalized))
    throw new Error(`Invalid todo id: ${value}`);
  return normalized;
}

/**
 * Reports whether a status represents closed work.
 *
 * Both `closed` and `done` remove the todo from active assignment flows, so
 * callers share one predicate instead of duplicating string checks.
 */
export function isClosedStatus(status) {
  return CLOSED_STATUSES.has(String(status || "").toLowerCase());
}

/**
 * Finds the end offset of the first top-level JSON object in text.
 *
 * Todo front matter is stored as JSON and may contain nested braces or quoted
 * strings. This scanner tracks depth and string escaping without parsing the
 * body that follows.
 */
export function findJsonObjectEnd(content) {
  const text = String(content ?? "");
  if (!text.startsWith("{")) return -1;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Locates the first non-empty line that could contain front matter.
 *
 * Files may start with a BOM or leading blank lines, and those should not stop
 * front-matter detection.
 */
function findFrontMatterStartIndex(text) {
  let index = 0;
  if (text.charCodeAt(0) === 0xfeff) index += 1;

  while (index < text.length) {
    let cursor = index;
    while (
      cursor < text.length &&
      (text[cursor] === " " || text[cursor] === "\t" || text[cursor] === "\r")
    ) {
      cursor += 1;
    }
    if (text[cursor] === "\n") {
      index = cursor + 1;
      continue;
    }
    break;
  }

  return index;
}

/**
 * Splits a todo file into JSON front matter and markdown body.
 *
 * Malformed or missing front matter should not throw. In those cases the whole
 * file is treated as body text and the front matter is reported as empty.
 */
export function splitFrontMatter(content) {
  const text = String(content ?? "");
  const start = findFrontMatterStartIndex(text);
  const candidate = text.slice(start);
  if (!candidate.startsWith("{")) return { frontMatter: "", body: text };
  const end = findJsonObjectEnd(candidate);
  if (end === -1) return { frontMatter: "", body: text };
  const frontMatter = candidate.slice(0, end + 1);
  const body = stripFrontMatterBodySeparator(candidate.slice(end + 1));
  return { frontMatter, body };
}

/**
 * Normalizes tag arrays from untrusted metadata.
 *
 * Only trimmed non-empty strings survive so search and serialization operate on
 * a predictable tag list.
 */
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Collapses arbitrary status input to a supported todo status.
 *
 * Unknown values quietly fall back to `open` so malformed front matter does not
 * break the rest of the toolchain.
 */
function normalizeStatus(status) {
  const value = String(status || DEFAULT_TODO_STATUS).toLowerCase();
  return value === "open" || value === "closed" || value === "done"
    ? value
    : DEFAULT_TODO_STATUS;
}

/**
 * Parses todo metadata from the JSON front matter block.
 *
 * Invalid JSON degrades to defaults, but the fallback id is still validated so
 * the resulting todo record always has a safe canonical id.
 */
export function parseFrontMatter(frontMatter, fallbackId) {
  const safeId = validateTodoId(fallbackId);
  let parsed: unknown;
  try {
    parsed = frontMatter ? JSON.parse(frontMatter) : {};
  } catch {
    parsed = {};
  }
  const payload =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};

  let id = safeId;
  const candidateId = normalizeTodoId(payload.id);
  if (TODO_ID_RE.test(candidateId)) id = candidateId;

  return {
    id,
    title: typeof payload.title === "string" ? payload.title : "",
    tags: normalizeTags(payload.tags),
    status: normalizeStatus(payload.status),
    created_at:
      typeof payload.created_at === "string" ? payload.created_at : "",
    assigned_to_session: toOptionalString(payload.assigned_to_session),
  };
}

/**
 * Parses a full todo document into canonical metadata plus body text.
 *
 * Closed todos cannot remain assigned, so the assignment field is cleared after
 * parsing when the status indicates completed work.
 */
export function parseTodoContent(content, fallbackId) {
  const { frontMatter, body } = splitFrontMatter(String(content ?? ""));
  const todo = parseFrontMatter(frontMatter, fallbackId);
  if (isClosedStatus(todo.status)) todo.assigned_to_session = undefined;
  return {
    ...todo,
    body,
  };
}

/**
 * Normalizes a todo before writing it back to disk.
 *
 * Serialization should emit one stable shape regardless of which mutation path
 * produced the todo object.
 */
function canonicalTodo(todo) {
  const status = normalizeStatus(todo.status);
  const assigned = isClosedStatus(status)
    ? undefined
    : toOptionalString(todo.assigned_to_session);
  return {
    id: validateTodoId(todo.id),
    title: typeof todo.title === "string" ? todo.title : "",
    tags: normalizeTags(todo.tags),
    status,
    created_at: typeof todo.created_at === "string" ? todo.created_at : "",
    assigned_to_session: assigned,
    body: typeof todo.body === "string" ? todo.body : "",
  };
}

/**
 * Serializes a todo to the on-disk markdown format.
 *
 * The file always starts with pretty-printed JSON front matter. The body is
 * trimmed into a stable form and omitted entirely when empty.
 */
export function serializeTodo(input) {
  const todo = canonicalTodo(input);
  const frontMatter: {
    id: string;
    title: string;
    tags: string[];
    status: string;
    created_at: string;
    assigned_to_session?: string;
  } = {
    id: todo.id,
    title: todo.title,
    tags: todo.tags,
    status: todo.status,
    created_at: todo.created_at,
  };
  if (todo.assigned_to_session)
    frontMatter.assigned_to_session = todo.assigned_to_session;

  const body = trimTodoBody(todo.body);
  const serialized = JSON.stringify(frontMatter, null, 2);
  return body ? `${serialized}\n\n${body}\n` : `${serialized}\n`;
}

/**
 * Computes the primary sort bucket for a todo.
 *
 * Assigned open work should appear before unassigned open work, with closed
 * items grouped last.
 */
function todoSortBucket(todo) {
  if (todo.status === "open" && todo.assigned_to_session) return 0;
  if (todo.status === "open") return 1;
  return 2;
}

/**
 * Sorts todos into a stable presentation order.
 *
 * The order favors active assigned work first, then other open todos, then
 * closed ones. Ties are broken by creation timestamp and finally id.
 */
export function sortTodos(todos) {
  return [...todos].sort((a, b) => {
    const bucketDiff = todoSortBucket(a) - todoSortBucket(b);
    if (bucketDiff !== 0) return bucketDiff;
    const timeA = typeof a.created_at === "string" ? a.created_at : "";
    const timeB = typeof b.created_at === "string" ? b.created_at : "";
    if (timeA !== timeB) return timeA.localeCompare(timeB);
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Filters todos with case-insensitive token matching.
 *
 * Every query token must appear in the synthesized search haystack built from
 * ids, titles, tags, status, and assignment metadata.
 */
export function filterTodos(todos, query) {
  const tokens = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [...todos];
  return todos.filter((todo) => {
    const haystack = [
      todo.id,
      formatTodoId(todo.id),
      todo.title,
      ...(Array.isArray(todo.tags) ? todo.tags : []),
      todo.status,
      todo.assigned_to_session,
      todo.assigned_to_session ? `assigned:${todo.assigned_to_session}` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}
