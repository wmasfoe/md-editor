/**
 * @file default-keymap-policy.ts
 * @description 编辑器对 CodeMirror `defaultKeymap` 的**准入策略**。
 *
 * ## 为什么需要这一层
 *
 * `defaultKeymap` 是面向"通用代码编辑器"的键位表（注释切换、删整行、跳父语法节点…），
 * 而本编辑器是 **prose 编辑器**：同一个 chord 在这里往往另有语义。CM6 的 `keymap` facet
 * 按配置顺序派发，先命中且返回 `true` 的绑定即终止后续（`@codemirror/view` `runHandlers`），
 * 所以「谁先装谁赢」。一旦把 `defaultKeymap` 原样装在最前面，它就会**静默压过**
 * 编辑器自己的格式化键位与宿主的全局快捷键，而且从代码上完全看不出来。
 *
 * 实测（真实浏览器，只挂 `CodeMirrorEditor`、不装宿主绑定）：
 * - `Mod-/` → 文档被写成 `<!-- hello world -->`，而 core 的键位表里
 *   `view.toggleSource` 明确声明 `Mod-/` 是"切换源码/所见即所得"（`packages/core/src/index.ts`）；
 * - `Mod-Shift-k` → 整行被删除，而格式化表里它是 `insertCodeBlock` 的备用键。
 *
 * 两者都是"表里声明了 A，实际执行 B"的契约破损。
 *
 * ## 两条规则的其中一条
 *
 * 键位的归属分两类，处置方式不同：
 *
 * 1. **编辑器拥有语义**（加粗、斜体、链接、代码块…）→ 由 `createMarkdownFormattingKeymap`
 *    以 `Prec.high` 装上，稳定压过 `defaultKeymap`。见 `wysiwyg/editing/markdown-formatting.ts`。
 * 2. **宿主拥有语义**（切换模式、保存、打开、设置…）→ 见下面的 `SUPPRESSED_CODEMIRROR_KEYS`：
 *    编辑器**一条绑定都不装**，让 keydown 自由冒泡到宿主。
 *
 * 第 2 类**不能**用 `Prec.highest` + 空实现来"吞掉"：那等于库偷偷把键从宿主手里拿走，
 * 宿主再想用只能靠 `window` capture，属于把内部实现细节外泄成契约。
 *
 * ## 维护约定
 *
 * 往 `SUPPRESSED_CODEMIRROR_KEYS` 里加条目时：
 * - 必须在这里写清「哪个宿主命令拥有它」，没有归属就不该进表；
 * - `tests/renderer/keymap-policy.test.ts` 会断言每条都能在**上游 `defaultKeymap`** 里找到，
 *   上游改名/删除时测试变红，逼人重新做决定，而不是静默失效。
 */

import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { TOGGLE_SOURCE_SHORTCUT } from "@md-editor/core";
import type { Extension } from "@codemirror/state";
import { keymap, type KeyBinding } from "@codemirror/view";

/**
 * 从 `defaultKeymap` 中剔除的 chord：语义归宿主，编辑器不绑任何绑定。
 *
 * - `Mod-/`：`view.toggleSource`（切换源码 / 所见即所得）。上游绑定 `toggleComment`，
 *   在 Markdown 里会产出 `<!-- -->`，本编辑器没有任何"注释"概念。
 */
export const SUPPRESSED_CODEMIRROR_KEYS: readonly string[] = ["Mod-/"];

/**
 * 拆出「主键 + 修饰键集合」，用于归一化比较。
 *
 * 用 `split(/-(?!$)/)` 而不是 `split("-")`：主键本身可能就是 `-`（CM 写作 `Mod--`），
 * 按 `-` 直接切会把它拆成空串。这个正则与 CodeMirror 自己的 `normalizeKeyName`
 * （`@codemirror/view` buildKeymap）一致，保证两边拆法相同。
 *
 * 修饰键排序后拼接，所以 `Shift-Mod-k` 与 `Mod-Shift-k` 得到同一个修饰键集合；
 * 主键转小写，因为 CM 对字母键的大小写差异等价于是否按 Shift。
 */
function splitChord(chord: string): { main: string; modifiers: string } {
  const parts = chord.split(/-(?!$)/);
  const main = (parts.pop() ?? "").toLowerCase();
  return { main, modifiers: parts.filter(Boolean).toSorted().join("-") };
}

/**
 * 判断两个 chord 字符串是否指向**同一个键位**。
 *
 * CodeMirror 会归一化修饰键顺序与字母大小写：上游的 `Shift-Mod-k` 与格式化表里的
 * `Mod-Shift-k` 在派发时是同一个 chord（实测 `Mod-Shift-k` 确实被上游 `deleteLine` 吃掉）。
 * 因此按字串比较会漏判，必须按"修饰键集合 + 主键"比较。
 *
 * 不做平台化（`Cmd` ↔ `Mod`）：调用方传入的都是 CM 风格的 `Mod` 写法。
 */
export function chordsMatch(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const a = splitChord(left);
  const b = splitChord(right);
  return a.main === b.main && a.modifiers === b.modifiers;
}

/**
 * 判断一条上游绑定是否命中剔除清单。
 *
 * 同时匹配 `key` / `mac` / `win`：CM 允许平台变体（如 `{ key: "Alt-l", mac: "Ctrl-l" }`），
 * 只比 `key` 会在 mac 上放过真正生效的那个 chord。
 */
function isSuppressed(binding: KeyBinding): boolean {
  return [binding.key, binding.mac, binding.win].some((chord) =>
    SUPPRESSED_CODEMIRROR_KEYS.some((suppressed) => chordsMatch(chord, suppressed)),
  );
}

/**
 * 本编辑器采用的 `defaultKeymap`：上游列表减去剔除清单。
 *
 * 返回新数组（不修改上游常量）；除剔除项外**保持上游顺序**，因为同层内的顺序本身就是优先级。
 */
export function createEditorDefaultKeymapBindings(): readonly KeyBinding[] {
  return defaultKeymap.filter((binding) => !isSuppressed(binding));
}

/**
 * 编辑器内置键位需要的回调（由渲染器选项注入）。
 *
 * 用对象而不是位置参数数组：装配顺序、chord 取值、以及"哪个能力缺省就不装绑定"
 * 全部由本模块决定，调用方只负责提供实现。
 */
export interface EditorKeymapHooks {
  /** `Mod-Shift-Enter`：编辑 Mermaid 源码。 */
  readonly editMermaid?: () => boolean;
  /**
   * `Mod-/`：切换源码 / 所见即所得（`view.toggleSource`）。
   *
   * 桥接层总会提供 —— 它同时持有 `DocumentState` 与渲染器，能独立完成两阶段切换，
   * 因此宿主**不需要**再自己绑这个键。
   */
  readonly onToggleSourceMode?: () => boolean;
  /**
   * 覆盖 `view.toggleSource` 的生效 chord（缺省用 core 的 `TOGGLE_SOURCE_SHORTCUT`）。
   *
   * 宿主把用户自定义快捷键合并后传进来；空白串表示用户解绑了该命令，此时不安装绑定。
   */
  readonly toggleSourceKey?: string;
}

/**
 * 根键位扩展：内置命令键位 + 搜索键位 + 准入后的默认键位 + 撤销重做键位。
 *
 * 装配集中在这里（而不是散在 `root-extensions.ts` 的数组字面量里），
 * 这样"哪些上游键位被剔除""内置命令占哪个 chord"只有一个事实来源，
 * 测试断言的也是生产用的这份装配。
 */
export function createEditorKeymapExtension(hooks: EditorKeymapHooks = {}): Extension {
  const builtIn: KeyBinding[] = [];
  if (hooks.editMermaid) {
    builtIn.push({ key: "Mod-Shift-Enter", run: hooks.editMermaid });
  }
  const toggleSourceKey = hooks.toggleSourceKey ?? TOGGLE_SOURCE_SHORTCUT;
  if (hooks.onToggleSourceMode && toggleSourceKey.trim() !== "") {
    builtIn.push({ key: toggleSourceKey, run: hooks.onToggleSourceMode });
  }
  return keymap.of([
    ...builtIn,
    ...searchKeymap,
    ...createEditorDefaultKeymapBindings(),
    ...historyKeymap,
  ]);
}
