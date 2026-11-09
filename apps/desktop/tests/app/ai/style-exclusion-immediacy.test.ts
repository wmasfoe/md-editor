import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyStyleProfileDocument } from "@md-editor/ai/style";

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

import {
  excludeStylePath,
  onStyleLearningChanged,
  restoreStylePath,
} from "../../../src/app/ai/style-learning/style-exclusions";
import { useStyleLearningStore } from "../../../src/app/ai/style-learning/style-learning-store";

const workspace = () => ({
  id: "ws-1",
  rootPath: "/notes",
  linkState: "linked",
  samples: ["a.md", "b.md", "diary/secret.md"].map((relPath, index) => ({
    id: `s${index}`,
    relPath,
    sha256: `sha-${index}`,
    paragraphHashes: [],
    eligible: true,
    // 三个样本都是正式语气，剔除一个后仍能聚合出 formal。
    stats: {},
    labels: { formality: "formal" },
  })),
  rules: [
    {
      dimension: "formality",
      value: "formal",
      status: "active",
      rounds: [{ round: 3, value: "formal", supportSampleIds: ["s0", "s1", "s2"] }],
    },
  ],
  roundCount: 3,
  changesSinceRound: 0,
});

beforeEach(() => {
  disk.profile = { ...createEmptyStyleProfileDocument(), revision: 1, workspaces: [workspace()] };
  disk.exclusions = { version: 1, workspaces: {}, revision: 1 };
  useStyleLearningStore.getState().setProfile(disk.profile as never);
  useStyleLearningStore.getState().setExclusions({ version: 1, workspaces: {} });
});

describe("PRD 2.10: exclusions take effect immediately", () => {
  it("drops the excluded file from the profile without waiting for the next round", async () => {
    const changed = vi.fn();
    const unsubscribe = onStyleLearningChanged(changed);

    await excludeStylePath("/notes", "diary");

    // 画像里不再有被排除的文件，且规则已重新聚合。
    const profile = useStyleLearningStore.getState().profile!;
    expect(profile.workspaces[0]!.samples.map((sample) => sample.relPath)).toEqual([
      "a.md",
      "b.md",
    ]);
    expect(profile.workspaces[0]!.rules[0]!.rounds.at(-1)!.supportSampleIds).toEqual(["s0", "s1"]);
    // 落盘的文档同样是剔除后的版本。
    expect((disk.profile!.workspaces as Array<{ samples: unknown[] }>)[0]!.samples).toHaveLength(2);
    // 通知学习协调器在空闲时补读（恢复的文件需要重新统计）。
    expect(changed).toHaveBeenCalled();
    unsubscribe();
  });

  it("notifies the coordinator when a file is restored", async () => {
    const changed = vi.fn();
    const unsubscribe = onStyleLearningChanged(changed);
    await excludeStylePath("/notes", "diary");
    changed.mockClear();
    await restoreStylePath("/notes", "diary");
    expect(changed).toHaveBeenCalled();
    expect(useStyleLearningStore.getState().exclusions.workspaces["/notes"]).toEqual([]);
    unsubscribe();
  });
});
