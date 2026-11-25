//! 数学公式渲染。
//!
//! 目标实现：`katex` crate（quick-js 后端，内嵌 katex.min.js），输出需与 TS 侧
//! `katex.renderToString` 逐字节一致，且 `KATEX_VERSION` 必须与 JS 侧锁定的版本相同
//! （见任务 `phase-1-4-math`）。
//!
//! 实现方式：内嵌 QuickJS 跑与 TS 侧**同一份** `katex.min.js`（构建期从 node_modules
//! 读取，版本自动锁定），调用参数与 `renderMathToString` 完全一致。

/// 渲染结果。
///
/// `error` 在正常路径下不被读取，但保留它以便调用方与测试区分「渲染成功」与
/// 「回退到 katex-error 标记」，因此显式标注允许未读。
pub struct RenderedMath {
    /// 渲染出的 HTML。
    pub html: String,
    /// 渲染失败时的错误信息。
    #[allow(dead_code)]
    pub error: Option<String>,
}

/// 渲染行内或块级公式。
///
/// 失败时回退为与 TS 侧一致的错误标记：`<pre|code class="katex-error">` + 转义原文。
pub fn render_math(source: &str, display_mode: bool) -> RenderedMath {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return RenderedMath {
            html: String::new(),
            error: None,
        };
    }

    match crate::js_runtime::katex_render_to_string(trimmed, display_mode) {
        Ok(html) => RenderedMath { html, error: None },
        Err(error) => {
            let escaped = crate::escape::escape_html(trimmed);
            let tag = if display_mode { "pre" } else { "code" };
            RenderedMath {
                html: format!("<{tag} class=\"katex-error\">{escaped}</{tag}>"),
                error: Some(error.to_string()),
            }
        }
    }
}
