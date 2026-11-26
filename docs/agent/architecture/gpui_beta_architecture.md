# GPUI 桌面编辑器架构

本文描述 Beta 分支当前原生桌面编辑器的分层、输入与排版边界。旧版 Web、WebView 和 WASM 实现不属于当前架构。

## Crate 职责

| 路径 | 职责 |
| --- | --- |
| `packages/editor-core` | Markdown 源文档、编辑会话、选区、撤销/重做、输入事务与命令语义。 |
| `packages/editor-typeset` | Markdown 排版投影、源文本与显示文本的偏移映射、叶节点几何与图表/公式渲染。 |
| `packages/editor-gpui` | `TypesetView`、GPUI 绘制、原生键盘/IME 接入和视图交互。 |
| `apps/desktop` | GPUI 应用窗口、文档与目录操作、图片资源、设置和本地 llama.cpp 调用。 |

crate 依赖以各自 `Cargo.toml` 为准：排版 crate 使用编辑核心，GPUI 视图使用核心和排版 crate，桌面应用将视图接入原生窗口与文件系统。

## 编辑与排版边界

GPUI 的 `editor_host` 将源文档交给排版树，并为文本叶返回命中测试、插入光标和平台输入法所需的几何信息。职责划分如下：

| 能力 | 归属 |
| --- | --- |
| Markdown 源文档、选区、编辑事务、撤销和版本 | `editor-core::session::EditorSession` |
| Markdown 解析为块树 | `gpui-base::editor_host::parse_markdown` |
| 正文布局、段落间距与滚动区域 | `editor-gpui` 的原生布局视图 |
| 段内排版与文本整形 | `gpui-base` 的 `TextView` 渲染器 |
| 文本叶位置、行高与命中区域 | `gpui-base::editor_host::collect_leaf_geometry` |
| 源码标记展开及源码/显示偏移映射 | `editor-typeset::TypesetDocument` |
| 垂直光标导航 | `editor-typeset` 的几何与编辑辅助能力 |
| UTF-16 / UTF-8 转换和 IME 接线 | `editor-core::text` 与 `editor-gpui` 的 `EntityInputHandler` |

### 实现约束

- **叶节点 key 必须挂到实际承载文本的节点。** 标题文本位于内嵌 `Paragraph` 中；只给外层 `BlockNode::Heading` 设置 key 不会收集到该文本的几何。
- **命中几何只在编辑视图自己的布局过程中收集。** `TypesetView` 通过绘制期数据定位文本叶与光标；`TypesetDocument::render_blocks` 用于生成排版块，独立的 `render` 接口会自行收集几何。
- **光标位置以 Markdown 源偏移为准。** 排版显示隐藏或展开语法标记时，`TypesetDocument` 提供源与显示偏移映射，编辑会话仍保存原始 Markdown。
- **IME 组词是临时投影。** 组词期间更新组合文本与选中范围；确认后再提交源文档事务，使一次已确认输入对应一次撤销操作。

## 本地开发与验证

从仓库根目录运行应用，可在命令后追加 Markdown 文件路径：

```sh
cargo run --locked -p inkpoint-gpui -- path/to/document.md
```

运行 Rust workspace 检查：

```sh
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
```

macOS Beta DMG 打包流程见[桌面应用开发说明](../../../apps/desktop/README.md)和[发布指南](../../human/release.md)。
