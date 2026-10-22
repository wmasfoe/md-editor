/**
 * UtoolsFileTree 折叠语义的回归契约。
 *
 * 背景：`UtoolsFileTree` 曾自带一份 `isSameOrChildPath` / `collectAncestorDirectoryPaths` /
 * `visitDirectoryNodes` / `createDefaultCollapsedDirectoryPaths` 私有副本，与
 * `@md-editor/file-system` 的 `tree-view-state` 重复。去重后组件直接复用共享实现，
 * 因此这里锁定「uTools 文件树形状 + 共享 helper」的期望结果：
 * 一旦共享 helper 的折叠语义被改动，uTools 侧会在此处先失败，而不是静默改变折叠行为。
 *
 * 说明：本测试只覆盖纯路径/树逻辑，不渲染组件，因此无需 DOM 环境或新增测试依赖。
 * 组件级行为由 `UtoolsFileTree` 消费同一组共享 helper 间接保证。
 */
import { describe, expect, it } from "vitest";
import {
  collectAncestorDirectoryPaths,
  createDefaultCollapsedDirectoryPaths,
  isSameOrChildPath,
  type MarkdownFileTreeNode,
} from "@md-editor/file-system";

const ROOT = "/Users/demo/notes";

function notesTree(): MarkdownFileTreeNode {
  return {
    name: "notes",
    path: ROOT,
    kind: "directory",
    children: [
      { name: "readme.md", path: `${ROOT}/readme.md`, kind: "markdown" },
      {
        name: "guide",
        path: `${ROOT}/guide`,
        kind: "directory",
        children: [
          { name: "intro.md", path: `${ROOT}/guide/intro.md`, kind: "markdown" },
          {
            name: "drafts",
            path: `${ROOT}/guide/drafts`,
            kind: "directory",
            children: [{ name: "wip.md", path: `${ROOT}/guide/drafts/wip.md`, kind: "markdown" }],
          },
        ],
      },
      {
        name: "assets",
        path: `${ROOT}/assets`,
        kind: "directory",
        children: [{ name: "cover.png", path: `${ROOT}/assets/cover.png`, kind: "asset" }],
      },
    ],
  };
}

describe("uTools 文件树折叠契约（复用 @md-editor/file-system）", () => {
  it("默认折叠非活跃文件祖先的所有目录", () => {
    const collapsed = createDefaultCollapsedDirectoryPaths(notesTree(), `${ROOT}/guide/intro.md`);

    // guide 是活跃文件的祖先目录，保持展开；drafts 与 assets 折叠。
    expect(collapsed).toEqual(new Set([`${ROOT}/assets`, `${ROOT}/guide/drafts`]));
  });

  it("没有活跃文件时折叠全部子目录（根目录不折叠）", () => {
    const collapsed = createDefaultCollapsedDirectoryPaths(notesTree(), null);

    expect(collapsed).toEqual(new Set([`${ROOT}/assets`, `${ROOT}/guide`, `${ROOT}/guide/drafts`]));
    expect(collapsed.has(ROOT)).toBe(false);
  });

  it("祖先目录集合从活跃文件逐级向上直到根目录", () => {
    const ancestors = collectAncestorDirectoryPaths(ROOT, `${ROOT}/guide/drafts/wip.md`);

    expect(ancestors).toEqual(new Set([ROOT, `${ROOT}/guide`, `${ROOT}/guide/drafts`]));
  });

  it("活跃路径位于根目录之外时不算子路径（避免误展开）", () => {
    expect(isSameOrChildPath(`${ROOT}/guide/intro.md`, ROOT)).toBe(true);
    expect(isSameOrChildPath(ROOT, ROOT)).toBe(true);
    expect(isSameOrChildPath("/Users/demo/other/intro.md", ROOT)).toBe(false);
    // 前缀相同但不是子孙目录，不能被判定为子路径。
    expect(isSameOrChildPath("/Users/demo/notes-archive/a.md", ROOT)).toBe(false);
  });
});
