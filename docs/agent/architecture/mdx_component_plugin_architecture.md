# MDX 官方组件分层方案

## 1. 文档用途

本文用于记录官方 MDX 组件的包边界、用户交互、发布目标和分阶段落地方案。产品行为以 [`custom_markdown_renderer_architecture.md`](./custom_markdown_renderer_architecture.md) 为最终决策源。

核心结论：

- 需要拆出独立 package，因为官方 MDX 组件未来会作为 npm 包供博客和业务页面复用。
- 编辑器只加载应用内置的官方 MDX 组件，不提供第三方组件或通用 Markdown 插件运行时。
- `@md-editor/mdx-component-registry` 负责官方组件的编辑器桥接协议和内部注册，不承载具体业务组件实现，也不是公共插件扩展点。
- `@md-editor/mdx-plugins` 负责官方 MDX React 组件、组件元数据和插入模板，可独立发布给业务侧使用。
- 保存权威仍然是原始 Markdown / MDX 字符串，任何组件插件都不能破坏未知源码保真。

## 2. 用户体验目标

在 WYSIWYG 模式下，技术写作者应能用键盘快速插入官方 MDX 组件：

1. 用户按下可配置快捷键，例如 `Command+Shift+M`。
2. 编辑器在当前光标附近打开一个极简下拉菜单。
3. 下拉菜单使用 Headless UI，支持输入过滤、上下键选择、`Enter` 确认、`Esc` 关闭。
4. 用户选择 `Callout`、`LinkCard`、`Steps` 等组件。
5. 编辑器在当前位置插入合法 MDX 源码模板。
6. WYSIWYG 中真实渲染已识别的官方组件；修改 props 或 children 时切换到全局源码模式。

快捷键必须进入设置菜单，沿用现有快捷键配置机制，避免新增一套独立 shortcut 系统。

第一版插入后不做 props 表单或 children 可视化编辑，优先插入源码模板：

```mdx
<Callout type="info" title="提示">
  内容
</Callout>
```

## 3. 包边界

### 3.1 `@md-editor/mdx-component-registry`

定位：编辑器内部使用的官方组件协议层和注册层。

职责：

- 定义 MDX 组件 descriptor。
- 定义插入菜单 metadata。
- 定义 props schema。
- 提供 registry 容器和查询 API。
- 给 `editor-core` / `editor-ui` / `mdx-plugins` 共享类型。
- 只注册应用编译期内置并明确允许的官方组件 metadata。

不负责：

- 不导出 `Callout` / `Steps` / `LinkCard` 等具体 React 组件。
- 不依赖 React、Milkdown、ProseMirror 或 Tauri。
- 不执行用户插件代码。
- 不扫描本地目录、npm 包或文档 import 来动态注册组件。
- 不提供博客运行时组件。

旧 `@md-editor/mdx-registry` 包应删除，避免协议包命名继续混淆。`registry` 只是能力之一，不适合作为完整协议包名。

建议最小接口：

```ts
export type MdxPropType = "string" | "number" | "boolean" | "enum" | "markdown";

export interface MdxPropDescriptor {
  readonly name: string;
  readonly type: MdxPropType;
  readonly required?: boolean;
  readonly values?: readonly string[];
}

export interface MdxComponentDescriptor {
  readonly name: string;
  readonly displayName: string;
  readonly importName?: string;
  readonly packageName?: string;
  readonly props: readonly MdxPropDescriptor[];
  readonly acceptsChildren: boolean;
  readonly version: string;
}

export interface MdxInsertDefinition {
  readonly label: string;
  readonly description?: string;
  readonly keywords: readonly string[];
  readonly group?: string;
  createSnippet(): string;
}

export interface MdxComponentPlugin {
  readonly id: string;
  readonly component: MdxComponentDescriptor;
  readonly insert?: MdxInsertDefinition;
}

export interface MdxComponentRegistry {
  register(plugin: MdxComponentPlugin): void;
  registerMany(plugins: readonly MdxComponentPlugin[]): void;
  unregister(id: string): boolean;
  getById(id: string): MdxComponentPlugin | undefined;
  getByComponentName(name: string): MdxComponentPlugin | undefined;
  list(): readonly MdxComponentPlugin[];
  listInsertable(): readonly MdxComponentPlugin[];
}
```

### 3.2 `@md-editor/mdx-plugins`

定位：官方 MDX 组件实现包，可发布到 npm 给博客和业务侧复用。

职责：

- 导出官方 React 组件，例如 `Callout`、`Steps`、`LinkCard`。
- 导出每个组件对应的 `MdxComponentPlugin` metadata。
- 导出 `officialMdxPlugins`，供编辑器一次性注册。
- 提供业务侧渲染 MDX 时需要的 `components` map。

不负责：

- 不管理编辑器命令分发。
- 不管理 Headless UI 下拉菜单状态。
- 不直接依赖 Milkdown / ProseMirror NodeView。
- 不处理本地文件、Tauri 权限或保存逻辑。

建议导出形态：

```ts
export { Callout } from "./callout/Callout";
export { Steps } from "./steps/Steps";
export { LinkCard } from "./link-card/LinkCard";

export { calloutPlugin, officialMdxPlugins } from "./metadata";

// 面向博客 / 业务 MDX runtime。
export const officialMdxComponents = {
  Callout,
  Steps,
  LinkCard
};
```

同时需要提供 metadata-only 子出口，供 `editor-core`、桌面 runtime、Node smoke 脚本使用，避免这些非 React 环境为了读取 metadata 而解析 `.tsx` 组件文件：

```ts
// @md-editor/mdx-plugins/metadata
export { calloutPlugin } from "./callout/plugin";
export { stepsPlugin } from "./steps/plugin";
export { linkCardPlugin } from "./link-card/plugin";

export const officialMdxPlugins = [
  calloutPlugin,
  stepsPlugin,
  linkCardPlugin
];
```

博客侧可以直接复用：

```tsx
import { officialMdxComponents } from "@md-editor/mdx-plugins";

<MDXRemote source={markdown} components={officialMdxComponents} />
```

编辑器侧只注册 metadata：

```ts
import { createMdxComponentRegistry } from "@md-editor/mdx-component-registry";
import { officialMdxPlugins } from "@md-editor/mdx-plugins/metadata";

const mdxComponents = createMdxComponentRegistry();
mdxComponents.registerMany(officialMdxPlugins);
```

这里的 `registerMany` 是应用启动时装配官方 metadata 的内部 API，不表示允许用户或第三方在运行时注册组件。

### 3.3 `@md-editor/editor-core`

定位：编辑器核心运行时。

职责：

- 消费 `MdxComponentRegistry`。
- 根据 registry 判断 MDX 组件是否已识别。
- 提供插入命令，例如 `mdx.insertComponent`。
- 保持原始 Markdown / MDX 字符串为保存权威。
- 对未知 MDX 做 raw 保真。

不负责：

- 不硬编码 `Callout` / `Steps` / `LinkCard`。
- 不导出业务侧 React 组件。
- 不承担 npm 组件包发布职责。

### 3.4 `@md-editor/editor-ui`

定位：编辑器 UI 层。

职责：

- 根据 registry 渲染插入菜单。
- 使用 Headless UI 实现键盘可操作下拉菜单。
- 向 CM6 renderer 注入 `officialMdxComponents` typed map。
- 承载 renderer host、菜单、toast 和其他 React 外部 UI。

不负责：

- 不定义官方组件业务实现。
- 不管理插件包发布。
- 不计算 MDX 源码范围、原子选择、事件拦截或删除 transaction。
- 不绕过 core 直接改写保存内容。

### 3.5 `@md-editor/renderer-codemirror`

定位：MDX 的 CM6 解析、渲染和编辑器交互所有者。

职责：

- 根据 registry metadata 和 MDX AST 识别官方组件及精确源码范围。
- 使用注入的 `officialMdxComponents` typed map 创建 React Widget，真实渲染组件。
- 捕获组件内全部指针、链接、按钮、输入、焦点和键盘交互，统一转换为整块选择。
- 管理高亮描边、原子选区、`Backspace` / `Delete` transaction、错误占位和 Widget 生命周期。
- 保证源码修改只通过全局源码模式发生，WYSIWYG 组件后代不能直接改变文档。

不负责：

- 不直接依赖 `mdx-plugins` 或硬编码官方组件名。
- 不执行 AI 请求、文件操作或 Tauri API。
- 不管理插入菜单和应用级 toast。

## 4. 为什么需要 registry 与 plugins 分离

如果只有 `@md-editor/mdx-plugins`，编辑器、UI 和业务博客都会直接依赖官方组件包。短期简单，但会带来三个问题：

1. `editor-core` 会被具体组件污染，逐渐硬编码 `Callout`、`Steps`、`LinkCard`。
2. metadata-only 消费端会被迫加载 React 和组件样式，破坏 Node / core 环境边界。
3. 编辑器内部协议变化会和官方组件发布节奏绑死。

分离后的依赖方向更清晰：

```txt
mdx-plugins ──types──────> mdx-component-registry
      ↑                              ↑
      │ typed component map          │ metadata protocol
      │                              │
editor-ui ───────────────> renderer-codemirror ──> editor-core
```

`mdx-component-registry` 是稳定协议；`mdx-plugins` 是官方实现。

## 5. 官方组件能力分级

### Level 0：Raw 保真

未知 MDX 组件、语法错误、不支持的 expression 和渲染异常在 WYSIWYG 中显示安全占位块，保存时保持原始源码。

这是底线能力，不能被官方组件系统破坏。

### Level 1：注册识别

编辑器能识别应用内置并注册的官方组件，并从 typed component map 获取可信 React 实现。

### Level 2：真实渲染 + 原子选择

WYSIWYG 中真实渲染官方组件。点击组件任意位置后显示高亮描边，`Backspace` / `Delete` 删除整个 MDX 源码范围；组件内部交互不执行。

这是首版迁移目标，优先用 `Callout` 验证。

### 不进入能力分级：结构化表单编辑

根据 props schema 生成表单控件，children 使用 Markdown 编辑区或嵌套编辑器。

该能力不在当前路线内；props 和 children 只在全局源码模式修改。

## 6. 当前进度与后续顺序

| 能力 | 当前状态 | 代码证据 / 后续动作 |
| --- | --- | --- |
| 协议包收敛 | 已完成 | `packages/mdx-component-registry` 已提供 descriptor、registry 和查询 API；仓库已无受依赖的 `@md-editor/mdx-registry` 实现 |
| 官方组件包 | 已完成 | `packages/mdx-plugins` 已提供 `Callout`、`officialMdxPlugins`、`officialMdxComponents` 和 metadata 子出口 |
| WYSIWYG 插入菜单 | 已完成（迁移前路径） | 当前 Milkdown 表面已有 `mdx.openComponentMenu`、`Mod-Shift-M`、Headless UI 菜单和 snippet 插入；M5 前迁移到 CM6 命令适配层 |
| Callout 真实渲染与原子选择 | 未开始（CM6） | 当前 Milkdown 轻量预览已有 ProseMirror `NodeSelection`、选中描边和两步整块删除，但不是官方 React 组件渲染，不具备 CM6 renderer 的原子交互状态、后代事件拦截或 Widget 生命周期证据。在 M4 实现目标能力 |
| npm 发布准备 | 部分完成 | 已有 `exports`、React peer dependency 和组件测试；包仍为 `private`，博客侧文档与正式发布验证尚未完成 |

后续执行顺序：

1. M0 建立 CM6 单编辑器路径，并保留 registry、官方 component map、命令和插入菜单适配能力。
2. M4 用 `Callout` 完成真实渲染、原子选择、后代事件拦截、整块删除和错误占位。
3. M5 迁移插入菜单及快捷键回归，保证只插入官方 registry 中的模板。
4. 稳定发布前补齐博客侧使用文档、解除 `private` 的独立发布决策和包发布验证。

## 7. 非目标

当前阶段不做：

- npm 第三方插件运行时加载。
- 用户导入或第三方 MDX 组件。
- 用户本地插件目录。
- 插件市场。
- 执行任意 MDX import / export。
- 任意 JS expression props 的结构化编辑。
- 完整 MDX runtime。
- 复杂嵌套 JSX 的完整可视化编辑。

## 8. 关键约束

- 所有 MDX 插件增强都必须以源码保真为前提。
- `.mdx` 文件保存权威是 Markdown / MDX 字符串，不是 React 组件树。
- `mdx-plugins` 可以被博客复用，因此不能依赖桌面端能力。
- `editor-core` 不能硬编码官方组件名称。
- renderer 不能直接依赖 `mdx-plugins`；组件实现通过 `editor-ui` 的 typed map 注入。
- WYSIWYG 中官方组件是原子交互边界，后代 DOM 不能打开链接、提交表单、接收输入或改变 Markdown。
- 快捷键配置必须复用现有设置体系。
- UI 插入菜单应保持写作低干扰，不引入固定工具栏作为第一入口。
