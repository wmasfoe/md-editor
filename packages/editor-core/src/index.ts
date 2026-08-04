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

/**
 * G007 P3-9:命令的 UI 放置声明(从 registry 统一拉取的入口点)。
 * 命令面板是首个消费者;斜杠菜单/工具栏后续基于同一数据源扩展。
 */
export type CommandPlacement = "toolbar" | "command-palette" | "editor-menu";

export interface CommandDescriptor {
  readonly id: string;
  readonly title: string;
  readonly run: CommandHandler;
  /** UI 放置声明;缺省/空 = 不进入任何统一 UI */
  readonly placement?: readonly CommandPlacement[];
  /** 命令面板搜索关键词(大小写不敏感) */
  readonly keywords?: readonly string[];
  /** 命令面板分组 */
  readonly group?: string;
  /** 可用性条件;缺省 = 始终可用;抛异常按不可用处理 */
  readonly when?: (context: CommandContext) => boolean;
}

export interface CommandRegistry {
  register(command: CommandDescriptor): void;
  dispatch(id: string, context: CommandContext): Promise<boolean>;
  list(): readonly CommandDescriptor[];
  /** G007:按 UI 放置声明查询(不过滤 when) */
  listByPlacement(placement: CommandPlacement): readonly CommandDescriptor[];
  /** G007:按 when 过滤 + 分组排序;placement 缺省 = 全部可用命令 */
  listAvailable(
    context: CommandContext,
    placement?: CommandPlacement,
  ): readonly CommandDescriptor[];
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
    listByPlacement(placement) {
      return [...commands.values()].filter(
        (command) => command.placement?.includes(placement) ?? false,
      );
    },
    listAvailable(context, placement) {
      const available = [...commands.values()].filter((command) => {
        // 统一 UI 只服务声明了 placement 的命令;显式 placement 时精确匹配
        if (placement !== undefined) {
          if (!(command.placement?.includes(placement) ?? false)) {
            return false;
          }
        } else if ((command.placement?.length ?? 0) === 0) {
          return false;
        }
        if (command.when === undefined) {
          return true;
        }
        try {
          return command.when(context);
        } catch {
          // when 抛异常 = 状态异常,按不可用处理(fail-closed)
          return false;
        }
      });
      return Object.freeze(
        [...available].toSorted(
          (left, right) =>
            (left.group ?? "").localeCompare(right.group ?? "") ||
            left.title.localeCompare(right.title),
        ),
      );
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
      registerActionCommand(context.commands, "file.new", "New Document", "newDocument", {
        group: "文件",
        keywords: ["新建", "new"],
      });
      registerActionCommand(context.commands, "file.open", "Open File", "openDocument", {
        group: "文件",
        keywords: ["打开", "open"],
      });
      registerActionCommand(
        context.commands,
        "file.openRecent",
        "Open Recent File",
        "openRecentDocument",
        { group: "文件", keywords: ["最近", "recent"] },
      );
      registerActionCommand(context.commands, "file.openFolder", "Open Folder", "openFolder", {
        group: "文件",
        keywords: ["文件夹", "folder"],
      });
      registerActionCommand(context.commands, "file.save", "Save", "saveDocument", {
        group: "文件",
        keywords: ["保存", "save"],
      });
      registerActionCommand(context.commands, "file.saveAs", "Save As", "saveDocumentAs", {
        group: "文件",
        keywords: ["另存为", "save as"],
      });
      registerActionCommand(context.commands, "settings.open", "Settings", "openSettings", {
        group: "设置",
        keywords: ["设置", "偏好", "settings"],
      });
      registerActionCommand(
        context.commands,
        "mdx.openComponentMenu",
        "Insert MDX Component",
        "openMdxComponentMenu",
        { group: "插入", keywords: ["mdx", "组件", "component"] },
      );
      registerActionCommand(
        context.commands,
        "view.toggleSource",
        "Toggle Source Mode",
        "toggleSourceMode",
        { group: "视图", keywords: ["源码", "source", "toggle"] },
      );
      registerActionCommand(context.commands, "view.showWysiwyg", "Edit Mode", "showWysiwygMode", {
        group: "视图",
        keywords: ["编辑", "wysiwyg"],
      });
      registerActionCommand(
        context.commands,
        "view.toggleSidebarPrimary",
        "Toggle File Tree and Outline",
        "toggleSidebarPrimary",
        { group: "视图", keywords: ["侧栏", "sidebar", "outline"] },
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
        { group: "AI", keywords: ["ai", "续写", "写作", "continue"] },
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
  options: {
    readonly group?: string;
    readonly placement?: readonly CommandPlacement[];
    readonly keywords?: readonly string[];
  } = {},
): void {
  commands.register({
    id,
    title,
    // G007:内置命令默认进入命令面板(统一 UI 入口);显式 placement 覆盖
    placement: options.placement ?? ["command-palette"],
    group: options.group,
    keywords: options.keywords,
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
