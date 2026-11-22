/**
 * @fileoverview 键位归属与「默认值 + 用户覆盖」解析的契约测试。
 *
 * 这里守护的是**单一事实来源**：同一个 chord 只能有一个主人，同一份默认值只能有一份。
 * 历史缺陷（editor 0.6.0）：`Mod-/` 在 core 表里是 `view.toggleSource`，
 * 编辑器却把 CodeMirror `defaultKeymap` 原样装上，于是同一 chord 同时是"切换源码"
 * 与"切换注释"；`Mod-b` 在 web 被写死成"切换侧边栏"，与格式化表的加粗冲突。
 */
import { describe, expect, it } from "vitest";
import {
  createBuiltInKeymaps,
  createKeymapRegistry,
  MARKDOWN_FORMATTING_KEYMAPS,
  resolveKeymaps,
  type KeymapDescriptor,
} from "../src/index.ts";

/** 归属判定与编辑器内核一致：只有显式 `owner: "editor"` 才自己安装绑定。 */
const isEditorOwned = (keymap: Pick<KeymapDescriptor, "owner">) => keymap.owner === "editor";

const keymap = (overrides: Partial<KeymapDescriptor> = {}): KeymapDescriptor => ({
  id: "format.bold",
  key: "Mod-b",
  commandId: "format.bold",
  ...overrides,
});

describe("键位归属", () => {
  it("缺省归属是 host：没声称归属的 chord 编辑器不许抢", () => {
    expect(isEditorOwned(keymap())).toBe(false);
    expect(isEditorOwned(keymap({ owner: "host" }))).toBe(false);
  });

  it("显式 owner: editor 才归编辑器安装", () => {
    expect(isEditorOwned(keymap({ owner: "editor" }))).toBe(true);
  });

  it("内建格式化键位全部归编辑器所有", () => {
    const builtIn = createBuiltInKeymaps();
    const formatting = builtIn.filter((entry) => entry.id.startsWith("format."));
    expect(formatting.length).toBe(MARKDOWN_FORMATTING_KEYMAPS.length);
    for (const entry of formatting) {
      expect(entry.owner, `${entry.id} 应由编辑器安装绑定`).toBe("editor");
    }
  });

  it("内建表里除格式化命令外都归宿主：编辑器不得安装宿主语义的键位", () => {
    const others = createBuiltInKeymaps().filter((entry) => !entry.id.startsWith("format."));
    expect(others.length).toBeGreaterThan(0);
    for (const entry of others) {
      expect(entry.owner, `${entry.id} 不该由编辑器安装绑定`).toBeUndefined();
    }
  });

  it("同一 chord 不允许被两条条目占用（跨归属也一样）", () => {
    const registry = createKeymapRegistry();
    registry.register({
      id: "format.bold",
      key: "Mod-b",
      commandId: "format.bold",
      owner: "editor",
    });
    expect(() =>
      registry.register({
        id: "view.toggleSidebar",
        key: "Mod-b",
        commandId: "view.toggleSidebar",
      }),
    ).toThrow(/Ambiguous key binding/);
  });
});

describe("默认键位表", () => {
  it("id 与默认 chord 都不重复", () => {
    const ids = MARKDOWN_FORMATTING_KEYMAPS.map((entry) => entry.id);
    const keys = MARKDOWN_FORMATTING_KEYMAPS.map((entry) => entry.key.toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("内建键位表能把全部格式化命令装配出来（feature 与默认表不脱钩）", () => {
    const builtIn = createBuiltInKeymaps();
    for (const entry of MARKDOWN_FORMATTING_KEYMAPS) {
      const registered = builtIn.find((candidate) => candidate.id === entry.id);
      expect(registered, `${entry.id} 未出现在内建键位表`).toBeDefined();
      expect(registered?.key).toBe(entry.key);
      expect(registered?.commandId).toBe(entry.id);
    }
  });
});

describe("resolveKeymaps", () => {
  const base: readonly KeymapDescriptor[] = [
    keymap({ id: "format.bold", key: "Mod-b", commandId: "format.bold", owner: "editor" }),
    keymap({ id: "file.save", key: "Mod-s", commandId: "file.save" }),
  ];

  it("没有覆盖时原样返回默认 chord", () => {
    const resolved = resolveKeymaps(base);
    expect(resolved.get("format.bold")).toBe("Mod-b");
    expect(resolved.get("file.save")).toBe("Mod-s");
  });

  it("覆盖生效，未覆盖的条目保持默认", () => {
    const resolved = resolveKeymaps(base, { "format.bold": "Mod-Shift-b" });
    expect(resolved.get("format.bold")).toBe("Mod-Shift-b");
    expect(resolved.get("file.save")).toBe("Mod-s");
  });

  it("覆盖为 null 表示显式解绑：条目不再占用任何按键", () => {
    const resolved = resolveKeymaps(base, { "file.save": null });
    expect(resolved.has("file.save")).toBe(false);
    expect(resolved.get("format.bold")).toBe("Mod-b");
  });

  it("覆盖为空白串同样视为解绑（设置面板清空输入的残留）", () => {
    const resolved = resolveKeymaps(base, { "format.bold": "   " });
    expect(resolved.has("format.bold")).toBe(false);
  });

  it("覆盖表里的未知 id 不会凭空产生绑定", () => {
    const resolved = resolveKeymaps(base, { "legacy.command": "Mod-l" });
    expect(resolved.has("legacy.command")).toBe(false);
    expect([...resolved.keys()].toSorted()).toEqual(["file.save", "format.bold"]);
  });
});
