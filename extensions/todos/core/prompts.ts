import { formatTodoId } from "./parsing.ts";

/**
 * Builds the prompt used to refine an existing todo with the user.
 *
 * The prompt explicitly keeps the model in clarification mode so it gathers
 * missing details before rewriting the task.
 */
export function buildRefinePrompt(id: unknown, title: unknown): string {
  return `let's refine task ${formatTodoId(id)} "${title}": Ask me for the missing details needed to refine the todo together. Do not rewrite the todo yet and do not make assumptions. Ask clear, concrete questions and wait for my answers before drafting any structured description.\n\n`;
}

/**
 * Builds the prompt used to continue execution from a selected todo.
 *
 * The text is intentionally short so the agent can resume work while still
 * naming the exact todo id and title.
 */
export function buildWorkPrompt(id: unknown, title: unknown): string {
  return `work on todo ${formatTodoId(id)} "${title}"`;
}
