import { describe, expect, it } from "vitest";
import {
  DEFAULT_UPDATE_SETTINGS,
  normalizeUpdateSettings,
} from "../../../../src/app/settings/updates";

describe("normalizeUpdateSettings", () => {
  it("falls back to defaults for missing or malformed input", () => {
    expect(normalizeUpdateSettings(undefined)).toEqual(DEFAULT_UPDATE_SETTINGS);
    expect(normalizeUpdateSettings("yes")).toEqual(DEFAULT_UPDATE_SETTINGS);
    expect(normalizeUpdateSettings({})).toEqual(DEFAULT_UPDATE_SETTINGS);
  });

  it("turns automatic download off whenever automatic check is off", () => {
    expect(normalizeUpdateSettings({ automaticCheck: false, automaticDownload: true })).toEqual({
      automaticCheck: false,
      automaticDownload: false,
    });
  });

  it("keeps an explicit opt-out of automatic download", () => {
    expect(normalizeUpdateSettings({ automaticCheck: true, automaticDownload: false })).toEqual({
      automaticCheck: true,
      automaticDownload: false,
    });
  });
});
