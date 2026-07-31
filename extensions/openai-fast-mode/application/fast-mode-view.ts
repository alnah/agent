export type FastModeNotificationLevel = "info" | "warning" | "error";

/** Output boundary used by the application layer. */
export interface FastModeView {
  notify(message: string, level: FastModeNotificationLevel): void;
}
