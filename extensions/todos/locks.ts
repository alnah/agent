import fs from "node:fs/promises";
import path from "node:path";

import { validateTodoId } from "./parsing.ts";

export const LOCK_TTL_MS = 10 * 60 * 1000;

type LockOptions = {
  sessionFile?: string;
  now?: Date;
  hasUI?: boolean;
  confirm?: (title: string, message: string) => Promise<boolean>;
};

/**
 * Resolves the lock file path for one todo id.
 *
 * Lock files live beside the markdown todos so concurrent processes can guard
 * access without any extra coordination service.
 */
export function getLockPath(todosDir, id) {
  return path.join(todosDir, `${validateTodoId(id)}.lock.json`);
}

/**
 * Serializes the metadata written into a lock file.
 *
 * The payload records the owning session, process id, and acquisition time so
 * stale-lock handling can explain who last held the lock.
 */
function buildLockPayload(id: string, options: LockOptions) {
  return `${JSON.stringify(
    {
      id: validateTodoId(id),
      session: options.sessionFile || undefined,
      pid: process.pid,
      acquiredAt: (options.now instanceof Date
        ? options.now
        : new Date()
      ).toISOString(),
    },
    null,
    2,
  )}\n`;
}

/**
 * Reads lock metadata together with the file timestamps.
 *
 * Corrupt JSON should not prevent stale-lock recovery, so invalid payloads are
 * treated as empty metadata while the file stats remain available.
 */
async function readLockInfo(lockPath) {
  const [raw, stats] = await Promise.all([
    fs.readFile(lockPath, "utf8"),
    fs.stat(lockPath),
  ]);
  let info: unknown;
  try {
    info = JSON.parse(raw);
  } catch {
    info = {};
  }
  const payload =
    info && typeof info === "object" ? (info as Record<string, unknown>) : {};
  return { info: payload, stats };
}

/**
 * Acquires the filesystem lock for one todo.
 *
 * It creates the lock file atomically, rejects active locks, and allows stale
 * locks to be stolen only when interactive confirmation is available. The
 * returned function releases the acquired lock.
 */
export async function acquireLock(
  todosDir: string,
  id: string,
  options: LockOptions = {},
) {
  await fs.mkdir(todosDir, { recursive: true });
  const lockPath = getLockPath(todosDir, id);
  const payload = buildLockPayload(id, options);

  try {
    await fs.writeFile(lockPath, payload, { flag: "wx" });
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;

    const { info, stats } = await readLockInfo(lockPath);
    const nowMs = (
      options.now instanceof Date ? options.now : new Date()
    ).getTime();
    const ageMs = Math.max(0, nowMs - stats.mtimeMs);
    const sessionText = info.session ? ` by session ${info.session}` : "";

    if (ageMs <= LOCK_TTL_MS) {
      throw new Error(`Todo ${validateTodoId(id)} is locked${sessionText}.`);
    }

    if (!options.hasUI) {
      throw new Error(
        `Todo ${validateTodoId(id)} has a stale lock${sessionText}; rerun in interactive mode to steal it.`,
      );
    }

    const confirmed =
      typeof options.confirm === "function"
        ? await options.confirm(
            "Todo locked",
            `Todo ${validateTodoId(id)} is locked${sessionText}. The lock looks stale. Steal the lock?`,
          )
        : false;

    if (!confirmed) {
      throw new Error(`Todo ${validateTodoId(id)} remains locked.`);
    }

    await fs.writeFile(lockPath, payload, "utf8");
  }

  return async function release() {
    await fs.rm(lockPath, { force: true });
  };
}

/**
 * Runs one async operation while holding the todo lock.
 *
 * The helper centralizes the acquire/finally-release pattern so callers do not
 * leak locks when their work throws.
 */
export async function withTodoLock<T>(
  todosDir: string,
  id: string,
  options: LockOptions,
  work: () => Promise<T>,
): Promise<T> {
  const release = await acquireLock(todosDir, id, options);
  try {
    return await work();
  } finally {
    await release();
  }
}
