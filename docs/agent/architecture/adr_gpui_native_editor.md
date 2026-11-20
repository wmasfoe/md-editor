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

**已接线。** `DiagramRenderer::replace_diagrams` 把 `mermaid` 与 `math` fence 换成图片段落，其余块原样通过；`TypesetDocument::parse_with` 接受一个渲染器，`TypesetView` 跨 re-parse 保留同一个实例（它持有字体数据库与解析后的数学字体）。渲染失败时该块保持代码块原样，即降级为源码。

**图片以 PNG `data:` URL 承载。** 块树只能按 URI 持有图片，而它的解码器读不了 SVG。`data:image/svg+xml` 也不行——`ImageFormat::Svg` 虽然存在，实际解码走 `image` crate 的 `decode_static_image`，不支持 SVG。可行路径是把已经光栅化好的像素编码成 PNG：`tiny-skia` 的 `Pixmap::encode_png` 与 `image` 的 `PngEncoder` 都在依赖树里（前者来自 GPUI 的 resvg）。

代价是**每次解析**多一次 PNG 编码与 base64（不是每帧）：图在 `TypesetDocument::parse_at` 时编码一次，之后每帧只绘制已生成的图片。重解析发生在打开文档、每次编辑与切换缩放时。若将来发现大图在连续输入下拖慢，可以按 `(source, scale)` 缓存编码结果。

**Markdown 解析失败是另一回事。** `TypesetView::new` 会把整篇原文当作一个代码块渲染（不是白屏），`reparse` 失败时保留上一棵树；`parse_error()` 供宿主把原因显示在状态栏。

两个依赖都验证过可编译到 `wasm32-unknown-unknown`（`cargo +nightly check --package inkpoint-editor-web --target wasm32-unknown-unknown` 通过）。这一点必须守住：`editor-web` → `editor-gpui` → `editor-typeset` 这条链意味着 Playground 也会编译这两个 crate，任何一个不支持 wasm 都会同时打断桌面与 Playground 的构建。

## 后果

**正向**

- 桌面端无 TypeScript、无 wry、无 WebKit
- `workspace.rs` 的 13 处 `#[cfg(target_os)]` 分叉全部消除
- 单一构建链
- 编辑语义（选区、撤销、编辑操作、光标移动、偏移换算、行定位）集中到 `editor-typeset`，桌面与 Playground 共用。跨 leaf 的邻接选择已下沉到 `TypesetDocument::vertical_neighbour`；图片路径白名单仍在视图层，见下方代价

**负向 / 已知代价**

- `packages/editor`（CodeMirror）仍服务 Web 应用，桌面不再用它
- `editor-gpui` 只剩 `TypesetView`；旧的 `EditorView`（块卡片式）已删除，桌面与 Playground 跑同一个视图
- mermaid 与 math 的渲染覆盖度与 npm 版 mermaid/KaTeX 存在差异，未逐项比对
- 图片路径白名单仍在视图层。它是「什么内容允许进入缓冲区」的文档策略，应随其余插入守卫一起下沉到 `editor-typeset`
- **撤销按整篇快照存，上限 200 步。** 内存约为 `200 × 文档大小`。对常见文章不到 1MB；超大文档会把自己的体积存 200 份。这是拿可控的最坏情况换「快照不会与产生它的编辑不一致」
- 选区高亮色是硬编码字面量，主题化需要改 `editor-typeset`。与图片白名单同类，属展示策略放在语义层
- 工作区 MSRV 从 1.98 升到 1.99，贡献者需同步工具链

## 复核条件

出现以下情况时应重新审视本决策：

- `gpui-pre` 补齐 accessibility（当前 canvas 渲染无可访问性树），使 Playground 也可去掉 DOM 按钮
- `mermaid-rs-renderer` 与 npm mermaid 的视觉差异被证明影响真实用户
- 桌面端需要的能力（如 MDX 组件执行）被证明无法在 GPUI 内实现
