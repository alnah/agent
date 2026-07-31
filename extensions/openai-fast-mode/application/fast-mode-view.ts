export type FastModeNotificationLevel = "info" | "warning" | "error";

export type FastModePresentation =
  | { readonly kind: "hidden" }
  | { readonly kind: "waiting" }
  | { readonly kind: "priority" }
  | { readonly kind: "fault"; readonly message: string };

/** Output boundary used by the application layer. */
export interface FastModeView {
  render(presentation: FastModePresentation): void;
  notify(message: string, level: FastModeNotificationLevel): void;
}
