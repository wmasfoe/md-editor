import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asDisplayText,
  asJsonRecord,
  asJsonRecordArray,
  MODEL_CHANGELOG_URL,
} from "../lib/model-changelog";
import {
  getModelChangelog,
  MODEL_CHANGELOG_REVALIDATE_SECONDS,
} from "../lib/model-changelog-source";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("getModelChangelog", () => {
  it("reads the remote JSON with an hourly revalidation window", async () => {
    const payload = { latestVersion: "1.3.0", releases: [] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(payload),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getModelChangelog()).resolves.toBe(payload);
    expect(fetchMock).toHaveBeenCalledWith(MODEL_CHANGELOG_URL, {
      next: { revalidate: MODEL_CHANGELOG_REVALIDATE_SECONDS },
    });
  });

  it("returns no model content when the remote response cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(getModelChangelog()).resolves.toBeNull();
  });
});

describe("permissive model changelog rendering helpers", () => {
  it("keeps renderable records and ignores missing array content", () => {
    expect(asJsonRecordArray(undefined)).toEqual([]);
    expect(asJsonRecordArray([null, "text", { title: "核心改进" }])).toEqual([
      { title: "核心改进" },
    ]);
  });

  it("renders only non-empty text without rejecting the containing record", () => {
    expect(asJsonRecord({ extra: true })).toEqual({ extra: true });
    expect(asDisplayText("  模型更新  ")).toBe("模型更新");
    expect(asDisplayText("   ")).toBeNull();
    expect(asDisplayText({ text: "unsupported" })).toBeNull();
  });
});
