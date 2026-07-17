export type S1CapabilityDisposition = "retained" | "removed-disabled" | "typed-unsupported";

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
  "view.toggleSidebarPrimary",
] as const;

const legacyModeCommands = ["view.toggleSource", "view.showWysiwyg"] as const;
const deferredLegacyCommands = ["mdx.openComponentMenu", "ai.continueWriting"] as const;
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

export const S1_REGISTERED_COMMAND_IDS = [
  ...implementedCommands,
  ...legacyModeCommands,
  ...deferredLegacyCommands,
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
