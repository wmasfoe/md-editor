/**
 * @file keymap.ts
 * @description 快捷键描述符、**归属**与「默认值 + 用户覆盖」的解析契约。
 *
 * ## 为什么需要归属字段
 *
 * 一个 chord 的语义只能有一个主人，否则两侧会各自绑一次、行为随焦点位置漂移。
 * 历史教训（`@md-editor/editor` 0.6.0）：`Mod-/` 在 core 的键位表里是
 * `view.toggleSource`，但编辑器把 CodeMirror 的 `defaultKeymap` 原样装上，
 * 于是同一 chord 同时意味着"切换源码"与"切换 HTML 注释"。
 *
 * `owner` 把这条约定变成数据：
 * - `"editor"`：编辑器内核自己安装 keydown 监听（CodeMirror keymap）。
 * - `"host"`：宿主（应用窗口）安装监听并派发。
 *
 * **缺省是 `"host"`**：编辑器不会去抢一个没声称归属的 chord，这是更安全的默认值。
 *
 * ## 为什么需要 resolveKeymaps
 *
 * 默认 chord、用户自定义、显式解绑（`null`）、空串残留（设置面板清空输入）这四种情况
 * 需要在所有宿主里按同一套规则合并。此前 desktop / web / editor 各自写一遍
 * `new Map(settings.shortcuts.map(...))`，语义各自漂移。
 */

export interface KeymapDescriptor {
  readonly id: string;
  readonly key: string;
  readonly commandId: string;
  readonly when?: string;
  /**
   * 该 chord 的语义归属，缺省 `"host"`。
   *
   * - `"editor"`：编辑器内核自己安装 keydown 监听（CodeMirror keymap）；
   * - 缺省：宿主安装监听并派发，编辑器一条都不绑，事件自由冒泡
   *   （即使宿主在 bubble 阶段监听也能收到）。
   *
   * 判断用 `keymap.owner === "editor"` 即可，不额外提供谓词函数 —— 少一个公开符号。
   */
  readonly owner?: "editor" | "host";
}

/**
 * 合并「默认键位表 + 用户覆盖」。
 *
 * 规则（所有宿主共用，避免各自解释）：
 * - 未覆盖 → 用默认 chord；
 * - 覆盖为 `null` 或空白串 → 该 id **不出现在结果里**（解绑；空白串是设置面板清空输入的残留）；
 * - 覆盖表里存在、但默认表里没有的 id → 忽略（防止历史遗留 id 凭空产生绑定）。
 *
 * 返回值是 `id → 生效 chord`，宿主用它建按键匹配表，编辑器端口用它重配 CodeMirror keymap。
 */
export function resolveKeymaps(
  base: readonly KeymapDescriptor[],
  /** `null` 表示显式解绑（保留条目语义、但不再占用任何按键）；缺省表示沿用默认值。 */
  overrides: Readonly<Record<string, string | null>> = {},
): ReadonlyMap<string, string> {
  const resolved = new Map<string, string>();
  for (const keymap of base) {
    const override = overrides[keymap.id];
    const key = override === undefined ? keymap.key : override;
    if (key === null || key === undefined || key.trim() === "") {
      continue;
    }
    resolved.set(keymap.id, key);
  }
  return resolved;
}

/**
 * Markdown 格式化命令的默认键位。
 *
 * **单一事实来源**：`createMarkdownFormattingFeature()`（注册命令与键位）、
 * `@md-editor/editor`（CodeMirror 绑定）、desktop 的快捷键设置默认值、
 * web 的快捷键速查表都从这里取默认 chord，不允许各自抄字串。
 *
 * 形状就是 `KeymapDescriptor` + `title`，因此可以直接喂给 `resolveKeymaps()`：
 * 宿主不需要为“格式化命令”和“其它命令”写两套合并逻辑。
 *
 * 只描述**主键**。同一命令的备用别名（如 `Mod-Shift-k` 之于 `format.codeBlock`）
 * 不属于用户可改写的默认值，由编辑器作为固定别名单独维护。
 */
/** 默认 chord 原始表：`commandId` 恒等于 `id`、归属恒为编辑器，故不重复书写。 */
const FORMATTING_DEFAULTS: readonly {
  readonly id: string;
  readonly title: string;
  readonly key: string;
}[] = [
  { id: "format.bold", title: "Bold", key: "Mod-b" },
  { id: "format.italic", title: "Italic", key: "Mod-i" },
  { id: "format.strikethrough", title: "Strikethrough", key: "Mod-Shift-S" },
  { id: "format.inlineCode", title: "Inline Code", key: "Mod-e" },
  { id: "format.highlight", title: "Highlight", key: "Mod-Shift-H" },
  { id: "format.codeBlock", title: "Code Block", key: "Mod-Shift-C" },
  { id: "format.blockquote", title: "Blockquote", key: "Mod-Shift-Q" },
  { id: "format.bulletList", title: "Bullet List", key: "Mod-Shift-U" },
  { id: "format.orderedList", title: "Ordered List", key: "Mod-Shift-O" },
  { id: "format.taskList", title: "Task List", key: "Mod-Shift-T" },
  { id: "format.heading1", title: "Heading 1", key: "Mod-Alt-1" },
  { id: "format.heading2", title: "Heading 2", key: "Mod-Alt-2" },
  { id: "format.heading3", title: "Heading 3", key: "Mod-Alt-3" },
  { id: "format.heading4", title: "Heading 4", key: "Mod-Alt-4" },
  { id: "format.heading5", title: "Heading 5", key: "Mod-Alt-5" },
  { id: "format.heading6", title: "Heading 6", key: "Mod-Alt-6" },
  { id: "format.paragraph", title: "Paragraph", key: "Mod-Alt-0" },
];

export const MARKDOWN_FORMATTING_KEYMAPS: readonly (KeymapDescriptor & {
  readonly title: string;
})[] = FORMATTING_DEFAULTS.map((entry) => ({
  ...entry,
  commandId: entry.id,
  owner: "editor" as const,
}));
