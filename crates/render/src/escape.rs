//! HTML 转义。
//!
//! 必须与 TS 侧 `escapeHtml` 逐字符一致：
//! `&` → `&amp;`、`<` → `&lt;`、`>` → `&gt;`、`"` → `&quot;`、`'` → `&#39;`。

/// 转义 HTML 文本节点与属性值。
///
/// 替换顺序与 TS 实现一致（先 `&`，避免二次转义）。
pub fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_all_five_entities() {
        assert_eq!(
            escape_html("<a href=\"x\">'&'</a>"),
            "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;"
        );
    }

    #[test]
    fn leaves_plain_text_untouched() {
        assert_eq!(escape_html("普通文本 abc 123"), "普通文本 abc 123");
    }

    #[test]
    fn ampersand_is_escaped_once() {
        // 已经是实体的输入不应被二次转义（逐字符扫描天然满足）
        assert_eq!(escape_html("&amp;"), "&amp;amp;");
    }
}
