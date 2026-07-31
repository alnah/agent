export type FastCommand = "on" | "off" | "status";

export type FastCommandParseResult =
  | { readonly valid: true; readonly command: FastCommand }
  | { readonly valid: false };

/** Parses the public `/fast` command contract without side effects. */
export class FastCommandParser {
  parse(rawCommand: string): FastCommandParseResult {
    const normalized = rawCommand.trim().toLowerCase();
    if (normalized === "") return { valid: true, command: "status" };
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
