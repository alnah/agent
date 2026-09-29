import {
  type AssistantMessage,
  extractLastAssistantText,
  formatNotification,
} from "../core/notify.ts";

type ExtensionAPI = {
  on(
    event: string,
    handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown,
  ): void;
};

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
