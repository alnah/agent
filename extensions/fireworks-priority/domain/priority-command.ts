export type PriorityCommand = "toggle" | "on" | "off" | "status";

export type PriorityCommandParseResult =
  | { readonly valid: true; readonly command: PriorityCommand }
  | { readonly valid: false };

/** Parses the public `/fireworks-priority` command contract. */
export class PriorityCommandParser {
  parse(rawCommand: string): PriorityCommandParseResult {
    const normalized = rawCommand.trim().toLowerCase();
    if (normalized === "" || normalized === "toggle") {
      return { valid: true, command: "toggle" };
    }
    if (
      normalized === "on" ||
      normalized === "off" ||
      normalized === "status"
    ) {
      return { valid: true, command: normalized };
    }
    return { valid: false };
  }
}
