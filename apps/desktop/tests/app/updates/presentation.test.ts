import { describe, expect, it } from "vitest";
import {
  selectUpdatePresentation,
  shouldPresentUpdateNotice,
} from "../../../src/app/updates/presentation";
import type { UpdateStatus } from "../../../src/app/settings/app-settings";

function status(partial: Partial<UpdateStatus>): UpdateStatus {
  return { currentVersion: "0.15.1", state: "available", installKind: "app", ...partial };
}

describe("selectUpdatePresentation", () => {
  it("shows the release-notes notice once for a new version", () => {
    expect(
      selectUpdatePresentation({
        status: status({ latestVersion: "0.16.0" }),
        promptState: {},
        hasPaintedFirstFrame: true,
      }),
    ).toEqual({ notice: "release-notes", titleBar: "available" });
  });

  it("holds the notice until the first frame has painted", () => {
    expect(
      selectUpdatePresentation({
        status: status({ latestVersion: "0.16.0" }),
        promptState: {},
        hasPaintedFirstFrame: false,
      }).notice,
    ).toBe("none");
  });

  it("does not notify twice for the same version", () => {
    expect(
      selectUpdatePresentation({
        status: status({ latestVersion: "0.16.0" }),
        promptState: { lastNotifiedVersion: "0.16.0" },
        hasPaintedFirstFrame: true,
      }).notice,
    ).toBe("none");
  });

  it("does not notify a skipped version", () => {
    expect(
      selectUpdatePresentation({
        status: status({ latestVersion: "0.16.0" }),
        promptState: { lastNotifiedVersion: "0.16.0", skippedVersion: "0.16.0" },
        hasPaintedFirstFrame: true,
      }).notice,
    ).toBe("none");
  });

  it("notifies again when a newer version appears after a skip", () => {
    expect(
      selectUpdatePresentation({
        status: status({ latestVersion: "0.17.0" }),
        promptState: { skippedVersion: "0.16.0", lastNotifiedVersion: "0.16.0" },
        hasPaintedFirstFrame: true,
      }).notice,
    ).toBe("release-notes");
  });

  it("normalizes v-prefixed versions before comparing", () => {
    expect(shouldPresentUpdateNotice(status({ latestVersion: "v0.16.0" }), {})).toBe(true);
    expect(
      shouldPresentUpdateNotice(status({ latestVersion: "v0.16.0" }), {
        lastNotifiedVersion: "0.16.0",
      }),
    ).toBe(false);
  });

  it("maps title bar actions across the update lifecycle", () => {
    const cases: [UpdateStatus["state"], string][] = [
      ["idle", "none"],
      ["checking", "none"],
      ["up-to-date", "none"],
      ["available", "available"],
      ["downloading", "available"],
      ["downloaded", "restart"],
      ["installing", "available"],
      ["installed", "restart"],
      ["error", "none"],
    ];

    for (const [state, expected] of cases) {
      const result = selectUpdatePresentation({
        status: status({ state, latestVersion: "0.16.0" }),
        promptState: { lastNotifiedVersion: "0.16.0" },
        hasPaintedFirstFrame: true,
      });
      expect({ state, titleBar: result.titleBar }).toEqual({ state, titleBar: expected });
    }
  });

  it("never presents anything for manual install flows", () => {
    expect(
      selectUpdatePresentation({
        status: status({ installKind: "manual", latestVersion: "0.16.0" }),
        promptState: {},
        hasPaintedFirstFrame: true,
      }),
    ).toEqual({ notice: "none", titleBar: "none" });
  });
});
