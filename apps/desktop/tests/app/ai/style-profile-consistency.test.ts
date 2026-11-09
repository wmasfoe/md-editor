import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyStyleProfileDocument, type StyleProfileDocument } from "@md-editor/ai/style";

/** 模拟 Rust 存储：revision 比较后写入，清除后 revision 归零 */
const disk = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  saves: 0,
  emitted: [] as Array<{ event: string; payload: unknown }>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === "load_style_learning_document") return disk.profile;
    if (command === "save_style_learning_document") {
      const current = (disk.profile?.revision as number | undefined) ?? 0;
      if (current !== args!.expectedRevision) throw new Error("style-learning-stale");
      disk.saves += 1;
      disk.profile = { ...(args!.document as object), revision: current + 1 };
      return current + 1;
    }
    if (command === "clear_style_learning_document") {
      disk.profile = null;
      return null;
    }
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async (event: string, payload: unknown) => {
    disk.emitted.push({ event, payload });
  }),
  listen: vi.fn(async () => () => {}),
}));

import { updateStyleProfile } from "../../../src/app/ai/style-learning/style-learning-host";
import { isNewerProfile } from "../../../src/app/ai/style-learning/style-learning-store";

beforeEach(() => {
  disk.profile = null;
  disk.saves = 0;
  disk.emitted = [];
});

describe("style profile consistency", () => {
  it("retries a stale write against the latest document and broadcasts the result", async () => {
    disk.profile = { ...createEmptyStyleProfileDocument(), revision: 1 };
    let first = true;
    const saved = await updateStyleProfile((latest) => {
      if (first) {
        first = false;
        // 另一个窗口在本次读取之后写入了一条自定义规则。
        disk.profile = {
          ...latest,
          revision: 2,
          custom: [{ kind: "note", id: "other", text: "其他窗口" }],
        };
      }
      return {
        ...latest,
        custom: [...latest.custom, { kind: "note", id: "mine", text: "本窗口" }],
      };
    });
    expect(saved.custom.map((rule) => rule.id)).toEqual(["other", "mine"]);
    expect(disk.saves).toBe(1);
    expect(disk.emitted.at(-1)).toMatchObject({ event: "md-editor-style-profile-changed" });
  });

  it("skips the write when the change returns the latest document unchanged", async () => {
    disk.profile = { ...createEmptyStyleProfileDocument(), revision: 4 };
    await updateStyleProfile((latest) => latest);
    expect(disk.saves).toBe(0);
    expect(disk.emitted).toEqual([]);
  });

  it("accepts clears and new epochs but never an older revision of the same epoch", () => {
    const base: StyleProfileDocument = { ...createEmptyStyleProfileDocument(), revision: 5 };
    expect(isNewerProfile(base, null)).toBe(true);
    expect(isNewerProfile(base, { ...base, revision: 4 })).toBe(false);
    expect(isNewerProfile(base, { ...base, revision: 6 })).toBe(true);
    expect(isNewerProfile(base, { ...createEmptyStyleProfileDocument(), revision: 1 })).toBe(true);
    expect(isNewerProfile(null, base)).toBe(true);
  });
});
