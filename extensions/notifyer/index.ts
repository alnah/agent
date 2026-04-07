type ExtensionAPI = {
  on(
    event: string,
    handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown,
  ): void;
};

type TextPart = {
  type: "text";
  text: string;
};

type MessagePart = TextPart | { type: string; [key: string]: unknown };

type AssistantMessage = {
  role?: string;
  content?: string | MessagePart[];
};

/**
 * Extracts the most recent assistant-visible text.
 *
 * It scans messages from the end, considers only assistant turns, joins text
 * parts with newlines, trims surrounding whitespace, and returns `null` when
 * no usable assistant text is present.
 */
export function extractLastAssistantText(
  messages: AssistantMessage[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;

    if (typeof message.content === "string") {
      const text = message.content.trim();
      return text.length > 0 ? text : null;
    }

    if (Array.isArray(message.content)) {
      const text = message.content
        .filter(
          (part): part is TextPart =>
            part?.type === "text" && typeof part.text === "string",
        )
        .map((part) => part.text)
        .join("\n")
        .trim();

      return text.length > 0 ? text : null;
    }
  }

  return null;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/\r?\n+/g, " ");
}

function sanitizeForOsc(text: string): string {
  return text
    .replaceAll("\u0007", "")
    .replaceAll("\u001b", "")
    .replace(/;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/**
 * Converts assistant output into a terminal-safe notification payload.
 *
 * When no meaningful assistant text is available, it returns a fallback
 * "Ready for input" title. Otherwise it strips lightweight markdown,
 * normalizes whitespace, removes OSC-delimiting characters, and truncates the
 * body to 200 characters.
 */
export function formatNotification(text: string | null): {
  title: string;
  body: string;
} {
  if (!text) {
    return {
      title: "Ready for input",
      body: "",
    };
  }

  const body = truncate(sanitizeForOsc(stripMarkdown(text)), 200);
  if (!body) {
    return {
      title: "Ready for input",
      body: "",
    };
  }

  return {
    title: "π",
    body,
  };
}

/**
 * Emits a Ghostty/iTerm2/WezTerm-style OSC 777 notification sequence.
 *
 * It writes directly to stdout and assumes the caller already sanitized the
 * title and body for terminal transport.
 */
function notifyOSC777(title: string, body: string): void {
  process.stdout.write(`\u001b]777;notify;${title};${body}\u0007`);
}

/**
 * Delivers the notification through OSC 777 only.
 *
 * This keeps notification delivery focused on terminal behavior.
 */
function notify(title: string, body: string): void {
  notifyOSC777(title, body);
}

/**
 * Registers a completion notifier that fires when Pi finishes a prompt.
 *
 * It subscribes to `agent_end`, derives a short summary from the last
 * assistant message, and emits it through the configured notification path.
 */
export default function (pi: ExtensionAPI): void {
  pi.on("agent_end", async (event: unknown) => {
    const messages = Array.isArray(
      (event as { messages?: unknown[] })?.messages,
    )
      ? ((event as { messages: AssistantMessage[] }).messages ?? [])
      : [];
    const { title, body } = formatNotification(
      extractLastAssistantText(messages),
    );
    notify(title, body);
  });
}
