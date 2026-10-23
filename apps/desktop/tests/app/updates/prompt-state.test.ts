import { describe, expect, it } from "vitest";
import {
  listenUpdatePromptStateChanged,
  loadUpdatePromptState,
  normalizeUpdatePromptState,
  normalizeVersion,
  saveUpdatePromptState,
  UPDATE_PROMPT_CHANGED_EVENT,
} from "../../../src/app/updates/prompt-state";

describe("normalizeVersion", () => {
  it("trims and strips an optional v prefix", () => {
    expect(normalizeVersion(" v0.16.0 ")).toBe("0.16.0");
    expect(normalizeVersion("0.16.0")).toBe("0.16.0");
  });

  it("rejects empty and non-string values", () => {
    expect(normalizeVersion("   ")).toBeUndefined();
    expect(normalizeVersion(null)).toBeUndefined();
    expect(normalizeVersion(16)).toBeUndefined();
  });
});

describe("normalizeUpdatePromptState", () => {
  it("keeps only recognized version fields", () => {
    expect(
      normalizeUpdatePromptState({
        lastNotifiedVersion: " v0.16.0 ",
        skippedVersion: "0.15.1",
        extra: "ignored",
      }),
    ).toEqual({ lastNotifiedVersion: "0.16.0", skippedVersion: "0.15.1" });
  });

  it("returns an empty state for garbage input", () => {
    expect(normalizeUpdatePromptState(null)).toEqual({});
    expect(normalizeUpdatePromptState("nope")).toEqual({});
    expect(normalizeUpdatePromptState({ lastNotifiedVersion: 42 })).toEqual({});
    expect(normalizeUpdatePromptState({ skippedVersion: "  " })).toEqual({});
  });
});

describe("load/save outside Tauri", () => {
  it("degrades to an empty state without throwing", async () => {
    await expect(loadUpdatePromptState()).resolves.toEqual({});
    await expect(saveUpdatePromptState({ lastNotifiedVersion: "0.16.0" })).resolves.toBeUndefined();
  });
});

describe("cross-window prompt state sync", () => {
  it("exposes a dedicated broadcast event name", () => {
    expect(UPDATE_PROMPT_CHANGED_EVENT).toBe("md-editor-update-prompt-changed");
  });

  it("skips subscription outside Tauri and returns no unsubscriber", () => {
    expect(listenUpdatePromptStateChanged(() => undefined)).toBeUndefined();
  });
});
