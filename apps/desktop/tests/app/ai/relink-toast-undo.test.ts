import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  exclusions: null as Record<string, unknown> | null,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === "load_style_learning_document") {
      return args?.kind === "profile" ? disk.profile : disk.exclusions;
    }
    if (command === "save_style_learning_document") {
      const target = args!.kind === "profile" ? disk.profile : disk.exclusions;
      const current = (target?.revision as number | undefined) ?? 0;
      const saved = { ...(args!.document as object), revision: current + 1 };
      if (args!.kind === "profile") disk.profile = saved;
      else disk.exclusions = saved;
      return current + 1;
    }
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));

import { createEmptyStyleProfileDocument } from "@md-editor/ai/style";
import {
  moveStyleExclusions,
  undoStyleRelinkTo,
} from "../../../src/app/ai/style-learning/style-exclusions";
import { useStyleLearningStore } from "../../../src/app/ai/style-learning/style-learning-store";
import { useToastStore } from "../../../src/app/stores/toast-store";

const relocated = () => ({
  ...createEmptyStyleProfileDocument(),
  revision: 2,
  workspaces: [
    {
      id: "ws-1",
      rootPath: "/notes/new",
      linkState: "linked" as const,
      relinkedFrom: { rootPath: "/notes/old", at: "2026-11-09T00:00:00Z" },
      samples: [],
      rules: [],
      roundCount: 1,
      changesSinceRound: 0,
    },
  ],
});

beforeEach(() => {
  disk.profile = relocated();
  disk.exclusions = { version: 1, workspaces: { "/notes/old": ["diary"] }, revision: 1 };
  useStyleLearningStore.getState().setProfile(disk.profile as never);
  useToastStore.getState().showToast(null);
});

describe("I-6: relink notice offers undo", () => {
  it("the toast action undoes the relink and moves exclusions back", async () => {
    // 主窗口在找回成功时做的两件事：迁移排除列表 + 弹带“撤销”的提示。
    await moveStyleExclusions("/notes/old", "/notes/new");
    useToastStore.getState().showToast("已识别工作区移动，写作偏好已跟随", {
      label: "撤销找回",
      run: () => {
        void undoStyleRelinkTo("ws-1", "/notes/new", "/notes/old");
      },
    });

    const toast = useToastStore.getState().toast!;
    expect(toast.message).toContain("写作偏好已跟随");
    expect(toast.action?.label).toBe("撤销找回");

    await toast.action!.run();
    await vi.waitFor(() => {
      const workspace = useStyleLearningStore
        .getState()
        .profile!.workspaces.find((entry) => entry.id === "ws-1")!;
      expect(workspace.rootPath).toBe("/notes/old");
      expect(workspace.linkState).toBe("unlinked");
      // 撤销后不再自动找回到该目录。
      expect(workspace.relinkDeclined).toContain("/notes/new");
    });
    // 排除列表跟着回到原目录。
    expect(useStyleLearningStore.getState().exclusions.workspaces["/notes/old"]).toEqual(["diary"]);
  });

  it("a plain toast has no action", () => {
    useToastStore.getState().showToast("已保存");
    expect(useToastStore.getState().toast?.action).toBeUndefined();
  });
});
