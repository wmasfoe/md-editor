# MDX 组件插件分层方案

## 1. 文档用途

本文用于记录 MDX 组件插件系统的包边界、用户交互、发布目标和分阶段落地方案。

核心结论：

- 需要拆出独立 package，因为官方 MDX 组件未来会作为 npm 包供博客和业务页面复用。
- 编辑器内的插件系统第一阶段只面向 MDX 组件，不做完整第三方编辑器插件运行时。
- `@md-editor/mdx-component-registry` 负责编辑器桥接协议和注册，不承载具体业务组件实现。
- `@md-editor/mdx-plugins` 负责官方 MDX React 组件、组件元数据和插入模板，可独立发布给业务侧使用。
- 保存权威仍然是原始 Markdown / MDX 字符串，任何组件插件都不能破坏未知源码保真。

## 2. 用户体验目标

在 WYSIWYG 模式下，技术写作者应能用键盘快速插入官方 MDX 组件：

1. 用户按下可配置快捷键，例如 `Command+Shift+M`。
2. 编辑器在当前光标附近打开一个极简下拉菜单。
3. 下拉菜单使用 Headless UI，支持输入过滤、上下键选择、`Enter` 确认、`Esc` 关闭。
4. 用户选择 `Callout`、`LinkCard`、`Steps` 等组件。
5. 编辑器在当前位置插入合法 MDX 源码模板。
6. WYSIWYG 中把已识别组件展示为轻量卡片；用户需要精修时可以编辑源码。

快捷键必须进入设置菜单，沿用现有快捷键配置机制，避免新增一套独立 shortcut 系统。

第一版插入后不做复杂表单编辑，优先插入源码模板：

```mdx
<Callout type="info" title="提示">
  内容
</Callout>
```

## 3. 包边界

### 3.1 `@md-editor/mdx-component-registry`

定位：编辑器内部使用的协议层和注册层。

职责：

- 定义 MDX 组件 descriptor。
- 定义插入菜单 metadata。
- 定义 props schema。
- 提供 registry 容器和查询 API。
- 给 `editor-core` / `editor-ui` / `mdx-plugins` 共享类型。

不负责：

- 不导出 `Callout` / `Steps` / `LinkCard` 等具体 React 组件。
- 不依赖 React、Milkdown、ProseMirror 或 Tauri。
- 不执行用户插件代码。
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
- 在 WYSIWYG 中展示已识别 MDX 组件卡片。
- 提供 raw source 编辑入口。

不负责：

- 不定义官方组件业务实现。
- 不管理插件包发布。
- 不绕过 core 直接改写保存内容。

## 4. 为什么需要 registry 与 plugins 分离

如果只有 `@md-editor/mdx-plugins`，编辑器、UI 和业务博客都会直接依赖官方组件包。短期简单，但会带来三个问题：

1. `editor-core` 会被具体组件污染，逐渐硬编码 `Callout`、`Steps`、`LinkCard`。
2. 第三方或业务方自定义组件无法用同一协议接入编辑器。
3. 编辑器内部协议变化会和官方组件发布节奏绑死。

分离后的依赖方向更清晰：

```txt
mdx-plugins ─────────────┐
                         ↓
                 mdx-component-registry
                         ↑
editor-core ─────────────┘
editor-ui  ──────────────┘
```

`mdx-component-registry` 是稳定协议；`mdx-plugins` 是官方实现。

## 5. 插件能力分级

### Level 0：Raw 保真

未知 MDX 组件在 WYSIWYG 中作为 raw block 托管，保存时还原为原始源码。

这是底线能力，不能被官方组件系统破坏。

### Level 1：注册识别

编辑器能识别已注册组件，展示组件名称、props 摘要和源码入口。

### Level 2：卡片化展示 + 源码编辑

WYSIWYG 中显示轻量组件卡片，点击后编辑原始 MDX 源码。

这是 v0.2 的推荐目标，优先用 `Callout` 验证。

### Level 3：结构化表单编辑

根据 props schema 生成表单控件，children 使用 Markdown 编辑区或嵌套编辑器。

该能力后置，等 Level 2 和源码保真稳定后再做。

## 6. 推荐落地顺序

### 阶段一：包名和协议收敛

1. 新建 `packages/mdx-component-registry`。
2. 将旧 `packages/mdx-registry` 的类型和 registry 迁入新包。
3. 删除旧 `packages/mdx-registry` 子包和所有引用。
4. 更新 `editor-core` / `desktop` / 测试依赖。

### 阶段二：官方组件包

1. 新建 `packages/mdx-plugins`。
2. 放入 `Callout` React 组件和 `calloutPlugin` metadata。
3. 导出 `officialMdxPlugins` 和 `officialMdxComponents`。
4. 编辑器 runtime 从 `officialMdxPlugins` 注册组件。

### 阶段三：WYSIWYG 插入菜单

1. 增加命令 `mdx.openComponentMenu`。
2. 增加可配置快捷键，默认建议 `Mod+Shift+M`。
3. 用 Headless UI 实现菜单，支持键盘过滤和选择。
4. 根据 `registry.listInsertable()` 渲染组件列表。
5. `Enter` 后调用插件 `createSnippet()` 并插入到当前光标。

### 阶段四：Callout Level 2

1. WYSIWYG 中把已识别 `Callout` 显示为轻量卡片。
2. 卡片展示 type / title / children 摘要。
3. 点击卡片进入 raw source 编辑。
4. 保存时继续以原始 MDX 字符串为权威。

### 阶段五：发布准备

1. 为 `@md-editor/mdx-plugins` 设计 npm `exports`。
2. 拆清 peer dependencies，React 应为 peer dependency。
3. 提供博客侧使用文档。
4. 增加组件渲染测试和源码 round-trip 测试。

## 7. 非目标

当前阶段不做：

- npm 第三方插件运行时加载。
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
- 快捷键配置必须复用现有设置体系。
- UI 插入菜单应保持写作低干扰，不引入固定工具栏作为第一入口。
