import { describe, expect, it } from "vitest";
import {
  isPlaceholderReleaseNotes,
  readReleaseNotesEntry,
} from "../../../src/app/updates/release-notes";
import type { UpdateStatus } from "../../../src/app/settings/app-settings";

function status(partial: Partial<UpdateStatus>): UpdateStatus {
  return { currentVersion: "0.15.1", state: "available", installKind: "app", ...partial };
}

const CHANGELOG = `## 0.16.0 - 2026-10-30 (#190)

- 新增「本次更新内容」提示：
  - 检测到新版本时展示更新日志
- 修复侧边栏折叠状态丢失。

## 0.15.1 - 2026-10-22 (#182)

- 修复目录锚点跳转。
`;

describe("isPlaceholderReleaseNotes", () => {
  it("treats empty, version echo and the old release template as placeholders", () => {
    expect(isPlaceholderReleaseNotes("   ")).toBe(true);
    expect(isPlaceholderReleaseNotes("Inkpoint 0.15.1")).toBe(true);
    expect(
      isPlaceholderReleaseNotes("Multi-platform release for 0.15.1 (macOS, Linux, Windows)."),
    ).toBe(true);
  });

  it("keeps real notes", () => {
    expect(isPlaceholderReleaseNotes("## 0.16.0\n\n- 修复问题")).toBe(false);
  });
});

describe("readReleaseNotesEntry", () => {
  it("returns null when notes are missing or placeholder", () => {
    expect(readReleaseNotesEntry(status({ latestVersion: "0.16.0" }))).toBeNull();
    expect(
      readReleaseNotesEntry(status({ latestVersion: "0.15.1", releaseNotes: "Inkpoint 0.15.1" })),
    ).toBeNull();
  });

  it("picks the entry matching the latest version", () => {
    const entry = readReleaseNotesEntry(
      status({ latestVersion: "0.16.0", releaseNotes: CHANGELOG }),
    );
    expect(entry?.version).toBe("0.16.0");
    expect(entry?.sourcePR).toEqual([190]);
    expect(entry?.items[0].text).toContain("本次更新内容");
    expect(entry?.items[0].items?.[0].text).toContain("检测到新版本");
  });

  it("falls back to the first entry when the version is not found", () => {
    const entry = readReleaseNotesEntry(
      status({ latestVersion: "9.9.9", releaseNotes: CHANGELOG }),
    );
    expect(entry?.version).toBe("0.16.0");
  });

  it("parses only list lines from a flat GitHub release body", () => {
    const entry = readReleaseNotesEntry(
      status({
        latestVersion: "0.17.0",
        releaseNotes: "What's new:\n- 新增更新提示\n- 修复若干问题",
      }),
    );
    expect(entry?.version).toBe("0.17.0");
    // 引导句与 HTML 片段都不是条目，避免把说明文字当成更新内容。
    expect(entry?.items.map((item) => item.text)).toEqual(["新增更新提示", "修复若干问题"]);
  });

  it("returns null for a flat body without bullet lines", () => {
    expect(
      readReleaseNotesEntry(
        status({ latestVersion: "0.17.0", releaseNotes: "What's new:\n<p>see repo</p>" }),
      ),
    ).toBeNull();
  });
});
