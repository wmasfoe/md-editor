# ADR：桌面正文放弃 WebView，改用 GPUI 原生排版

- 状态：已采纳
- 日期：2026-11-19
- 相关：`gpui_beta_architecture.md`、`.omx/specs/deep-interview-gpui-native-typesetting.md`

## 背景

桌面端经历过三种形态：

1. Tauri 2 + React 19 + CodeMirror 6
2. 纯 Rust GPUI，但富文本退化为「块卡片 + 点击弹出纯文本编辑框 + Apply」
3. GPUI 窗口内嵌 WKWebView，复用 CodeMirror 前端

第 3 种（PR #278）让编辑体验可用，但把 TypeScript 运行时和 WebKit 重新带回了桌面端。这个 ADR 记录为什么最终选择第 4 种形态：GPUI 窗口 + GPUI 原生可编辑排版。

## 决策

**桌面正文由 `packages/editor-typeset` 承担编辑层，`gpui-base` 的 `editor_host` 承担排版渲染，两者通过 `packages/editor-gpui` 的 `TypesetView` 接到 GPUI。**

## 三个被否决的替代方案

### 1. 保留 WKWebView（PR #278 的形态）

否决理由：与「桌面端不该有 TypeScript」的架构目标直接冲突。代价是永久的双运行时、双构建链、双份 IME 与焦点 bug 修复。

但必须记录：**当时选择它并非无据**。见下方「为什么第 2 种形态不够用」。

### 2. 自研文本 shaping 引擎

否决理由：不需要。上游 `gpui-base` 已实现标题字号层级、行内混合字号、表格、代码块与图片排版。

第 2 种形态之所以退化成块卡片，是因为它走的是 `EditorState` + `HighlightStyle` 这条路径，而 `HighlightStyle` **没有 font_size 字段**，`LineLayout.font_size` 是行级而非 run 级。结论不是「GPUI 做不到富排版」，而是「走错了 GPUI 的 API」。

`editor_host` 才是为此设计的入口：它渲染 `BlockNode` 树并回传每个文本叶的几何。

### 3. 抽出 `trait DocumentEditor` 让两套引擎并存

否决理由：两个实现的方法语义并不对等。`WebEditor::composing()` 来自 DOM composition event，`EditorView::has_pending_rich_edit()` 来自块编辑未提交状态，抽成同一个 trait 会让至少一边撒谎。

而 `Document` 已经是唯一数据真相，引擎本来就可替换，不需要再包一层抽象。

## 关键证据（决定了可行性）

| 事实 | 位置 |
| --- | --- |
| `editor_host` 公开可达 | `gpui-kit/src/lib.rs` `pub use ::gpui_base as base;` |
| 块树解析 | `gpui_base::text::editor_host::parse_markdown` |
| 文本叶几何收集 | `collect_leaf_geometry` → `HashMap<u64, LeafGeometry>` |
| 命中与光标 | `LeafGeometry::{index_for_position, caret_for_position, position_for_caret}` |
| 软换行处一个偏移两个光标位 | `Caret { index, affinity }` |
| 行内混合字号已实现 | `gpui-base/src/text/inline.rs` `InlineHighlight::font_size_scale` |
| GPUI 内置 resvg | `gpui-pre/src/svg_renderer.rs` |

## 上游不提供、由本仓库实现的部分

`editor_host` 文档明确声明：*"it is not a complete visual-caret navigation or pagination API"*。

因此以下能力在 `editor-typeset` 中自行实现并测试：

- 垂直光标移动（按行高步进后反向命中，保留水平位置，越界返回 `None` 交由调用方跨块）
- 水平移动按整字符步进（不允许落在 UTF-8 中间）
- UTF-16 / UTF-8 偏移转换（IME 正确性的前提）
- 编辑操作、选区状态、文档版本

## mermaid 与数学公式

两者都产出 SVG，统一走 `editor-typeset::svg` 的共享通道（`SvgRenderer::parse_svg` → `ImageSource::Render`），复用 GPUI 已有的 resvg，不引入第二套 SVG 栈。

- mermaid：`mermaid-rs-renderer`，**不启用 `png` feature**，因此不引入 `resvg ^0.47`，避开工作区已有的 0.45.1 与 0.46.0 两份
- 数学公式：`latex-rust`，其 MSRV 是 1.99，这是工作区工具链升级的直接原因

**渲染失败一律降级为源码展示**，绝不阻塞编辑。这是产品要求，不是容错补丁。

## 后果

**正向**

- 桌面端无 TypeScript、无 wry、无 WebKit
- `workspace.rs` 的 13 处 `#[cfg(target_os)]` 分叉全部消除
- 单一构建链
- 桌面与 Playground 共用同一套排版与编辑语义

**负向 / 已知代价**

- `packages/editor`（CodeMirror）仍服务 Web 应用，两套编辑器并存于仓库（但桌面不再用它）
- mermaid 与 math 的渲染覆盖度与 npm 版 mermaid/KaTeX 存在差异，未逐项比对
- 系统输入法的组合输入仍需 macOS 实机验收
- 工作区 MSRV 从 1.98 升到 1.99，贡献者需同步工具链

## 复核条件

出现以下情况时应重新审视本决策：

- `gpui-pre` 补齐 accessibility（当前 canvas 渲染无可访问性树），使 Playground 也可去掉 DOM 按钮
- `mermaid-rs-renderer` 与 npm mermaid 的视觉差异被证明影响真实用户
- 桌面端需要的能力（如 MDX 组件执行）被证明无法在 GPUI 内实现
