export type S1CapabilityDisposition =
  | "retained"
  | "removed-disabled"
  | "typed-unsupported"
  /** S1 基线之后新增的能力（D-3 块操作 / D-2 视图模式等）—— “retained” 暗示基线已存在，对新能力是失实来源（code-review LOW） */
  | "new-capability";

export type S1CapabilityBaseline = "implemented" | "legacy-engine" | "silent-noop-blocker";

export interface S1CapabilityInventoryEntry {
  readonly id: string;
  readonly kind: "command" | "surface" | "setting";
  readonly baseline: S1CapabilityBaseline;
  readonly s1Disposition: S1CapabilityDisposition;
  readonly note: string;
}

const implementedCommands = [
  "file.new",
  "file.open",
  "file.openRecent",
  "file.openFolder",
  "file.save",
  "file.saveAs",
  "settings.open",
  "app.about",
  "table.insert",
  "view.toggleSidebarPrimary",
] as const;

const legacyModeCommands = ["view.toggleSource", "view.showWysiwyg"] as const;
const deferredLegacyCommands = [
  "mdx.openComponentMenu",
  "ai.continueWriting",
  "ai.fixGrammar",
] as const;
const silentNoopCommands = [
  "format.bold",
  "format.italic",
  "format.code",
  "format.strikethrough",
  "format.link",
  "format.codeBlock",
  "format.blockquote",
  "format.bulletList",
  "format.orderedList",
  "format.heading1",
  "format.heading2",
  "format.heading3",
] as const;

/** D-3 块操作命令（CM6 新能力，非 S1 迁移遗留项） */
const d3BlockCommands = [
  "block.moveUp",
  "block.moveDown",
  "block.duplicate",
  "block.delete",
] as const;

/** D-2 视图模式命令（专注/打字机：renderer StateField 开关 + macOS View 菜单勾选项） */
const d2ViewModeCommands = ["view.toggleFocusMode", "view.toggleTypewriterMode"] as const;

/** 文档历史版本与快照回滚命令 */
const historyCommands = ["file.history"] as const;

/** 专业输出与质量检查命令（HTML/PDF 导出、剪贴板富文本与链接检查） */
const exportAndQualityCommands = [
  "file.exportHtml",
  "file.exportPdf",
  "edit.copyAsHtml",
  "file.checkLinks",
  "lint.run",
  "lint.fixAll",
  "lint.clear",
] as const;

export const S1_REGISTERED_COMMAND_IDS = [
  ...implementedCommands,
  ...historyCommands,
  ...exportAndQualityCommands,
  ...legacyModeCommands,
  ...deferredLegacyCommands,
  ...d3BlockCommands,
  ...d2ViewModeCommands,
] as const;

export const S1_REMOVED_COMMAND_IDS = silentNoopCommands;

export const S1_CAPABILITY_INVENTORY: readonly S1CapabilityInventoryEntry[] = Object.freeze([
  ...implementedCommands.map((id) => ({
    id,
    kind: "command" as const,
    baseline: "implemented" as const,
    s1Disposition: "retained" as const,
    note: "Desktop shell/file command remains available through the core command registry.",
  })),
  ...legacyModeCommands.map((id) => ({
    id,
    kind: "command" as const,
    baseline: "legacy-engine" as const,
    s1Disposition: "retained" as const,
    note: "Replace the current dual-editor switch with one CM6 view reconfiguration.",
  })),
  ...deferredLegacyCommands.map((id) => ({
    id,
    kind: "command" as const,
    baseline: "legacy-engine" as const,
    s1Disposition: "typed-unsupported" as const,
    note: "The retained shortcut reports a visible typed-unsupported result in the CM6 beta.",
  })),
  ...silentNoopCommands.map((id) => ({
    id,
    kind: "command" as const,
    baseline: "silent-noop-blocker" as const,
    s1Disposition: "removed-disabled" as const,
    note: "The baseline command only logged; S1 removes it from the active runtime registry.",
  })),
  {
    id: "block.moveUp",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "New-in-D-3 block operation: move block up, reusing renderer block-move.ts.",
  },
  {
    id: "block.moveDown",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "New-in-D-3 block operation: move block down, reusing renderer block-move.ts.",
  },
  {
    id: "block.duplicate",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "New-in-D-3 block operation: duplicate block with blank-line normalization.",
  },
  {
    id: "block.delete",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "New-in-D-3 block operation: delete block through protected transactions.",
  },
  {
    id: "view.toggleFocusMode",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "New-in-D-2 focus mode: renderer focusModeField toggle mirrored to macOS View menu check state.",
  },
  {
    id: "view.toggleTypewriterMode",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "New-in-D-2 typewriter mode: renderer typewriterModeField toggle mirrored to macOS View menu check state.",
  },
  {
    id: "file.history",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "Document snapshot history drawer and version restoration.",
  },
  {
    id: "file.exportHtml",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "Dual-mode HTML export (standalone and linked assets).",
  },
  {
    id: "file.exportPdf",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "Print to PDF export with pagination and break-inside protection.",
  },
  {
    id: "edit.copyAsHtml",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "Copy semantic rich-text HTML into system clipboard.",
  },
  {
    id: "file.checkLinks",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "Local relative link validation and markdownlint formatting inspection.",
  },
  {
    id: "lint.run",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "Run on-demand MarkdownLint inspection, display diagnostics, and open dock panel.",
  },
  {
    id: "lint.fixAll",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "Batch fix all auto-fixable MarkdownLint issues with single-step atomic undo.",
  },
  {
    id: "lint.clear",
    kind: "command",
    baseline: "implemented",
    s1Disposition: "new-capability",
    note: "Clear on-demand MarkdownLint diagnostics and close dock panel.",
  },
  {
    id: "editor.markdown-input-history",
    kind: "surface",
    baseline: "legacy-engine",
    s1Disposition: "retained",
    note: "Move Markdown input and undo/redo to the raw CM6 renderer.",
  },
  {
    id: "editor.mode-state-preservation",
    kind: "surface",
    baseline: "legacy-engine",
    s1Disposition: "retained",
    note: "History, selection, focus, and scroll preservation are S1 release gates.",
  },
  {
    id: "editor.asset-preview",
    kind: "surface",
    baseline: "implemented",
    s1Disposition: "retained",
    note: "Keep the editor mounted behind a sibling preview overlay.",
  },
  {
    id: "editor.image-paste-drop",
    kind: "surface",
    baseline: "legacy-engine",
    s1Disposition: "removed-disabled",
    note: "Deferred beyond S1; remove/disable entry or expose typed unsupported.",
  },
  {
    id: "editor.link-open",
    kind: "surface",
    baseline: "legacy-engine",
    s1Disposition: "removed-disabled",
    note: "Deferred beyond S1; no retained silent handler.",
  },
  {
    id: "editor.search-outline",
    kind: "surface",
    baseline: "legacy-engine",
    s1Disposition: "removed-disabled",
    note: "Search/outline parity is deferred and must be listed as a beta gap.",
  },
  {
    id: "editor.full-theme-parity",
    kind: "surface",
    baseline: "legacy-engine",
    s1Disposition: "removed-disabled",
    note: "Full editor theme parity is deferred and must not be claimed for S1.",
  },
  {
    id: "editor.line-numbers",
    kind: "setting",
    baseline: "legacy-engine",
    s1Disposition: "retained",
    note: "Port to a CM6 configuration compartment without replacing the view/state.",
  },
  {
    id: "editor.font-size",
    kind: "setting",
    baseline: "legacy-engine",
    s1Disposition: "retained",
    note: "Retain through editor-host CSS variables.",
  },
]);

export function getS1CapabilityInventory(): readonly S1CapabilityInventoryEntry[] {
  return Object.freeze(S1_CAPABILITY_INVENTORY.map((entry) => Object.freeze({ ...entry })));
}
