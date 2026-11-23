//! Markdown 渲染命令。
//!
//! 桌面端的 Markdown → HTML 渲染委托给 `md-render` crate（仓库根 `crates/render`）。
//! 该 crate 的输出与 TS 侧 `@md-editor/compiler` 保持等价，由
//! `scripts/render-diff` 的差分测试守护——因为移动端仍然使用 TS 实现，
//! 两套渲染器是**终态**而非过渡态。
//!
//! 边界说明（刻意为之）：
//! - Rust 只做 `markdown -> html`，不处理 mermaid。` ```mermaid ` 代码块原样输出为
//!   `<pre><code class="language-mermaid">`，由前端替换为 SVG。
//! - 字体 CSS、图片内联、打印样式由前端拼装后作为 `customCss` 传入，
//!   Rust 不感知主题与导出策略。

use serde::Serialize;

/// 渲染结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenderedDocument {
    /// 完整 standalone HTML 文档。
    html: String,
    /// 从正文提取的文档标题（第一个 H1），用于导出文件命名。
    title: String,
}

/// 把 Markdown 渲染为 standalone HTML 文档。
///
/// `custom_css` 由前端拼装（主题样式 + 字体覆盖 + `@page` 打印规则）。
#[tauri::command]
pub(crate) fn render_markdown_document(
    markdown: String,
    custom_css: Option<String>,
) -> Result<RenderedDocument, String> {
    let options = md_render::DocumentOptions {
        title: None,
        custom_css,
    };
    let html = md_render::render_document(&markdown, &options);
    let title =
        md_render::extract_document_title(&markdown).unwrap_or_else(|| "Untitled".to_string());
    Ok(RenderedDocument { html, title })
}

/// 把已渲染的 HTML 片段包装为 standalone 文档。
///
/// 前端在片段上完成宿主侧后处理（mermaid → SVG、图片 → Data URL）后再调用本命令，
/// 这样「渲染」与「资源内联」职责分离：Rust 只负责 Markdown 语义，
/// 资源处理留在有能力访问文件系统/图表引擎的前端。
#[tauri::command]
pub(crate) fn render_markdown_document_from_fragment(
    fragment: String,
    custom_css: Option<String>,
) -> Result<String, String> {
    Ok(md_render::wrap_document_fragment(
        &fragment,
        &custom_css.unwrap_or_default(),
        "Untitled",
    ))
}

/// 把 Markdown 渲染为 HTML 片段（富文本剪贴板、内联预览等场景）。
#[tauri::command]
pub(crate) fn render_markdown_fragment(
    markdown: String,
    include_markers: Option<bool>,
) -> Result<String, String> {
    let options = md_render::RenderOptions { include_markers };
    Ok(md_render::render_html(&markdown, &options))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_standalone_document_with_title() {
        let result = render_markdown_document("# 标题\n\n正文。".to_string(), None).unwrap();
        assert!(result.html.starts_with("<!doctype html>"));
        assert_eq!(result.title, "标题");
    }

    #[test]
    fn injects_custom_css() {
        let result =
            render_markdown_document("# T".to_string(), Some("@page { size: A4; }".to_string()))
                .unwrap();
        assert!(result.html.contains("@page { size: A4; }"));
    }

    #[test]
    fn fragment_keeps_mermaid_as_code_block() {
        // mermaid 契约：Rust 只输出代码块，SVG 由宿主后处理。
        let html =
            render_markdown_fragment("```mermaid\ngraph TD\n  A --> B\n```".to_string(), None)
                .unwrap();
        assert!(html.contains("language-mermaid"));
        assert!(!html.contains("<svg"));
    }

    #[test]
    fn fragment_without_markers_drops_cm_md_marker() {
        let with_markers = render_markdown_fragment("**加粗**".to_string(), Some(true)).unwrap();
        let without_markers =
            render_markdown_fragment("**加粗**".to_string(), Some(false)).unwrap();
        assert!(with_markers.contains("cm-md-marker"));
        assert!(!without_markers.contains("cm-md-marker"));
    }
}
