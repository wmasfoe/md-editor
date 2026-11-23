//! # md-render — Rust Markdown → HTML 渲染核心
//!
//! 桌面端与 macOS QuickLook 的渲染核心。输出必须与 `packages/compiler`（TS）逐字节一致，
//! 因为移动端继续使用 TS 实现，两套渲染器的等价性由 `scripts/render-diff` 的差分测试守护。
//!
//! ## 设计要点
//!
//! 1. **comrak 只负责解析**。它的内置 HTML 渲染器产不出 CodeMirror 风格的
//!    `cm-md-marker` 标记，也无法复刻本项目的标题 ID / legacy 别名规则，
//!    因此 HTML 由 [`emit`] 自己发射。
//! 2. **标题 ID 用本项目自己的规则**，不用 `comrak::Anchorizer`。`Anchorizer` 虽然也是
//!    GitHub 语义，但细节不同（例如空标题的兜底值、`_` 的去留），逐字节对齐必须复用
//!    `@md-editor/shared` 的 `slugifyHeading` / `createHeadingSlugAllocator` 语义。
//! 3. **两遍发射**：先扫全文档收集真实标题 ID（legacy 别名要让位给真实 ID），再发射。

mod callout;
mod directive;
mod document;
mod emit;
mod escape;
mod highlight;
mod js_runtime;
mod math;
mod slug;

pub use document::{
    extract_document_title, render_document, wrap_document_fragment, DocumentOptions,
};
pub use escape::escape_html;

/// 内嵌 KaTeX 的版本号（构建期从 node_modules 读取）。
pub fn katex_version() -> &'static str {
    js_runtime::KATEX_VERSION
}

/// 内嵌 highlight.js 的版本号（构建期从 node_modules 读取）。
pub fn highlight_version() -> &'static str {
    js_runtime::HIGHLIGHT_VERSION
}

/// 诊断用：直接调用 katex 并返回原始错误。
pub fn debug_katex(expression: &str, display_mode: bool) -> Result<String, String> {
    js_runtime::katex_render_to_string(expression, display_mode).map_err(|error| error.to_string())
}

/// 诊断用：直接调用 highlight.js 并返回原始错误。
pub fn debug_highlight(code: &str, language: &str) -> Result<String, String> {
    js_runtime::highlightjs_highlight(code, language).map_err(|error| error.to_string())
}
pub use slug::{
    create_heading_slug_allocator, generate_legacy_heading_slug, heading_slug_source,
    slugify_heading, EMPTY_HEADING_SLUG,
};

/// 渲染选项。
#[derive(Debug, Clone, Default)]
pub struct RenderOptions {
    /// 是否输出 CodeMirror 风格的语法标记（`cm-md-marker`）。
    ///
    /// 对应 TS 侧的 `EmitHtmlOptions.includeMarkers`，默认 `true`——导出 HTML 需要
    /// 保留标记以和编辑器所见一致；`false` 用于需要「干净 HTML」的场景。
    pub include_markers: Option<bool>,
}

impl RenderOptions {
    /// 是否输出标记，默认开启。
    fn markers(&self) -> bool {
        self.include_markers.unwrap_or(true)
    }
}

/// 把 Markdown 渲染为 HTML 片段。
///
/// 这是与 TS 侧 `renderStaticHtml(markdown).html` 对应的入口。
///
/// # 示例
///
/// ```
/// let html = md_render::render_html("# 标题\n\n正文。", &md_render::RenderOptions::default());
/// assert!(html.contains("<h1"));
/// ```
pub fn render_html(markdown: &str, options: &RenderOptions) -> String {
    emit::render(markdown, options)
}
