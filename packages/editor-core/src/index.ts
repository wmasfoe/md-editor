import type { MDXComponentRegistry } from "@md-editor/mdx-registry";
import type { Markdown } from "@md-editor/shared";

export type EditorMode = "wysiwyg" | "source";

export interface DocumentSnapshot {
  readonly markdown: Markdown;
  readonly savedMarkdown: Markdown;
  readonly filePath: string | null;
  readonly mode: EditorMode;
  readonly isDirty: boolean;
}

export interface DocumentStateInput {
  readonly markdown?: Markdown;
  readonly savedMarkdown?: Markdown;
  readonly filePath?: string | null;
  readonly mode?: EditorMode;
}

export interface DocumentState {
  getSnapshot(): DocumentSnapshot;
  updateMarkdown(markdown: Markdown): DocumentSnapshot;
  markSaved(input?: { readonly markdown?: Markdown; readonly filePath?: string | null }): DocumentSnapshot;
  setMode(mode: EditorMode): DocumentSnapshot;
}

export type ModeSwitchError = "MODE_SWITCH_FAILED";

export interface ModeSwitchAdapter {
  readonly beforeSwitch?: (snapshot: DocumentSnapshot, nextMode: EditorMode) => Markdown | Promise<Markdown>;
  readonly afterSwitch?: (snapshot: DocumentSnapshot) => void | Promise<void>;
}

export interface ModeSwitchOk {
  readonly ok: true;
  readonly snapshot: DocumentSnapshot;
}

export interface ModeSwitchFailure {
  readonly ok: false;
  readonly error: ModeSwitchError;
  readonly message: string;
  readonly snapshot: DocumentSnapshot;
}

export type ModeSwitchResult = ModeSwitchOk | ModeSwitchFailure;

export interface CommandContext {
  readonly document: DocumentState;
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

export interface EditorRuntime {
  readonly document: DocumentState;
  readonly commands: CommandRegistry;
  readonly keymaps: KeymapRegistry;
  readonly features: FeatureRegistry;
  readonly mdxComponents: MDXComponentRegistry;
  getSnapshot(): DocumentSnapshot;
}

export interface EditorRuntimeInput {
  readonly document: DocumentState;
  readonly mdxComponents: MDXComponentRegistry;
  readonly commands?: CommandRegistry;
  readonly keymaps?: KeymapRegistry;
  readonly features?: FeatureRegistry;
}

export function createDocumentState(input: DocumentStateInput = {}): DocumentState {
  // 只保留一份 Markdown 字符串作为跨模式事实源。
  // WYSIWYG 和 Source Mode 适配层都必须通过这里同步，避免各自持有副本。
  let markdown = input.markdown ?? "";
  let savedMarkdown = input.savedMarkdown ?? markdown;
  let filePath = input.filePath ?? null;
  let mode = input.mode ?? "wysiwyg";

  function snapshot(): DocumentSnapshot {
    return {
      markdown,
      savedMarkdown,
      filePath,
      mode,
      isDirty: markdown !== savedMarkdown
    };
  }

  return {
    getSnapshot: snapshot,
    updateMarkdown(nextMarkdown) {
      markdown = nextMarkdown;
      return snapshot();
    },
    markSaved(next = {}) {
      markdown = next.markdown ?? markdown;
      savedMarkdown = markdown;
      filePath = next.filePath === undefined ? filePath : next.filePath;
      return snapshot();
    },
    setMode(nextMode) {
      mode = nextMode;
      return snapshot();
    }
  };
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
      const command = commands.get(id);
      if (!command) {
        return false;
      }
      await command.run(context);
      return true;
    },
    list() {
      return [...commands.values()];
    }
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
    }
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
    }
  };
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
    }
  };
}

export async function switchEditorModeSafely(
  document: DocumentState,
  nextMode: EditorMode,
  adapter: ModeSwitchAdapter = {}
): Promise<ModeSwitchResult> {
  const previous = document.getSnapshot();

  if (previous.mode === nextMode) {
    return { ok: true, snapshot: previous };
  }

  try {
    // 切换前允许当前模式把自己的编辑内容序列化回 Markdown；
    // 如果这里失败，必须保持原模式和原内容，避免静默丢稿。
    const nextMarkdown = adapter.beforeSwitch
      ? await adapter.beforeSwitch(previous, nextMode)
      : previous.markdown;

    document.updateMarkdown(nextMarkdown);
    const snapshot = document.setMode(nextMode);
    await adapter.afterSwitch?.(snapshot);

    return { ok: true, snapshot };
  } catch (error) {
    document.updateMarkdown(previous.markdown);
    document.setMode(previous.mode);

    return {
      ok: false,
      error: "MODE_SWITCH_FAILED",
      message: error instanceof Error ? error.message : "Failed to switch editor mode.",
      snapshot: document.getSnapshot()
    };
  }
}
