import type {
  AgentSessionEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { OverlayHandle } from "@mariozechner/pi-tui";
import {
  type AsideContext,
  extractEventAssistantText,
  extractText,
  getLastAssistantMessage,
  notify,
} from "./context.ts";
import { AsideOverlay } from "./overlay.ts";
import {
  type AsideDetails,
  createSideSession,
  type SideSessionRuntime,
  summarizeThread,
} from "./side.ts";
import {
  createToolCallInfo,
  getTranscriptLines,
  type ToolCallInfo,
} from "./transcript.ts";

const ASIDE_ENTRY_TYPE = "aside-thread-entry";
const ASIDE_RESET_TYPE = "aside-thread-reset";

type AsideResetDetails = {
  timestamp: number;
};

type OverlayRuntime = {
  handle?: OverlayHandle;
  refresh?: () => void;
  close?: () => void;
  finish?: () => void;
  setDraft?: (value: string) => void;
  closed?: boolean;
};

/**
 * Coordinates aside command handling, side-session state, and overlay lifecycle.
 *
 * It is the single mutable runtime owner for the extension across commands,
 * session events, persisted thread state, and transient UI/session handles.
 */
class AsideController {
  private thread: AsideDetails[] = [];
  private pendingQuestion: string | null = null;
  private pendingAnswer = "";
  private pendingError: string | null = null;
  private pendingToolCalls: ToolCallInfo[] = [];
  private sideBusy = false;
  private overlayStatus = "Ready";
  private overlayDraft = "";
  private overlayRuntime: OverlayRuntime | null = null;
  private activeSideSession: SideSessionRuntime | null = null;
  private overlayRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly pi: ExtensionAPI) {}

  /** Registers the aside command and its session lifecycle hooks. */
  register(): void {
    this.pi.registerCommand("aside", {
      description:
        "Open an aside conversation. `/aside <text>` asks immediately, `/aside` opens the aside thread.",
      handler: async (args, ctx) => {
        const question = args.trim();
        if (!question) {
          await this.openOverlayFlow(ctx);
          return;
        }

        await this.ensureOverlay(ctx);
        await this.runAsidePrompt(ctx, question);
      },
    });

    this.pi.on("session_start", async (_event, ctx) => {
      await this.restoreThread(ctx);
    });
    this.pi.on("session_tree", async (_event, ctx) => {
      await this.restoreThread(ctx);
    });
    this.pi.on("session_shutdown", async () => {
      await this.disposeSideSession();
      this.dismissOverlay();
    });
  }

  private getTranscriptState() {
    return {
      thread: this.thread,
      pendingQuestion: this.pendingQuestion,
      pendingAnswer: this.pendingAnswer,
      pendingError: this.pendingError,
      pendingToolCalls: this.pendingToolCalls,
    };
  }

  private syncOverlay(): void {
    this.overlayRuntime?.refresh?.();
  }

  private scheduleOverlayRefresh(): void {
    if (this.overlayRefreshTimer) return;
    this.overlayRefreshTimer = setTimeout(() => {
      this.overlayRefreshTimer = null;
      this.syncOverlay();
    }, 16);
  }

  private setOverlayStatus(status: string, throttled = false): void {
    this.overlayStatus = status;
    if (throttled) {
      this.scheduleOverlayRefresh();
      return;
    }
    this.syncOverlay();
  }

  private dismissOverlay(): void {
    this.overlayRuntime?.close?.();
    this.overlayRuntime = null;
    if (!this.overlayRefreshTimer) return;
    clearTimeout(this.overlayRefreshTimer);
    this.overlayRefreshTimer = null;
  }

  private setOverlayDraft(value: string): void {
    this.overlayDraft = value;
    this.overlayRuntime?.setDraft?.(value);
  }

  private resetState(): void {
    this.thread = [];
    this.pendingQuestion = null;
    this.pendingAnswer = "";
    this.pendingError = null;
    this.pendingToolCalls = [];
    this.sideBusy = false;
    this.overlayStatus = "Ready";
    this.setOverlayDraft("");
  }

  /** Tears down the active side session and any queued overlay refresh. */
  async disposeSideSession(): Promise<void> {
    const current = this.activeSideSession;
    this.activeSideSession = null;
    if (!current) return;

    try {
      current.unsubscribe();
    } catch {}
    try {
      await current.session.abort();
    } catch {}
    current.session.dispose();

    if (!this.overlayRefreshTimer) return;
    clearTimeout(this.overlayRefreshTimer);
    this.overlayRefreshTimer = null;
  }

  /** Clears the current aside thread and optionally persists a reset marker. */
  async resetThread(_ctx: AsideContext, persist = true): Promise<void> {
    this.resetState();
    await this.disposeSideSession();
    if (persist) {
      const details: AsideResetDetails = { timestamp: Date.now() };
      this.pi.appendEntry(ASIDE_RESET_TYPE, details);
    }
    this.syncOverlay();
  }

  /** Restores the aside thread from the current session branch. */
  async restoreThread(ctx: ExtensionContext): Promise<void> {
    await this.disposeSideSession();
    this.resetState();

    const branch = ctx.sessionManager.getBranch();
    let lastResetIndex = -1;
    for (let i = 0; i < branch.length; i++) {
      const entry = branch[i];
      if (entry.type === "custom" && entry.customType === ASIDE_RESET_TYPE) {
        lastResetIndex = i;
      }
    }

    for (const entry of branch.slice(lastResetIndex + 1)) {
      if (entry.type !== "custom" || entry.customType !== ASIDE_ENTRY_TYPE)
        continue;
      const details = entry.data as AsideDetails | undefined;
      if (!details?.question || !details.answer) continue;
      this.thread.push(details);
    }

    this.syncOverlay();
  }

  /**
   * Folds streamed side-session events into the lightweight overlay state.
   *
   * The overlay tracks assistant text, tool previews, and status transitions in
   * a deliberately compact shape rather than mirroring the whole Pi event model.
   */
  private handleSideSessionEvent(event: AgentSessionEvent): void {
    if (!this.sideBusy || !this.pendingQuestion) return;

    switch (event.type) {
      case "message_start":
      case "message_update":
      case "message_end": {
        const streamed = extractEventAssistantText(event.message);
        if (streamed) {
          this.pendingAnswer = streamed;
          this.pendingError = null;
        }
        this.setOverlayStatus(
          event.type === "message_end"
            ? "Finalizing side response..."
            : "Streaming side response...",
          true,
        );
        return;
      }
      case "tool_execution_start": {
        const toolName = (event as { toolName?: string }).toolName ?? "unknown";
        try {
          this.pendingToolCalls.push(
            createToolCallInfo(
              toolName,
              (event as { toolCallId?: string }).toolCallId ?? "",
              (event as { args?: unknown }).args,
            ),
          );
        } catch {}
        this.setOverlayStatus(`Running tool: ${toolName}...`, true);
        return;
      }
      case "tool_execution_end": {
        const toolName = (event as { toolName?: string }).toolName ?? "unknown";
        const toolCallId = (event as { toolCallId?: string }).toolCallId ?? "";
        const toolCall = this.pendingToolCalls.find((item) => {
          return (
            item.toolCallId === toolCallId ||
            (item.toolName === toolName && item.status === "running")
          );
        });
        if (toolCall) {
          toolCall.status = (event as { isError?: boolean }).isError
            ? "error"
            : "done";
        }
        this.setOverlayStatus("Streaming side response...", true);
        return;
      }
      case "turn_end":
        this.setOverlayStatus("Finalizing side response...", true);
        return;
      default:
        return;
    }
  }

  private async ensureSideSession(
    ctx: ExtensionCommandContext,
  ): Promise<SideSessionRuntime | null> {
    if (!ctx.model) return null;
    const expectedModelKey = `${ctx.model.provider}/${ctx.model.id}`;
    if (this.activeSideSession?.modelKey === expectedModelKey) {
      return this.activeSideSession;
    }

    await this.disposeSideSession();
    this.activeSideSession = await createSideSession(
      this.pi,
      ctx,
      this.thread,
      (event) => {
        this.handleSideSessionEvent(event);
      },
    );
    return this.activeSideSession;
  }

  /** Opens or re-focuses the aside overlay when UI support is available. */
  async ensureOverlay(ctx: AsideContext): Promise<void> {
    if (!ctx.hasUI) return;
    if (this.overlayRuntime?.handle) {
      this.overlayRuntime.handle.setHidden(false);
      this.overlayRuntime.handle.focus();
      this.overlayRuntime.refresh?.();
      return;
    }

    const runtime: OverlayRuntime = {};
    const closeRuntime = () => {
      if (runtime.closed) return;
      runtime.closed = true;
      runtime.handle?.hide();
      if (this.overlayRuntime === runtime) {
        this.overlayRuntime = null;
      }
      runtime.finish?.();
    };

    runtime.close = closeRuntime;
    this.overlayRuntime = runtime;

    void ctx.ui
      .custom<void>(
        async (tui, theme, keybindings, done) => {
          runtime.finish = () => done();
          const overlay = new AsideOverlay(
            tui,
            theme,
            keybindings,
            (width, currentTheme) =>
              getTranscriptLines(
                this.getTranscriptState(),
                width,
                currentTheme,
              ),
            () => this.overlayStatus,
            (value) => void this.submitFromOverlay(ctx, value),
            () => void this.closeOverlayFlow(ctx),
          );

          overlay.focused = true;
          overlay.setDraft(this.overlayDraft);
          runtime.setDraft = (value) => overlay.setDraft(value);
          runtime.refresh = () => {
            overlay.focused = runtime.handle?.isFocused() ?? false;
            tui.requestRender();
          };
          runtime.close = () => {
            this.overlayDraft = overlay.getDraft();
            closeRuntime();
          };

          if (runtime.closed) {
            done();
          }
          return overlay;
        },
        {
          overlay: true,
          overlayOptions: {
            width: "80%",
            minWidth: 72,
            maxHeight: "78%",
            anchor: "top-center",
            margin: { top: 1, left: 2, right: 2 },
          },
          onHandle: (handle) => {
            runtime.handle = handle;
            handle.focus();
            if (runtime.closed) closeRuntime();
          },
        },
      )
      .catch((error) => {
        if (this.overlayRuntime === runtime) {
          this.overlayRuntime = null;
        }
        notify(
          ctx,
          error instanceof Error ? error.message : String(error),
          "error",
        );
      });
  }

  private async injectSummaryIntoMain(ctx: AsideContext): Promise<void> {
    if (this.thread.length === 0) {
      notify(ctx, "No aside thread to summarize.", "warning");
      return;
    }

    this.setOverlayStatus("Summarizing aside thread for injection...");
    try {
      const summary = await summarizeThread(ctx, this.thread);
      const message = `Summary of my aside conversation:\n\n${summary}`;
      if (ctx.isIdle()) {
        this.pi.sendUserMessage(message);
      } else {
        this.pi.sendUserMessage(message, { deliverAs: "followUp" });
      }

      await this.resetThread(ctx);
      notify(ctx, "Injected aside summary into main chat.", "info");
    } catch (error) {
      notify(
        ctx,
        error instanceof Error ? error.message : String(error),
        "error",
      );
    }
  }

  private async closeOverlayFlow(ctx: AsideContext): Promise<void> {
    this.dismissOverlay();
    if (!ctx.hasUI || this.thread.length === 0) return;
    const choice = await ctx.ui.select("Close aside:", [
      "Keep aside thread",
      "Inject summary into main chat",
    ]);
    if (choice === "Inject summary into main chat") {
      await this.injectSummaryIntoMain(ctx);
    }
  }

  /**
   * Executes one aside question against the isolated session.
   *
   * The controller guards model/auth availability, reuses the current side
   * session when possible, streams progress into the overlay, and persists the
   * completed answer back into Pi's custom session entries.
   */
  private async runAsidePrompt(
    ctx: ExtensionCommandContext,
    question: string,
  ): Promise<void> {
    const model = ctx.model;
    if (!model) {
      this.setOverlayStatus("No active model selected.");
      notify(ctx, "No active model selected.", "error");
      return;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (auth.ok === false) {
      this.setOverlayStatus(auth.error);
      notify(ctx, auth.error, "error");
      return;
    }
    if (this.sideBusy) {
      notify(ctx, "Aside is still processing the previous message.", "warning");
      return;
    }

    const side = await this.ensureSideSession(ctx);
    if (!side) {
      notify(ctx, "Unable to create aside session.", "error");
      return;
    }

    this.sideBusy = true;
    this.pendingQuestion = question;
    this.pendingAnswer = "";
    this.pendingError = null;
    this.pendingToolCalls = [];
    this.setOverlayStatus("Streaming side response...");
    this.syncOverlay();

    try {
      await side.session.prompt(question, { source: "extension" });
      const response = getLastAssistantMessage(side.session);
      if (!response)
        throw new Error("Aside request finished without a response.");
      if (response.stopReason === "aborted")
        throw new Error("Aside request aborted.");
      if (response.stopReason === "error") {
        throw new Error(response.errorMessage || "Aside request failed.");
      }

      const answer = extractText(response.content) || "(No text response)";
      this.pendingAnswer = answer;
      const details: AsideDetails = {
        question,
        answer,
        timestamp: Date.now(),
        provider: model.provider,
        model: model.id,
        thinkingLevel:
          this.pi.getThinkingLevel() as AsideDetails["thinkingLevel"],
        usage: response.usage,
      };
      this.thread.push(details);
      this.pi.appendEntry(ASIDE_ENTRY_TYPE, details);

      this.pendingQuestion = null;
      this.pendingAnswer = "";
      this.pendingToolCalls = [];
      this.setOverlayStatus("Ready for the next side question.");
    } catch (error) {
      this.pendingError =
        error instanceof Error ? error.message : String(error);
      this.setOverlayStatus("Aside request failed.");
      notify(ctx, this.pendingError, "error");
    } finally {
      this.sideBusy = false;
      this.syncOverlay();
    }
  }

  private async submitFromOverlay(
    ctx: AsideContext,
    rawValue: string,
  ): Promise<void> {
    const question = rawValue.trim();
    if (!question) {
      this.setOverlayStatus("Enter a question first.");
      return;
    }

    this.setOverlayDraft("");
    if (!("waitForIdle" in ctx)) {
      this.setOverlayStatus(
        "Aside submit requires command context. Re-open with /aside.",
      );
      return;
    }

    await this.runAsidePrompt(ctx, question);
  }

  /** Resolves the top-level `/aside` flow when no question text was provided. */
  private async openOverlayFlow(ctx: ExtensionCommandContext): Promise<void> {
    if (this.thread.length === 0 || !ctx.hasUI) {
      await this.resetThread(ctx, true);
      this.setOverlayStatus("Ready");
      await this.ensureOverlay(ctx);
      return;
    }

    const choice = await ctx.ui.select("Aside:", [
      "Continue previous aside",
      "Start fresh",
    ]);
    if (choice === "Continue previous conversation") {
      await this.disposeSideSession();
      this.setOverlayStatus("Continuing aside thread.");
      await this.ensureOverlay(ctx);
      return;
    }
    if (choice === "Start fresh") {
      await this.resetThread(ctx, true);
      this.setOverlayStatus("Ready");
      await this.ensureOverlay(ctx);
    }
  }
}

/**
 * Registers the aside extension.
 *
 * The public extension surface stays intentionally tiny: Pi loads this entry
 * point, and the controller owns the command, session lifecycle, and overlay
 * orchestration from there.
 */
export default function (pi: ExtensionAPI): void {
  new AsideController(pi).register();
}
