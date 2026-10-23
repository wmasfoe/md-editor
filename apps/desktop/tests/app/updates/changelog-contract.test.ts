/**
 * @fileoverview 发版切片器 ↔ 运行时解析器的「标题格式契约」交叉断言
 *
 * 发版脚本 `scripts/release/changelog-section.mjs` 与共享包 `@md-editor/changelog`
 * 是两份实现（前者输出原文切片供 manifest notes，后者输出结构化条目），
 * 但它们必须对「哪些标题算版本标题」保持一致：
 *
 * - 若切片器接受、解析器不接受 → manifest 里会写入一个运行时认不出的版本，
 *   用户看到的是「版本号对、内容可能来自别的版本」；
 * - 若切片器拒绝、解析器接受 → 发版直接失败（可接受，属显式约束）。
 *
 * 这个测试把契约变成 CI 约束，避免两侧正则各自漂移。
 */

import { describe, expect, it } from "vitest";
import { findChangelogEntry, parseChangelog } from "@md-editor/changelog";
import { extractVersionSection } from "../../../../../scripts/release/changelog-section.mjs";

/** 每组样例：markdown、目标版本、切片器是否应接受。 */
const CASES: readonly {
  readonly name: string;
  readonly markdown: string;
  readonly version: string;
  readonly accepted: boolean;
}[] = [
  {
    name: "date + PR header",
    markdown: "## 0.16.0 - 2026-10-30 (#190)\n\n- 新增更新提示\n",
    version: "0.16.0",
    accepted: true,
  },
  {
    name: "header without date",
    markdown: "## 0.16.0\n\n- 只有列表\n",
    version: "0.16.0",
    accepted: true,
  },
  {
    name: "CRLF document",
    markdown: "## 0.16.0 - 2026-10-30\r\n\r\n- 修复问题\r\n",
    version: "0.16.0",
    accepted: true,
  },
  {
    // 标题后跟正文的畸形写法：两侧都必须拒绝，否则会出现错版本内容。
    name: "header with trailing prose",
    markdown: "## 0.16.0 - 2026-10-30 (#190) 更新内容\n\n- 条目\n",
    version: "0.16.0",
    accepted: false,
  },
  {
    name: "section without list items",
    markdown: "## 0.16.0\n\n暂无内容。\n",
    version: "0.16.0",
    accepted: false,
  },
];

describe("changelog heading contract (release slicer ↔ runtime parser)", () => {
  it.each(CASES)("agrees on acceptance: $name", ({ markdown, version, accepted }) => {
    const section = extractVersionSection(markdown, version);
    expect(section !== null).toBe(accepted);

    // 契约核心：切片器接受，解析器就必须能按版本命中。
    if (section !== null) {
      const entry = findChangelogEntry(parseChangelog(markdown), version);
      expect(entry?.version).toBe(version);
    }
  });

  it("round-trips the real desktop changelog through both implementations", async () => {
    const { readFileSync } = await import("node:fs");
    const markdown = readFileSync(
      new URL("../../../../../apps/desktop/CHANGELOG.md", import.meta.url),
      "utf8",
    );
    const versions = [...markdown.matchAll(/^##\s+(\S+)/gmu)].map((match) =>
      match[1].replace(/^v/iu, ""),
    );
    expect(versions.length).toBeGreaterThan(0);

    for (const version of versions) {
      const section = extractVersionSection(markdown, version);
      if (section === null) continue;
      expect(findChangelogEntry(parseChangelog(markdown), version)?.version).toBe(version);
    }
  });
});
