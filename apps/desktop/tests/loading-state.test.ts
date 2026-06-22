import { describe, expect, it } from "vitest";
import { getLoadingDescription } from "../src/app/loading-state";

describe("global loading description", () => {
  it("normalizes action labels to secondary loading copy", () => {
    expect(getLoadingDescription("正在打开")).toBe("打开…");
    expect(getLoadingDescription("正在打开文件夹")).toBe("打开文件夹…");
    expect(getLoadingDescription("处理中…")).toBe("处理中…");
  });

  it("returns undefined for missing labels", () => {
    expect(getLoadingDescription(null)).toBeUndefined();
  });
});
