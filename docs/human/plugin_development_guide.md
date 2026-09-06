# Markdown 语法与 UI 插件开发指南

本文档面向希望为 Inkpoint / `@md-editor` 扩展自定义语法或 UI 样式的开发者。无论你想引入类似 `:::info` 的块级容器指令、类似 `==高亮==` 的全新行内标记，还是只想给特定文本或已有语法添加精美的图标和行内挂件，都可以通过本指南轻松上手。

---

## 一、核心理念与插件分类

编辑器基于 **CodeMirror 6** 与 **Lezer AST** 构建，遵循「**纯增量扩展与优雅降级**」的架构哲学：

- **优雅降级**：未加载插件时，任何未识别的自定义文本都会安全回退为标准 CommonMark 普通段落，**绝对不会报错崩溃**。
- **动静皆宜**：插件既可以在编辑器初始化时**静态批量注入**（首屏零闪烁），也可以在运行期通过 `renderer.use(...)` **动态按需加载**。
- **自动分流与性能自适应**：
  编辑器底层会通过属性自动检测插件类型：
  ```ts
  const isSyntaxPlugin = Boolean(plugin.markdownExtension);
  ```
  - **纯 UI 装饰型插件**：不定义新的分词语法（无 `markdownExtension`），动态注入时**完全跳过 Lezer 语法分析器重构**，仅重绘可视装饰层，开销极低；
  - **AST 语法扩展型插件**：包含 `markdownExtension`，动态注入时会精准调度 Lezer Markdown 语言扩展重配与 AST 范围索引（RangeIndex）全量重建。

---

## 二、插件接口属性速查 (`MarkdownSyntaxPlugin`)

所有的插件均实现统一的 `MarkdownSyntaxPlugin` 契约接口：

```ts
import type { MarkdownConfig } from "@lezer/markdown";
import type { EditorState, Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

export interface MarkdownSyntaxPlugin {
  /** 插件唯一标识符，建议采用小写点分格式，如 "markdown.directive" */
  readonly id: string;

  /** 插件可读名称，如 "Container Directive Plugin" */
  readonly name: string;

  /**
   * [仅语法插件需要] Lezer Markdown 语法配置。
   * 声明自定义词法分词器（parseBlock, parseInline, defineNodes 等）。
   * 若提供此属性，底层自动判定为 AST 语法插件。
   */
  readonly markdownExtension?: MarkdownConfig;

  /**
   * 单节点简写策略配置（快速映射到常见的块级或行内渲染策略）。
   */
  readonly nodePolicy?: {
    readonly nodeName: string;
    readonly kind: MarkdownSyntaxKind;
    readonly isBlock: boolean;
  };

  /**
   * [推荐] 细粒度节点策略映射字典。
   * 精确配置每个 AST 节点的渲染策略（renderPolicy）、编辑约束（editPolicy）等。
   */
  readonly nodePolicies?: Readonly<Record<string, MarkdownNodePolicy>>;

  /**
   * 自定义 AST 节点元数据提取器。
   * 在生成 RangeIndex 阶段执行，用于提取指令标题、参数、语言等额外信息。
   */
  readonly extractMetadata?: (
    node: SyntaxNode,
    source: string,
    children: readonly SyntaxNode[],
  ) => Record<string, unknown> | undefined;

  /**
   * 自定义正文内容区间解析器。
   * 用于指定容器指令正文起止位置（剔除首尾 ::: 标记）。
   */
  readonly resolveContentRange?: (
    node: SyntaxNode,
    source: string,
    children: readonly SyntaxNode[],
    markerRanges: readonly SourceRange[],
  ) => SourceRange | null;

  /**
   * WYSIWYG 投影层装饰器构建器。
   * 根据当前节点的 RangeRecord 与状态，生成 CodeMirror 装饰器（替换标记、包裹卡片背景等）。
   */
  readonly buildDecorations?: (
    record: MarkdownRangeRecord,
    state: EditorState,
    context?: { active: boolean; selected: boolean },
  ) => readonly Range<Decoration>[];
}
```

### 常用渲染策略（`renderPolicy`）说明

| `renderPolicy` | 适用场景 | 交互表现 |
| :--- | :--- | :--- |
| `"directive-panel"` | 块级卡片、提示面板（如 `:::info`、Alerts） | 首行替换为精美标签栏卡片头，正文可编辑，光标离开自动收起标记 |
| `"inline-visible-markers"` | 行内强化标记（如高亮标记 `==text==`） | 处于光标所在行时光标可见标记符号，光标离开时光标隐藏符号只留高亮 |
| `"source-only-atom"` | 复杂原子级块（如数学公式块） | 整体作为一个不可拆分原子，双击或聚焦进入源码编辑 |

---

## 三、实战开发示例

### 示例 1：纯 UI 装饰型插件（Zero AST Overhead）

> **目标**：不发明新语法，只给包含特定元数据或现有节点附加视觉徽标（例如将特定引言块渲染为特殊强调边框）。

```ts
import type { MarkdownSyntaxPlugin } from "@md-editor/renderer-codemirror";
import { Decoration } from "@codemirror/view";

export const quoteAccentPlugin: MarkdownSyntaxPlugin = {
  id: "ui.quote-accent",
  name: "Quote Accent Styler",

  // 关键：不提供 markdownExtension，底层自动识别为纯 UI 插件，动态注入零 AST 解析开销！

  buildDecorations(record, state, context) {
    // 仅对引言（quote）节点进行视觉增强
    if (record.kind !== "quote") {
      return [];
    }

    const decos = [];
    // 为引言块所在行追加特殊的纸质感琥珀色背景
    const line = state.doc.lineAt(record.from);
    decos.push(
      Decoration.line({
        attributes: { class: "cm-quote-accent-line" },
      }).range(line.from),
    );

    return decos;
  },
};
```

---

### 示例 2：AST 语法扩展型插件（以 `:::info` 容器指令为例）

> **目标**：引入全新的块级语法 `:::type title`，在所见即所得模式下渲染为可折叠卡片面板。

#### 第一步：编写 Lezer Markdown 词法分析器扩展

利用 `@lezer/markdown` 的 `parseBlock` 机制定义分词规则：

```ts
import type { MarkdownConfig } from "@lezer/markdown";

export const directiveMarkdownExtension: MarkdownConfig = {
  defineNodes: [
    { name: "ContainerDirective", block: true },
    { name: "DirectiveMarker" },
    { name: "DirectiveHeader" },
  ],
  parseBlock: [
    {
      name: "ContainerDirective",
      endLeaf(_cx, line) {
        // 当遇见 ::: 时终止普通段落，开启容器指令解析
        return line.text.startsWith(":::");
      },
      parse(cx, line) {
        if (!line.text.startsWith(":::")) return false;
        // 解析首行 :::type title 与结尾 :::
        // 生成 ContainerDirective 语法树节点 ...
        return true;
      },
    },
  ],
};
```

#### 第二步：组装完整插件定义

```ts
import type { MarkdownSyntaxPlugin } from "@md-editor/renderer-codemirror";
import { Decoration } from "@codemirror/view";
import { directiveMarkdownExtension } from "./parser";

export const containerDirectivePlugin: MarkdownSyntaxPlugin = {
  id: "markdown.directive",
  name: "Container Directive",

  // 1. 注入 AST 词法分析器扩展
  markdownExtension: directiveMarkdownExtension,

  // 2. 声明节点行为策略
  nodePolicies: {
    ContainerDirective: {
      kind: "directive",
      renderPolicy: "directive-panel",
      editPolicy: "structured",
      interactionPolicy: "structured-block",
      priority: 25,
      markerNodeNames: ["DirectiveMarker"],
      contentStrategy: "full",
    },
  },

  // 3. 解析标题与类型元数据
  extractMetadata(node, source) {
    const rawText = source.slice(node.from, node.to);
    const match = rawText.match(/^:::([a-z]+)(?:\s+(.*))?/i);
    return {
      directiveType: match?.[1] || "info",
      title: match?.[2] || "Note",
    };
  },

  // 4. 计算内部正文区间（剥离外部标记符号）
  resolveContentRange(node, source) {
    const firstNewline = source.indexOf("\n", node.from);
    const lastMarker = source.lastIndexOf(":::", node.to);
    return {
      from: firstNewline + 1,
      to: lastMarker > firstNewline ? lastMarker - 1 : node.to,
    };
  },

  // 5. 构建所见即所得卡片装饰器
  buildDecorations(record, state, context) {
    const { from, to, directive } = record;
    // 使用 Decoration.widget 替换首行标记为卡片头部
    // 使用 Decoration.mark 为整个容器添加卡片边框类名
    return [
      Decoration.mark({
        attributes: { class: `directive-box directive-${directive?.directiveType}` },
      }).range(from, to),
    ];
  },
};
```

---

## 四、如何接入与使用插件

### 方式 A：声明式初始化（首屏强力推荐，零闪烁）

在 React 应用中（例如使用 `<CodeMirrorEditor />` 或桌面端 / Web 端包装器），通过 `plugins` 属性一次性传入：

```tsx
import { CodeMirrorEditor } from "@md-editor/editor-ui";
import { containerDirectivePlugin } from "@md-editor/syntax-plugins";

export function MyEditor({ docState }) {
  return (
    <CodeMirrorEditor
      document={docState}
      plugins={[containerDirectivePlugin]}
    />
  );
}
```
*优势：编辑器初始化时，AST 规则即已装载就绪，首屏挂载即呈现最终渲染形态，无二次重绘。*

### 方式 B：命令式动态插拔（按需加载、第三方扩展）

通过渲染器实例上的 `renderer.use(...)` 动态加载插件：

```ts
// 支持批量传入多个插件（底层合并为单个事务，零冗余重绘）
renderer.use(pluginA, pluginB);

// 也支持数组传参或流式链式调用
renderer.use([pluginA, pluginB]).use(pluginC);
```

#### 动态调用的最佳实践与避坑指南

1. **避免在循环中单发调用**：
   ```ts
   // ❌ 差：产生 N 次 CodeMirror 事务派发
   for (const p of plugins) {
     renderer.use(p);
   }

   // ✅ 好：批量单次传入，合并为 1 次原子派发
   renderer.use(...plugins);
   ```

2. **区分 UI 插件与语法插件**：
   如果只想改变样式、图标或加行高亮，**不要写空 `markdownExtension`**。保持 `markdownExtension` 为 `undefined`，底层会自动识别为 UI 插件，跳过全篇 AST 重新解析，性能提高数倍。

3. **零配置幂等性保证**：
   即使重复传入相同 `id` 的插件，底层也会自动过滤重复项，保证对已有状态的幂等安全。
