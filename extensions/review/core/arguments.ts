/**
 * Review command argument parsing.
 *
 * Parses `/review` subcommands and the optional `--extra` instruction without
 * changing the current command-line UX.
 */

import type { ReviewTarget } from "./targets.ts";

/**
 * Parsed `/review` arguments.
 *
 * PR references are kept as a lightweight marker because checkout requires async
 * GitHub calls that happen later in the command flow.
 */
export type ParsedReviewArgs = {
  target: ReviewTarget | { type: "pr"; ref: string } | null;
  extraInstruction?: string;
  error?: string;
};

/**
 * Splits review command arguments while preserving quoted values.
 */
function tokenizeArgs(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];

    if (quote) {
      if (char === "\\" && i + 1 < value.length) {
        current += value[i + 1];
        i += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Splits folder-review input on any whitespace and drops blank entries.
 */
export function parseReviewPaths(value: string): string[] {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Parses direct `/review` invocation arguments.
 *
 * Returns `target: null` for empty or incomplete input so the caller can fall
 * back to the interactive selector.
 */
export function parseArgs(args: string | undefined): ParsedReviewArgs {
  if (!args?.trim()) return { target: null };

  const rawParts = tokenizeArgs(args.trim());
  const parts: string[] = [];
  let extraInstruction: string | undefined;

  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i];
    if (part === "--extra") {
      const next = rawParts[i + 1];
      if (!next) {
        return { target: null, error: "Missing value for --extra" };
      }
      extraInstruction = next;
      i += 1;
      continue;
    }

    if (part.startsWith("--extra=")) {
      extraInstruction = part.slice("--extra=".length);
      continue;
    }

    parts.push(part);
  }

  if (parts.length === 0) {
    return { target: null, extraInstruction };
  }

  const subcommand = parts[0]?.toLowerCase();

  switch (subcommand) {
    case "uncommitted":
      return { target: { type: "uncommitted" }, extraInstruction };

    case "branch": {
      const branch = parts[1];
      if (!branch) return { target: null, extraInstruction };
      return { target: { type: "baseBranch", branch }, extraInstruction };
    }

    case "commit": {
      const sha = parts[1];
      if (!sha) return { target: null, extraInstruction };
      const title = parts.slice(2).join(" ") || undefined;
      return { target: { type: "commit", sha, title }, extraInstruction };
    }

    case "folder": {
      const paths = parseReviewPaths(parts.slice(1).join(" "));
      if (paths.length === 0) return { target: null, extraInstruction };
      return { target: { type: "folder", paths }, extraInstruction };
    }

    case "pr": {
      const ref = parts[1];
      if (!ref) return { target: null, extraInstruction };
      return { target: { type: "pr", ref }, extraInstruction };
    }

    default:
      return { target: null, extraInstruction };
  }
}
