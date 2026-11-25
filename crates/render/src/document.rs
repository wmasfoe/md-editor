//! 静态独立文档渲染（standalone HTML）。
//!
//! 对应 TS 侧 `createStaticDocumentHtml`：把渲染出的正文片段包进完整 HTML 文档，
//! 内联主题 CSS，并附带锚点平滑跳转脚本。供 QuickLook 预览、HTML 导出、打印
//! 与无头 PDF 生成使用。
//!
//! ## 资产来源
//!
//! CSS（约 400 行）与文档模板都在 TS 侧维护。为避免两处维护导致漂移，
//! 构建期直接从 `packages/compiler/src/templates/` 读取并内联（见 `build.rs`），
//! 与数学/高亮采用同一原则：**同一份资产，不做手工复制**。

use crate::escape::escape_html;

/// 构建期从 TS 源提取的完整文档模板。
///
/// 其中 `\u{0}TITLE\u{0}`、`\u{0}CUSTOM_CSS\u{0}`、`\u{0}CONTENT\u{0}` 是插值占位。
const DOCUMENT_TEMPLATE: &str = include_str!(concat!(env!("OUT_DIR"), "/document-template.html"));

/// 渲染选项。
#[derive(Debug, Clone, Default)]
pub struct DocumentOptions {
    /// 文档标题（显示在 `<title>` 中）。缺省时调用方应传入从正文提取的标题。
    pub title: Option<String>,
    /// 追加的自定义 CSS（例如导出时的主题覆盖、`@page` 打印样式）。
    pub custom_css: Option<String>,
}

/// 把正文 HTML 包装成完整的静态文档。
///
/// # 示例
///
/// ```
/// let html = md_render::render_document("# 标题", &md_render::DocumentOptions::default());
/// assert!(html.starts_with("<!doctype html>"));
/// ```
pub fn render_document(markdown: &str, options: &DocumentOptions) -> String {
    let fragment = crate::render_html(markdown, &crate::RenderOptions::default());
    let title = options.title.clone().unwrap_or_else(|| {
        extract_document_title(markdown).unwrap_or_else(|| "Untitled".to_string())
    });

    let custom_css = options.custom_css.clone().unwrap_or_default();

    // 模板里正文与 CSS 之间已有换行，这里不再额外补，保持与 TS 输出一致。
    DOCUMENT_TEMPLATE
        .replace("\u{0}TITLE\u{0}", &escape_html(&title))
        .replace("\u{0}CUSTOM_CSS\u{0}", &custom_css)
        .replace("\u{0}CONTENT\u{0}", &fragment)
}

/// 把已经渲染好的正文片段包装成完整静态文档。
///
/// 与 [`render_document`] 的区别：不重新渲染 Markdown，直接使用调用方给的片段。
/// 用于「先渲染、再由宿主后处理（mermaid/图片内联）、最后包装」的流水线。
pub fn wrap_document_fragment(fragment: &str, custom_css: &str, title: &str) -> String {
    DOCUMENT_TEMPLATE
        .replace("\u{0}TITLE\u{0}", &escape_html(title))
        .replace("\u{0}CUSTOM_CSS\u{0}", custom_css)
        .replace("\u{0}CONTENT\u{0}", fragment)
}

/// 从 Markdown 提取文档标题（第一个 H1）。
///
/// 对应 TS 侧 `extractDocumentTitle`：`/^#\s+([^\n]+)/m`。
pub fn extract_document_title(markdown: &str) -> Option<String> {
    for line in markdown.lines() {
        if let Some(rest) = line.strip_prefix("# ") {
            let title = rest.trim();
            if !title.is_empty() {
                return Some(title.to_string());
            }
        }
        // 跳过前导空行之外的任何内容都不影响；`^#\s+` 允许出现在任意行，
        // 因此这里继续扫描（与正则的 `m` 标志一致）。
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_fragment_into_full_document() {
        let html = render_document("# 标题\n\n正文。", &DocumentOptions::default());
        assert!(html.starts_with("<!doctype html>"));
        assert!(html.contains("<title>标题</title>"));
        assert!(html.contains("<h1"));
        assert!(html.contains("<div id=\"content\">"));
    }

    #[test]
    fn extracts_first_h1_as_title() {
        assert_eq!(
            extract_document_title("# Hello\n\n正文"),
            Some("Hello".to_string())
        );
        assert_eq!(
            extract_document_title("正文\n\n# 后面的标题"),
            Some("后面的标题".to_string())
        );
        assert_eq!(extract_document_title("没有标题"), None);
    }

    #[test]
    fn injects_custom_css() {
        let html = render_document(
            "# T",
            &DocumentOptions {
                custom_css: Some("@page { size: A4; }".to_string()),
                ..Default::default()
            },
        );
        assert!(html.contains("@page { size: A4; }"));
    }

    #[test]
    fn escapes_title_in_head() {
        let html = render_document(
            "正文",
            &DocumentOptions {
                title: Some("<script>x</script>".to_string()),
                ..Default::default()
            },
        );
        assert!(html.contains("&lt;script&gt;"));
        assert!(!html.contains("<title><script>"));
    }

    #[test]
    fn includes_anchor_jump_script() {
        let html = render_document("# T", &DocumentOptions::default());
        assert!(html.contains("resolveHeadingElement"));
        assert!(html.contains("data-heading-text"));
    }
}
