# Markdown 语法扩展插件体系与容器指令方案

用途：记录基于 CodeMirror 6 与 Lezer AST 的 Markdown 插件扩展规范（`MarkdownSyntaxPlugin`）、独立子包 `@md-editor/syntax-plugins`，以及首个官方插件 `containerDirectivePlugin` 的实现契约与设计决策。

---

## 1. 架构分层与子包解耦原则

根据架构能力边界原则，Markdown 核心渲染器不应耦合具体的扩展语法或在核心状态机中硬编码具体插件逻辑。

```
+-------------------------------------------------------------+
|                  消费端 (apps/desktop, apps/web)             |
|  - 自主在外部按需导入并组装插件                                   |
|  - 例如: renderer.use(containerDirectivePlugin)              |
+-------------------------------------------------------------+
                              |
       +----------------------+----------------------+
       |                                             |
       v                                             v
+-----------------------------+       +-----------------------------+
|  @md-editor/renderer-core   |       | @md-editor/syntax-plugins   |
|  - SyntaxPluginRegistry     |       | (独立语法插件子包)            |
|  - MarkdownSyntaxPlugin 接口 |       | - containerDirectivePlugin  |
|  - 链式 .use(...) 方法       |       | - Lezer BlockParser 状态机  |
|  - 动态 Compartment 重配机制 |       | - 专用装饰构建器              |
|  - 0% 具体语法硬编码分支       |       | - 独立测试套件               |
+-----------------------------+       +-----------------------------+
```

### 1.1 核心渲染器纯净性
- `@md-editor/renderer-codemirror` 核心源码（`node-policy.ts`、`range-index.ts`、`projection-state.ts`）内**严禁出现任何特定插件的硬编码节点名称或分支逻辑**（例如无 `ContainerDirective`、无 `record.kind === "directive"` 硬编码分支）。
- 所有扩展节点的解析策略、元数据提取和所见即所得装饰均由 `SyntaxPluginRegistry` 委派给已注册的插件。

### 1.2 独立插件子包 `@md-editor/syntax-plugins`
- 存放各种非标准或特定语法的插件（如 Generic Directive、未来的数学公式扩展等）。
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

