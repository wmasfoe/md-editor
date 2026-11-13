import type * as CodeMirrorState from "@codemirror/state";
import type * as CodeMirrorView from "@codemirror/view";
import type * as LezerMarkdown from "@lezer/markdown";
import type * as LezerCommon from "@lezer/common";
import type { MarkdownSyntaxPlugin } from "./syntax.js";

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly apiVersion: 1;
}
export interface PluginCatalogEntry extends PluginManifest {
  readonly asset: string;
}
export interface PluginCatalog {
  readonly schemaVersion: 1;
  readonly plugins: readonly PluginCatalogEntry[];
}
export interface PluginExample {
  readonly id: string;
  readonly name: string;
  readonly markdown: string;
  readonly selection?: { readonly anchor: number; readonly head: number };
  readonly instructions?: string;
}
export type PluginSettingValue = string | number | boolean;
export type PluginSettingDefinition =
  | { readonly type: "string"; readonly label: string; readonly default: string }
  | { readonly type: "number"; readonly label: string; readonly default: number }
  | { readonly type: "boolean"; readonly label: string; readonly default: boolean }
  | {
      readonly type: "enum";
      readonly label: string;
      readonly default: string;
      readonly values: readonly string[];
    };
export interface PluginPackage {
  readonly manifest: PluginManifest;
  readonly code: string;
  readonly styles?: string;
  readonly examples: readonly PluginExample[];
  readonly settings?: Readonly<Record<string, PluginSettingDefinition>>;
}
export interface Disposable {
  dispose(): void;
}
export interface PluginCommand {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** Suggested only: hosts bind shortcuts after the user explicitly chooses one. */
  readonly suggestedKey?: string;
  run(): void | Promise<void>;
}
export interface PluginKeymap {
  readonly id: string;
  readonly key: string;
  readonly commandId: string;
}
export interface PluginEditorSnapshot {
  readonly markdown: string;
  readonly selection: { readonly anchor: number; readonly head: number };
  readonly documentGeneration: number;
  readonly contentRevision: number;
}
export interface PluginEditRequest {
  readonly markdown: string;
  readonly expectedGeneration: number;
  readonly expectedContentRevision: number;
  readonly selection?: "preserve-offset-clamped" | "start" | "end";
}
export interface PluginEditResult {
  readonly status:
    "applied" | "noop" | "queued-composition" | "stale" | "cancelled" | "reconcile-required";
}
export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly signal: AbortSignal;
  readonly syntax: { register(plugin: MarkdownSyntaxPlugin): Disposable };
  readonly commands: { register(command: PluginCommand): Disposable };
  readonly keymaps: { register(keymap: PluginKeymap): Disposable };
  readonly editor: {
    getSnapshot(): PluginEditorSnapshot;
    applyEdit(request: PluginEditRequest): Promise<PluginEditResult>;
  };
  readonly settings: {
    get(): Readonly<Record<string, PluginSettingValue>>;
    update(patch: Readonly<Record<string, PluginSettingValue>>): Promise<void>;
  };
  readonly dependencies: {
    readonly codemirrorState: typeof CodeMirrorState;
    readonly codemirrorView: typeof CodeMirrorView;
    readonly lezerMarkdown: typeof LezerMarkdown;
    readonly lezerCommon: typeof LezerCommon;
  };
}
export interface PluginDefinition {
  activate(context: PluginContext): void | (() => void) | Promise<void | (() => void)>;
}
/** Provides contextual typing for plugin authors without changing the definition. */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  return definition;
}
