# Markdown 语法扩展插件体系与容器指令方案

用途：记录基于 CodeMirror 6 与 Lezer AST 的 Markdown 插件扩展规范（`MarkdownSyntaxPlugin`）、独立子包 `@md-editor/syntax-plugins`，以及官方插件 `containerDirectivePlugin`、`mathPlugin`（KaTeX）和 `mermaidPlugin`（Mermaid.js）的实现契约与设计决策。

---

## 1. 架构分层与子包解耦原则

根据架构能力边界原则，Markdown 核心渲染器不应耦合具体的扩展语法或在核心状态机中硬编码具体插件逻辑。

```
+-------------------------------------------------------------+
|                  消费端 (apps/desktop, apps/web)             |
|  - 自主在外部按需导入并组装插件                                   |
|  - 例如: renderer.use(containerDirectivePlugin, mathPlugin) |
+-------------------------------------------------------------+
                              |
       +----------------------+----------------------+
       |                                             |
       v                                             v
+-----------------------------+       +-----------------------------+
|@md-editor/renderer-codemirror|       | @md-editor/syntax-plugins   |
|  - SyntaxPluginRegistry     |       | (独立语法插件子包)            |
|  - MarkdownSyntaxPlugin 接口 |       | - containerDirectivePlugin  |
|  - 链式 .use(...) 方法       |       | - mathPlugin (KaTeX)        |
|  - 动态 Compartment 重配机制 |       | - mermaidPlugin (Mermaid.js)|
|  - 0% 具体语法硬编码分支       |       | - Lezer 解析扩展与装饰器     |
+-----------------------------+       +-----------------------------+
```

### 1.1 核心渲染器纯净性
- `@md-editor/renderer-codemirror` 核心源码（`node-policy.ts`、`range-index.ts`、`projection-state.ts`）内**严禁出现任何特定插件的硬编码节点名称或分支逻辑**（例如无 `ContainerDirective`、无 `InlineMath`、无 `MermaidBlock` 硬编码分支）。
- 所有扩展节点的解析策略、元数据提取和所见即所得装饰均由 `SyntaxPluginRegistry` 委派给已注册的插件。

### 1.2 独立插件子包 `@md-editor/syntax-plugins`
- 存放各种非标准或特定语法的插件（如 Generic Directive、LaTeX 数学公式、Mermaid 图表等）。
- 提供 Lezer parser 扩展、节点策略（`nodePolicies`）、元数据提取器（`extractMetadata`）、装饰构建器（`buildDecorations`）。
- 拥有独立的单元测试（覆盖代码块隔离、嵌套防踩坑、属性解析、WYSIWYG 激活与非激活渲染等）。

---

## 2. 插件契约与注册接口

### 2.1 `MarkdownSyntaxPlugin` 契约
每个语法插件遵循统一的标准契约对象：

```ts
export interface MarkdownSyntaxPlugin {
  readonly id: string;
  readonly name: string;
  readonly markdownExtension?: Extension | readonly Extension[];
  readonly nodePolicies?: Readonly<Record<string, MarkdownNodePolicy>>;
  readonly extractMetadata?: (
    nodeName: string,
    node: SyntaxNode,
    docText: string,
    markers: readonly SourceRange[],
  ) => Record<string, unknown> | undefined;
  readonly resolveContentRange?: (
    nodeName: string,
    node: SyntaxNode,
    docText: string,
    markers: readonly SourceRange[],
  ) => SourceRange | undefined;
  readonly buildDecorations?: (
    record: MarkdownRangeRecord,
    state: EditorState,
  ) => readonly Range<Decoration>[];
}
```

### 2.2 链式调用 API (`renderer.use`)
渲染器实例与控制器暴露 Fluent API，支持单参、多参或链式安装：

```ts
// 构造选项传入
const renderer = createCodeMirrorRenderer({
  parent,
  initialSnapshot,
  plugins: [containerDirectivePlugin],
});

// 或链式动态安装
renderer
  .use(containerDirectivePlugin)
  .use(anotherPlugin);
```

#### 动态 Compartment 重配机制
当通过 `renderer.use(...)` 动态安装插件时，渲染器会：
1. 自动过滤已安装的重复插件（幂等性保证）；
2. 重新合成 `markdownExtension`，并通过 `Compartment.reconfigure` 实时重载 Lezer 语法扩展；
3. 更新 `syntaxPluginRegistryFacet` Compartment；
4. 调度 `refreshWysiwygProjectionEffect.of(null)` 触发当前视口所见即所得装饰即时重绘。

---

## 3. 核心设计契约（以 containerDirectivePlugin 为例）

### 3.1 纯增量与零报错隔离（Graceful Fallback）
- 编辑器核心保持标准 CommonMark/GFM 语义；
- 扩展语法（如 `:::info ... :::` 容器指令）作为可选插件接入；
- **未安装/未启用插件时**：Lezer 将语法文本安全解析为普通段落（Paragraph），零报错、零崩溃；
- **启用插件时**：动态注册 Lezer block parser 扩展与所见即所得投影规则。

### 3.2 状态机解析（摒弃多行正则）
- 严禁使用多行正则表达式匹配嵌套代码块；
- 基于 Lezer `parseBlock` 状态机逐行扫描，严格处理嵌套代码块（\`\`\` 与 ~~~），杜绝内嵌代码包含 `:::` 导致的提前闭合。

### 3.3 矢量 SVG 图标（严禁原生 Emoji）
- 遵守现代设计系统，不采用系统原生 Unicode Emoji；
- 内置 16px Heroicons 风格矢量 SVG 轮廓路径（`info`, `tip`, `warning`, `danger`）；
- 使用 CSS `currentColor` 与主题语义变量无缝适配暗黑/明亮模式。

### 3.4 所见即所得就地编辑
- 非激活状态：替换首行为 Admonition 标题栏，整块渲染左边框与背景色；
- 光标激活状态：光标移入首行立即暴露原始 Markdown 标记供原位编辑。

---

## 4. GFM Alerts 与 Callout 规范 (`> [!NOTE]`)

### 4.1 官方规范依据
- 遵循 GitHub Flavored Markdown (GFM) 官方 Alerts 规范与 Obsidian 事实标准；
- 支持 5 个标准级别：`NOTE`（蓝色信息）、`TIP`（绿色技巧）、`IMPORTANT`（紫色核心）、`WARNING`（黄色警示）、`CAUTION`（红色危险）。

### 4.2 第一性原理与 Blockquote 继承
- AST 同一性：底层保持标准 `Blockquote` 节点，无需单独侵入语法解析树；
- Range Index 扫描首行 `^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+([^\r\n]*))?$` 提取 `alert` 元数据；
- 视觉与交互复用：与 `containerDirectivePlugin` 共享 CSS 变量、16px 矢量 SVG 图标库及 `CalloutHeaderWidget`，光标移入首行原位展开源码，破坏标记时平滑退化为普通引用块。

---

## 5. LaTeX 数学公式插件规范 (`mathPlugin`)

### 5.1 语法范畴与防误触定界符规则
- **行内公式**：`$math$`，遵循 remark-math 经典防误触策略（左定界符后不可紧贴空白字符，右定界符前不可紧贴空白字符，且右定界符后不能为数字，杜绝 `$100 and $200` 货币符号被误判为公式）；
- **块级公式**：`$$math$$`（支持单行或跨行独立公式块）；
- **AST 纯净度**：通过 Lezer `parseInline` 与 `parseBlock` 独立扩展注入 `InlineMath`、`BlockMath` 与 `MathMark`。未安装插件时自然降级为纯文本与普通段落，核心渲染器零硬编码。

### 5.2 异步加载与 LRU 缓存
- **按需加载**：KaTeX 核心库与字体通过 `loadKatex()` 动态 `import("katex")` 异步加载，不增加主包初次加载体积；
- **渲染缓存**：使用容量为 500 的 LRU 缓存结构（`mathCache`），对相同 LaTeX 表达式与 displayMode 组合命中缓存，极大减少视图滚动与重排时的解析与 DOM 创建开销；
- **样式装配**：在各平台入口（`apps/desktop` 与 `apps/web`）全局引入 KaTeX 官方样式 `@import "katex/dist/katex.min.css"`，确保离线与打包自包含。

### 5.3 所见即所得就地编辑契约
- **非激活状态**：
  - 行内公式：由 `MathInlineWidget` 替换渲染为排版数学公式；
  - 块级公式：由 `MathBlockWidget` 替换整个公式块居中渲染，保留数学排版边距；
- **激活状态**：光标移入公式范围时，立即原位恢复完整的 LaTeX 源码与 `$` / `$$` 标记，供用户高速输入编辑；光标移出后即时重渲染。

### 5.4 容错降级（Graceful Fallback）
- 公式语法错误时捕获 KaTeX 异常，在行内或块级原位高亮错误片段并提供清晰的报错信息提示，防止渲染中断。

---

## 6. Mermaid 图表插件规范 (`mermaidPlugin`)

### 6.1 语法契约与 AST 拦截
- **语法范畴**：标准 Fenced Code Block 代码块，以 ` ```mermaid ` 作为开头定界符；
- **Lezer Block 拦截**：在 `before: "FencedCode"` 位置挂载解析器，仅当代码块 info 标签以 `mermaid` 开头时提升为 `MermaidBlock` 语法树节点；未加载插件或破坏标记时天然保持为普通代码块（`FencedCode`），零破坏、零丢失。

### 6.2 异步渲染与错误隔离
- **按需加载**：Mermaid.js 体积较大（约 2.2MB - 2.5MB），采用 `loadMermaid()` 动态 `import("mermaid")` 异步加载，杜绝阻断主渲染线程；
- **异步占位**：在模块加载与 SVG 编译期间，由 `MermaidBlockWidget` 呈现优雅的骨架/Loading 占位态，加载完成后平滑淡入展示；
- **多主题无缝适配**：初始化时检测应用暗黑模式（`.dark` / `data-theme="dark"`），动态注入 `dark` 或 `neutral` 主题变量；
- **错误卡片隔离**：捕获 Mermaid 解析与渲染过程中的所有语法异常，就地渲染友好的错误诊断卡片（包含错误行号与提示），严禁未捕获异常冒泡至全局。

### 6.3 所见即所得交互与未来架构兼容性
- **就地编辑体验**：光标在 Mermaid 块外部时光滑呈现图表 SVG；光标移入代码块时原位暴露原始 Markdown 代码，支持快捷修改；
- **画布扩展兼容性（Forward-Compatible Design）**：
  - 遵循“以 Markdown 文本为 Single Source of Truth”的一贯设计哲学；
  - 当前 `MermaidBlockWidget` 充当 Display Adapter；未来如引入交互式可视化设计器（拖拽节点、修改连线），将通过统一的 Adapter 接口向底层 CodeMirror 文档写回 DSL 代码，无需变更 AST 节点结构或打破现有契约。

---

## 7. 插件启用/禁用与动态热重载体系 (`setPlugins`)

### 7.1 核心交互层零破坏重配
- **第一性原理**：用户在设置菜单切换插件开启/关闭时，严禁通过销毁重建 CodeMirror Editor DOM 节点实现。
- **Compartment 动态重配**：
  - 通过 `renderer.setPlugins(plugins)` 原子化替换 `SyntaxPluginRegistry` 内部已注册的插件列表；
  - 触发 `markdownLanguageCompartment.reconfigure(...)` 注入重新组装的 Lezer Markdown 语法扩展，以及 `syntaxPluginRegistryCompartment.reconfigure(...)` 更新 Facet 映射；
  - 派发 `refreshMarkdownParseCoverageEffect` 触发底层 AST RangeIndex 增量重新解析，派发 `refreshWysiwygProjectionEffect` 即时原位重绘投影；
  - 彻底保留用户当前选区、光标位置与历史撤销记录。
- **幂等性守卫**：比对前后插件 ID 清单，相同清单不发起冗余重配与重排。

### 7.2 元数据规范与设置接入
- `@md-editor/syntax-plugins/metadata` 导出 `OFFICIAL_SYNTAX_PLUGINS_METADATA` 与类型契约，清晰标明官方出品标识、特性标签与语法提示；
- 桌面端设置（`AppSettings.plugins`）通过 Tauri 与本地 JSON 持久化，利用 `APP_SETTINGS_CHANGED_EVENT` 跨窗口即时广播；
- UI 交互采用 Claude Design 与 OpenDesign 风格设计：高精纯矢量 SVG 图标（零 Emoji）、平滑圆润 Switch 滑块动效与“更多插件开发中”未来探索卡片。

---

## 8. 文本高亮插件规范 (`highlightPlugin`)

### 8.1 语法范畴与 CommonMark Delimiter Run 规则
- **语法范畴**：`==高亮文本==`，遵循 Obsidian 与 Typora 事实标准（映射为 HTML `<mark>` 标签）；
- **定界符防误触与解析算法**：
  - 定界符为连续的两个等号 `==`（ASCII 61）；
  - 连续 3 个及以上等号（如 `===`）不解析为高亮标记，防止破坏标题底线或自定义分隔；
  - 遵循 CommonMark 强调（Emphasis）空白与标点环视规则（开定界符后不可紧贴空白，闭定界符前不可紧贴空白）；
  - 配置 `after: "Emphasis"`，原生参与 Lezer 行内定界符配对树，自洽支持与粗体、斜体嵌套（如 `==**粗体高亮**==` 或 `**==高亮粗体==**`）；
  - 反斜杠转义 `\==` 安全保持纯文本。

### 8.2 所见即所得就地编辑契约
- **节点策略**：
  - `Highlight` 节点采用 `renderPolicy: "inline-visible-markers"`，`editPolicy: "native"`，`interactionPolicy: "text"`；
  - 标记节点为 `HighlightMark`，区间策略为 `between-markers`；
- **装饰与渲染**：
  - 内容区间由核心 `buildInlineStyleDecorations` 自动赋予 `cm-md-inline cm-md-highlight`；
  - 定界符区间赋予 `cm-md-marker cm-md-marker--highlight`，在未聚焦时光滑浅显半透明显示，光标移入时即时原位编辑；
  - CSS 自适应明亮模式（柔和黄色荧光）与暗黑模式（柔和琥珀黄）；
- **快捷键联动**：
  - 与 `@md-editor/renderer-codemirror` 现有的 `toggleHighlight`（`toggleInlineMarkup("==")`) 与 `Mod-Shift-h` 快捷键完全闭环；
- **静态渲染一致性**：
  - 在 `packages/renderer-codemirror/src/static/render.ts` 中同步配置 `marked` 的 inline highlight 扩展，使静态导出与 QuickLook 快速预览保持 100% 视觉一致。



