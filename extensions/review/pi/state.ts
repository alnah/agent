/**
 * Review runtime and persistence state.
 *
 * One instance per extension factory keeps the active review branch, widget
 * flags, and persisted settings isolated between sessions.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

/**
 * Persisted review-branch state.
 *
 * `originId` points to the leaf that `/end-review` should navigate back to.
 */
export type SessionState = {
  active: boolean;
  originId?: string;
};

/** Persisted review settings shared across sessions. */
export type SettingsState = {
  loopFixingEnabled?: boolean;
  customInstructions?: string;
};

export const STATE_TYPE = "review-session";
export const ANCHOR_TYPE = "review-anchor";
export const SETTINGS_TYPE = "review-settings";

export class ReviewState {
  private originId: string | undefined;
  private endInProgress = false;
  private loopFixingEnabled = false;
  private customInstructions: string | undefined;
  private loopInProgress = false;

  getOriginId(): string | undefined {
    return this.originId;
  }

  setOriginId(value: string | undefined): void {
    this.originId = value;
  }

  isEndInProgress(): boolean {
    return this.endInProgress;
  }

  setEndInProgress(value: boolean): void {
    this.endInProgress = value;
  }

  isLoopFixingEnabled(): boolean {
    return this.loopFixingEnabled;
  }

  setLoopFixingEnabled(value: boolean): void {
    this.loopFixingEnabled = value;
  }

  getCustomInstructions(): string | undefined {
    return this.customInstructions;
  }

  /** Blank input is normalized to `undefined` so prompts stay clean. */
  setCustomInstructions(value: string | undefined): void {
    this.customInstructions = value?.trim() || undefined;
  }

  isLoopInProgress(): boolean {
    return this.loopInProgress;
  }

  setLoopInProgress(value: boolean): void {
    this.loopInProgress = value;
  }

  persistSettings(pi: ExtensionAPI): void {
    pi.appendEntry(SETTINGS_TYPE, {
      loopFixingEnabled: this.loopFixingEnabled,
      customInstructions: this.customInstructions,
    });
  }

  /** Updates or clears the review status widget. */
  setWidget(ctx: ExtensionContext, active: boolean): void {
    if (!ctx.hasUI) return;
    if (!active) {
      ctx.ui.setWidget("review", undefined);
      return;
    }

    ctx.ui.setWidget("review", (_tui, theme) => {
      const message = this.loopInProgress
        ? "Review session active (loop fixing running)"
        : this.loopFixingEnabled
          ? "Review session active (loop fixing enabled), return with /end-review"
          : "Review session active, return with /end-review";
      const text = new Text(theme.fg("warning", message), 0, 0);
      return {
        render(width: number) {
          return text.render(width);
        },
        invalidate() {
          text.invalidate();
        },
      };
    });
  }

  /** Reads the newest persisted review-branch state from the current branch. */
  getPersistedSessionState(ctx: ExtensionContext): SessionState | undefined {
    let state: SessionState | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === STATE_TYPE) {
        state = entry.data as SessionState | undefined;
      }
    }

    return state;
  }

  applyPersistedSessionState(ctx: ExtensionContext): void {
    const state = this.getPersistedSessionState(ctx);

    if (state?.active && state.originId) {
      this.originId = state.originId;
      this.setWidget(ctx, true);
      return;
    }

    this.originId = undefined;
    this.setWidget(ctx, false);
  }

  /** Reads the newest persisted review settings from the full session history. */
  getPersistedSettings(ctx: ExtensionContext): SettingsState {
    let state: SettingsState | undefined;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === SETTINGS_TYPE) {
        state = entry.data as SettingsState | undefined;
      }
    }

    return {
      loopFixingEnabled: state?.loopFixingEnabled === true,
      customInstructions: state?.customInstructions?.trim() || undefined,
    };
  }

  applyPersistedSettings(ctx: ExtensionContext): void {
    const state = this.getPersistedSettings(ctx);
    this.loopFixingEnabled = state.loopFixingEnabled === true;
    this.customInstructions = state.customInstructions?.trim() || undefined;
  }

  applyAllPersistedState(ctx: ExtensionContext): void {
    this.applyPersistedSettings(ctx);
    this.applyPersistedSessionState(ctx);
  }
}
