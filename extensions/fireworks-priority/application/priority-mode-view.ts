export type PriorityNotificationLevel = "info" | "warning" | "error";

export type PriorityPresentation =
  | { readonly kind: "hidden" }
  | { readonly kind: "waiting" }
  | { readonly kind: "priority" }
  | { readonly kind: "fault"; readonly message: string };

/** Output boundary used by the application layer. */
export interface PriorityView {
  render(presentation: PriorityPresentation): void;
  notify(message: string, level: PriorityNotificationLevel): void;
}
