// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() =>
  vi.fn(async (command: string) =>
    command === "load_style_learning_document"
      ? { version: 1, workspaces: {} }
      : command === "save_style_learning_document"
        ? 1
        : null,
  ),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }));

import { FileTreeContextMenu } from "../../src/components/FileTreePanel/FileTreeContextMenu";
import { FILE_TREE_CONTEXT_MENU_ACTION } from "../../src/desktop/file-tree-context-menu";
import {
  excludeStylePath,
  isStylePathExcluded,
  restoreStylePath,
} from "../../src/app/ai/style-learning/style-exclusions";
import { useStyleLearningStore } from "../../src/app/ai/style-learning/style-learning-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
const node = { kind: "markdown", name: "a.md", path: "/notes/diary/a.md" } as never;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  invoke.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("file tree style learning menu", () => {
  it("I-17: shows the exclude item only when style learning offers it, and runs it without a dialog", () => {
    const onRunAction = vi.fn();
    const menu = { x: 0, y: 0, node };
    act(() =>
      root.render(
        createElement(FileTreeContextMenu, {
          menu,
          onClose: vi.fn(),
          onRunAction,
          styleLearning: null,
        }),
      ),
    );
    expect(container.textContent).not.toContain("风格学习");

    act(() =>
      root.render(
        createElement(FileTreeContextMenu, {
          menu,
          onClose: vi.fn(),
          onRunAction,
          styleLearning: "exclude",
        }),
      ),
    );
    const item = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("不参与风格学习"),
    )!;
    act(() => item.click());
    expect(onRunAction).toHaveBeenCalledWith(menu, FILE_TREE_CONTEXT_MENU_ACTION.styleExclude);
    expect(document.querySelector("[role=dialog]")).toBeNull();

    act(() =>
      root.render(
        createElement(FileTreeContextMenu, {
          menu,
          onClose: vi.fn(),
          onRunAction,
          styleLearning: "restore",
        }),
      ),
    );
    expect(container.textContent).toContain("恢复参与风格学习");
  });

  it("stores exclusions in app data and matches directory prefixes", async () => {
    const excluded = await excludeStylePath("/notes", "diary");
    expect(invoke).toHaveBeenCalledWith("save_style_learning_document", {
      kind: "exclusions",
      document: { version: 1, workspaces: { "/notes": ["diary"] } },
      expectedRevision: 0,
    });
    expect(isStylePathExcluded(excluded, "/notes", "diary/a.md")).toBe(true);
    expect(isStylePathExcluded(excluded, "/notes", "diary-public.md")).toBe(false);
    expect(useStyleLearningStore.getState().exclusions).toEqual(excluded);

    // 磁盘上已是排除后的文档（revision 1），恢复基于它写入。
    invoke.mockImplementationOnce(async () => excluded);
    const restored = await restoreStylePath("/notes", "diary");
    expect(restored.workspaces["/notes"]).toEqual([]);
  });
});
