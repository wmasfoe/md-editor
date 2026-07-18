import type { MdxComponentRegistry } from "@md-editor/mdx-component-registry";
import type { DocumentSnapshot, DocumentState } from "./document-state.ts";

export const editorCoreSpikeName = "editor-core-m0";

export * from "./callout.ts";
export * from "./content.ts";
export * from "./document-state.ts";
export * from "./file-lifecycle.ts";
export * from "./markdown.ts";
export * from "./raw-fragments.ts";
export * from "./recent-files.ts";

export function describeEditorCoreSpike(): string {
  return editorCoreSpikeName;
}

export interface CommandContext {
  readonly document: DocumentState;
  readonly actions?: EditorActionHandlers;
}

export type CommandHandler = (context: CommandContext) => void | Promise<void>;

export interface CommandDescriptor {
  readonly id: string;
  readonly title: string;
  readonly run: CommandHandler;
}

export interface CommandRegistry {
  register(command: CommandDescriptor): void;
  dispatch(id: string, context: CommandContext): Promise<boolean>;
  list(): readonly CommandDescriptor[];
}

export interface KeymapDescriptor {
  readonly id: string;
  readonly key: string;
  readonly commandId: string;
  readonly when?: string;
}

export interface KeymapRegistry {
  register(keymap: KeymapDescriptor): void;
  list(): readonly KeymapDescriptor[];
}

export interface FeatureContext {
  readonly commands: CommandRegistry;
  readonly keymaps: KeymapRegistry;
}

export interface FeatureDescriptor {
  readonly id: string;
  readonly title: string;
  readonly setup: (context: FeatureContext) => void;
}

export interface FeatureRegistry {
  register(feature: FeatureDescriptor): void;
  activateAll(context: FeatureContext): void;
  list(): readonly FeatureDescriptor[];
}

export type BuiltInCommandId =
  | "file.new"
  | "file.open"
  | "file.openRecent"
  | "file.openFolder"
  | "file.save"
  | "file.saveAs"
  | "settings.open"
  | "mdx.openComponentMenu"
  | "view.toggleSource"
  | "view.showWysiwyg"
  | "view.toggleSidebarPrimary"
  | "ai.continueWriting";

export interface EditorActionHandlers {
  readonly newDocument?: () => void | Promise<void>;
  readonly openDocument?: () => void | Promise<void>;
  readonly openRecentDocument?: () => void | Promise<void>;
  readonly openFolder?: () => void | Promise<void>;
  readonly saveDocument?: () => void | Promise<void>;
  readonly saveDocumentAs?: () => void | Promise<void>;
  readonly openSettings?: () => void | Promise<void>;
  readonly openMdxComponentMenu?: () => void | Promise<void>;
  readonly toggleSourceMode?: () => void | Promise<void>;
  readonly showWysiwygMode?: () => void | Promise<void>;
  readonly toggleSidebarPrimary?: () => void | Promise<void>;
  readonly continueAiWriting?: () => void | Promise<void>;
}

export interface EditorRuntime {
  readonly document: DocumentState;
  readonly commands: CommandRegistry;
  readonly keymaps: KeymapRegistry;
  readonly features: FeatureRegistry;
  readonly mdxComponents: MdxComponentRegistry;
  getSnapshot(): DocumentSnapshot;
}

export interface EditorRuntimeInput {
  readonly document: DocumentState;
  readonly mdxComponents: MdxComponentRegistry;
  readonly commands?: CommandRegistry;
  readonly keymaps?: KeymapRegistry;
  readonly features?: FeatureRegistry;
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, CommandDescriptor>();

  return {
    register(command) {
      if (commands.has(command.id)) {
        throw new Error(`Command already registered: ${command.id}`);
      }
      commands.set(command.id, command);
    },
    async dispatch(id, context) {
      console.log("[Command Dispatch]", id, "registered commands:", [...commands.keys()]);
      const command = commands.get(id);
      if (!command) {
        console.warn("[Command Dispatch] Command not found:", id);
        return false;
      }
      console.log("[Command Dispatch] Running:", id);
      await command.run(context);
      console.log("[Command Dispatch] Completed:", id);
      return true;
    },
    list() {
      return [...commands.values()];
    },
  };
}

export function createKeymapRegistry(): KeymapRegistry {
  const keymaps = new Map<string, KeymapDescriptor>();
  const bindings = new Set<string>();

  return {
    register(keymap) {
      const bindingKey = `${keymap.key}::${keymap.when ?? ""}`;
      if (keymaps.has(keymap.id)) {
        throw new Error(`Keymap already registered: ${keymap.id}`);
      }
      // 提前拒绝重复快捷键，避免内置功能之间悄悄抢占日常写作快捷键。
      if (bindings.has(bindingKey)) {
        throw new Error(`Ambiguous key binding: ${keymap.key}`);
      }
      keymaps.set(keymap.id, keymap);
      bindings.add(bindingKey);
    },
    list() {
      return [...keymaps.values()];
    },
  };
}

export function createFeatureRegistry(): FeatureRegistry {
  const features = new Map<string, FeatureDescriptor>();

  return {
    register(feature) {
      if (features.has(feature.id)) {
        throw new Error(`Feature already registered: ${feature.id}`);
      }
      features.set(feature.id, feature);
    },
    activateAll(context) {
      for (const feature of features.values()) {
        feature.setup(context);
      }
    },
    list() {
      return [...features.values()];
    },
  };
}

export function createBuiltInEditorFeature(): FeatureDescriptor {
  return {
    id: "editor.built-in",
    title: "Built-in editor commands",
    setup(context) {
      registerActionCommand(context.commands, "file.new", "New Document", "newDocument");
      registerActionCommand(context.commands, "file.open", "Open File", "openDocument");
      registerActionCommand(
        context.commands,
        "file.openRecent",
        "Open Recent File",
        "openRecentDocument",
      );
      registerActionCommand(context.commands, "file.openFolder", "Open Folder", "openFolder");
      registerActionCommand(context.commands, "file.save", "Save", "saveDocument");
      registerActionCommand(context.commands, "file.saveAs", "Save As", "saveDocumentAs");
      registerActionCommand(context.commands, "settings.open", "Settings", "openSettings");
      registerActionCommand(
        context.commands,
        "mdx.openComponentMenu",
        "Insert MDX Component",
        "openMdxComponentMenu",
      );
      registerActionCommand(
        context.commands,
        "view.toggleSource",
        "Toggle Source Mode",
        "toggleSourceMode",
      );
      registerActionCommand(context.commands, "view.showWysiwyg", "Edit Mode", "showWysiwygMode");
      registerActionCommand(
        context.commands,
        "view.toggleSidebarPrimary",
        "Toggle File Tree and Outline",
        "toggleSidebarPrimary",
      );

      context.keymaps.register({
        id: "view.toggleSource",
        key: "Mod-/",
        commandId: "view.toggleSource",
      });
      context.keymaps.register({
        id: "view.toggleSidebarPrimary",
        key: "Mod-Shift-B",
        commandId: "view.toggleSidebarPrimary",
      });
      context.keymaps.register({
        id: "settings.open",
        key: "Mod-,",
        commandId: "settings.open",
      });
      context.keymaps.register({
        id: "mdx.openComponentMenu",
        key: "Mod-Shift-M",
        commandId: "mdx.openComponentMenu",
      });

      // 注意：file.new, file.open, file.save, file.saveAs 的快捷键
      // 由平台菜单直接处理，不在这里注册，避免冲突
    },
  };
}

export function createAiWritingFeature(): FeatureDescriptor {
  return {
    id: "editor.ai-writing",
    title: "AI writing commands",
    setup(context) {
      registerActionCommand(
        context.commands,
        "ai.continueWriting",
        "Continue Writing with AI",
        "continueAiWriting",
      );
      context.keymaps.register({
        id: "ai.continueWriting",
        key: "Mod-Shift-A",
        commandId: "ai.continueWriting",
      });
    },
  };
}

function registerActionCommand(
  commands: CommandRegistry,
  id: BuiltInCommandId,
  title: string,
  actionName: keyof EditorActionHandlers,
): void {
  commands.register({
    id,
    title,
    async run(context) {
      await context.actions?.[actionName]?.();
    },
  });
}

export function createEditorRuntime(input: EditorRuntimeInput): EditorRuntime {
  const commands = input.commands ?? createCommandRegistry();
  const keymaps = input.keymaps ?? createKeymapRegistry();
  const features = input.features ?? createFeatureRegistry();
  // v0.1 的功能激活是编译期、确定性的；未来运行时插件可以沿用这层接口，
  // 不需要改 App 层接线。
  features.activateAll({ commands, keymaps });

  return {
    document: input.document,
    commands,
    keymaps,
    features,
    mdxComponents: input.mdxComponents,
    getSnapshot() {
      return input.document.getSnapshot();
    },
  };
}
