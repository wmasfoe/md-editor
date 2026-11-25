//! Container Directive（`:::tip … :::`）的分段与 GFM Alert 的类型映射。
//!
//! comrak **没有** `:::` 容器语法（它的 `alerts` 是 `> [!NOTE]` 那套），因此这里在
//! 交给 comrak 之前先按行把源码切成「普通 Markdown 片段」与「directive 片段」，
//! directive 的正文再递归解析。
//!
//! 语义严格对齐 TS 侧 markdown extension 的正则：
//!
//! ```text
//! /^:::([a-zA-Z0-9_-]+)(?:[ \t]+([^\r\n]+))?[\r\n]+([\s\S]*?)[\r\n]+:::/
//! ```
//!
//! 关键点（每一条都由上面这个正则直接推出，勿凭直觉改动）：
//! - 开围栏行必须**从第 0 列**开始 `:::`：缩进的 `:::` 在 TS 侧是字面量
//!   （1–3 个空格会变成独立段落，4 个空格是缩进代码块），因此这里不做缩进容错；
//! - 开围栏行只有 `:::type` 与可选标题，标题前至少一个空格/制表符；标题组要么
//!   整体缺席，要么至少含一个非换行字符，所以「只有 1 个空白」的行不是开围栏，
//!   「≥2 个空白」的行是空标题的开围栏；
//! - 收尾行是**第一个以 `:::` 开头**的行（`[\r\n]+:::` 不含行尾锚点），
//!   `:::` 之后的残留文本成为后续 Markdown；
//! - 开围栏行与收尾行之间至少要隔一行（否则 body 前后各需一个换行无法同时满足）；
//! - 开围栏**不要求块边界**：TS 的 `start()` 会在段落中间切出 directive，
//!   因此 `段落\n:::tip\nx\n:::` 在 TS 侧是「段落 + 容器」，这里同样切分；
//! - 围栏代码块（```` ``` ```` / `~~~`）内的 `:::` 保持字面量——TS 的 block
//!   tokenizer 在围栏 token 消耗完之前不会检查扩展；
//! - 找不到收尾行时整块**回退为普通 Markdown**（不得吞噬后续正文——历史上踩过）。

/// 源码片段。
pub enum Segment<'a> {
    /// 普通 Markdown 片段。
    Markdown(&'a str),
    /// 容器指令片段。
    Directive {
        /// 归一化后的指令类型（小写）。
        kind: String,
        /// 文档显式指定的标题；为空时调用方使用默认标题。
        title: String,
        /// 指令正文（待递归解析）。
        body: String,
        /// 该容器写在列表项内（`- :::note`），输出时需用 `<ul><li>` 包裹。
        in_list_item: bool,
    },
}

/// 源码的一行：起始字节偏移 + 去掉行尾 `\r` 的文本。
struct Line<'a> {
    /// 该行在源码中的起始字节偏移。
    start: usize,
    /// 该行文本（不含行尾换行，已去掉 `\r`）。
    text: &'a str,
}

/// 围栏代码块的开围栏状态。
///
/// 只用于让代码块内的 `:::` 保持字面量；收尾行的搜索**不**看围栏状态，
/// 因为 TS 侧收尾行是纯粹的文本正则匹配，代码块内的 `:::` 同样会闭合容器。
#[derive(Clone, Copy)]
struct Fence {
    /// 围栏字符：`` ` `` 或 `~`。
    marker: u8,
    /// 开围栏的连续字符数。
    length: usize,
}

impl Fence {
    /// 若该行开启围栏代码块，返回其状态。
    fn opening(line: &str) -> Option<Self> {
        let rest = strip_indent(line, 3)?;
        let marker = match rest.as_bytes().first()? {
            b'`' => b'`',
            b'~' => b'~',
            _ => return None,
        };
        let length = rest.bytes().take_while(|byte| *byte == marker).count();
        if length < 3 {
            return None;
        }
        // CommonMark：反引号围栏的信息串里不允许再出现反引号，否则该行不是围栏。
        if marker == b'`' && rest[length..].contains('`') {
            return None;
        }
        Some(Self { marker, length })
    }

    /// 该行是否收尾当前围栏。
    fn closed_by(self, line: &str) -> bool {
        let Some(rest) = strip_indent(line, 3) else {
            return false;
        };
        let run = rest.bytes().take_while(|byte| *byte == self.marker).count();
        run >= self.length && rest[run..].trim().is_empty()
    }
}

/// 去掉至多 `max` 个前导空格；缩进更深时返回 `None`。
fn strip_indent(line: &str, max: usize) -> Option<&str> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    (indent <= max).then(|| &line[indent..])
}

/// 该行是否是主题分隔线（`---` / `___` / `***`）。
fn is_thematic_break(line: &str) -> bool {
    let Some(rest) = strip_indent(line, 3) else {
        return false;
    };
    let mut marker = None;
    let mut count = 0usize;
    for ch in rest.chars() {
        match ch {
            '-' | '_' | '*' => {
                if marker.is_some_and(|seen| seen != ch) {
                    return false;
                }
                marker = Some(ch);
                count += 1;
            }
            ' ' | '\t' => {}
            _ => return false,
        }
    }
    count >= 3
}

/// 该行是否是 GFM 表格的分隔行（`| --- | :-: |`）。
fn is_table_delimiter(line: &str) -> bool {
    let Some(rest) = strip_indent(line, 3) else {
        return false;
    };
    rest.contains('-')
        && (rest.contains('|') || rest.contains(':'))
        && rest
            .chars()
            .all(|ch| matches!(ch, '|' | '-' | ':' | ' ' | '\t'))
}

/// 表格内部：非空行只要不开启新块，就仍然是表格行。
///
/// 对应 marked 表格行正则里 `(?! *\n|hr|heading|blockquote|code|fences|list|html)`
/// 那一组否定前瞻——表格不会因为 `:::` 行而结束，因此容器识别必须让位。
fn table_continues(line: &str) -> bool {
    if line.trim().is_empty()
        || is_thematic_break(line)
        || Fence::opening(line).is_some()
        || html_block_start(line).is_some()
    {
        return false;
    }
    // 4 空格缩进开启缩进代码块。
    let Some(rest) = strip_indent(line, 3) else {
        return false;
    };
    !starts_block_after_indent(rest)
}

/// 去掉至多三个前导空格后，该行是否开启一个「表格会因此结束」的块。
fn starts_block_after_indent(rest: &str) -> bool {
    if rest.starts_with('>') || rest.starts_with('#') {
        return true;
    }
    // 列表标记：`[*+-]` 或 `\d{1,9}[.)]`，后面必须是空格、制表符或行尾。
    let after_marker = if let Some(tail) = rest.strip_prefix(['-', '+', '*']) {
        tail
    } else {
        let digits = rest.chars().take_while(char::is_ascii_digit).count();
        if digits == 0 || digits > 9 {
            return false;
        }
        match rest[digits..].strip_prefix(['.', ')']) {
            Some(tail) => tail,
            None => return false,
        }
    };
    after_marker.is_empty() || after_marker.starts_with(' ') || after_marker.starts_with('\t')
}

/// 未结束的 HTML 块会一直吞掉后续行，其内部的 `:::` 只是 HTML 原文。
///
/// TS 侧的扩展只在**块边界**上尝试，而 CommonMark 的 HTML 块（类型 1–5 由
/// 特定串收尾，类型 6 由空行收尾）会把后续行整体吞下——`<div>x</div>\n:::note`
/// 在 TS 侧是纯 HTML，不是容器。
#[derive(Clone, Copy)]
enum HtmlBlockEnd {
    /// 空行结束（类型 6：已知块级标签开头的行）。
    BlankLine,
    /// 含该字面串的行结束（注释、处理指令、CDATA）。
    Literal(&'static str),
    /// 含 `</tag>` 的行结束（`script` / `pre` / `style` / `textarea`，大小写不敏感）。
    ClosingTag(&'static str),
}

impl HtmlBlockEnd {
    /// 该行是否结束当前 HTML 块。
    fn ends_at(self, line: &str) -> bool {
        match self {
            Self::BlankLine => line.trim().is_empty(),
            Self::Literal(terminator) => line.contains(terminator),
            Self::ClosingTag(tag) => line.to_ascii_lowercase().contains(tag),
        }
    }
}

/// CommonMark HTML 块类型 6 的块级标签名。
const HTML_BLOCK_TAGS: &[&str] = &[
    "address",
    "article",
    "aside",
    "base",
    "basefont",
    "blockquote",
    "body",
    "caption",
    "center",
    "col",
    "colgroup",
    "dd",
    "details",
    "dialog",
    "dir",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "frame",
    "frameset",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "html",
    "iframe",
    "legend",
    "li",
    "link",
    "main",
    "menu",
    "menuitem",
    "meta",
    "nav",
    "noframes",
    "ol",
    "optgroup",
    "option",
    "p",
    "param",
    "search",
    "section",
    "summary",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "title",
    "tr",
    "track",
    "ul",
];

/// 若该行开启一个 HTML 块且该块未在本行结束，返回其结束条件。
fn html_block_start(line: &str) -> Option<HtmlBlockEnd> {
    let rest = strip_indent(line, 3)?;
    if !rest.starts_with('<') {
        return None;
    }

    // 类型 1–4：注释、处理指令、CDATA，由固定字面串收尾。
    for (prefix, terminator) in [("<!--", "-->"), ("<?", "?>"), ("<![CDATA[", "]]>")] {
        let Some(body) = rest.strip_prefix(prefix) else {
            continue;
        };
        return (!body.contains(terminator)).then_some(HtmlBlockEnd::Literal(terminator));
    }

    // 类型 1：`script` / `pre` / `style` / `textarea`，由对应收尾标签结束。
    for tag in ["script", "pre", "style", "textarea"] {
        if !starts_with_tag_ignore_case(rest, tag) {
            continue;
        }
        let closing = format!("</{tag}>");
        let closed_inline = rest[1 + tag.len()..]
            .to_ascii_lowercase()
            .contains(&closing);
        return (!closed_inline).then_some(HtmlBlockEnd::ClosingTag(match tag {
            "script" => "</script>",
            "pre" => "</pre>",
            "style" => "</style>",
            _ => "</textarea>",
        }));
    }

    // 类型 6：已知块级标签开头的行，一直延续到空行。
    let after_bracket = rest[1..].strip_prefix('/').unwrap_or(&rest[1..]);
    let name_len = after_bracket
        .bytes()
        .take_while(u8::is_ascii_alphanumeric)
        .count();
    let name = after_bracket[..name_len].to_ascii_lowercase();
    HTML_BLOCK_TAGS
        .contains(&name.as_str())
        .then_some(HtmlBlockEnd::BlankLine)
}

/// `rest` 是否以 `<tag` 开头（标签名大小写不敏感，且标签名后必须是分隔符）。
fn starts_with_tag_ignore_case(rest: &str, tag: &str) -> bool {
    let Some(tail) = rest.get(1..1 + tag.len()) else {
        return false;
    };
    tail.eq_ignore_ascii_case(tag)
        && !matches!(
            rest.as_bytes().get(1 + tag.len()),
            Some(byte) if byte.is_ascii_alphanumeric()
        )
}

/// 把源码切成普通片段与 directive 片段。
pub fn split_directives(markdown: &str) -> Vec<Segment<'_>> {
    let lines = split_lines(markdown);
    let mut segments = Vec::new();
    let mut plain_start = 0usize;
    let mut index = 0usize;
    let mut fence: Option<Fence> = None;
    let mut html_block: Option<HtmlBlockEnd> = None;
    let mut in_table = false;

    while index < lines.len() {
        let line = &lines[index];

        // 表格行一直延续到空行或新块开始；其内部的 `:::` 只是单元格文本。
        if in_table {
            if table_continues(line.text) {
                index += 1;
                continue;
            }
            in_table = false;
        }
        // 表格分隔行之后紧跟的都是表格行，直到空行或新块开始。
        if index > 0 && is_table_delimiter(line.text) && !lines[index - 1].text.trim().is_empty() {
            in_table = true;
            index += 1;
            continue;
        }

        // 围栏代码块内部（含开、闭围栏行本身）不参与 directive 识别。
        if let Some(open) = fence {
            if open.closed_by(line.text) {
                fence = None;
            }
            index += 1;
            continue;
        }
        if let Some(open) = Fence::opening(line.text) {
            fence = Some(open);
            index += 1;
            continue;
        }

        // 未结束的 HTML 块内部同样不参与 directive 识别。
        if let Some(end) = html_block {
            if end.ends_at(line.text) {
                html_block = None;
            }
            index += 1;
            continue;
        }
        if let Some(end) = html_block_start(line.text) {
            html_block = Some(end);
            index += 1;
            continue;
        }

        // 列表项内的 directive（`- :::note`）与「行首的 directive」输出结构不同：
        // 前者是 `<ul><li>` 包裹 + 正文去缩进，后者是顶层容器。
        let Some((kind, title, in_list_item)) = parse_directive_opening(line.text) else {
            index += 1;
            continue;
        };

        let Some((closing, after_close)) = find_closing(&lines, index, in_list_item) else {
            // 未闭合：不是 directive，按普通文本继续。
            index += 1;
            continue;
        };

        if plain_start < line.start {
            segments.push(Segment::Markdown(&markdown[plain_start..line.start]));
        }
        // body 起点跳过紧随开围栏行的空行（正则的 `[\r\n]+` 是贪婪的）。
        let mut body_start = index + 1;
        while body_start < closing && lines[body_start].text.is_empty() {
            body_start += 1;
        }
        let raw_body =
            markdown[lines[body_start].start..lines[closing].start].trim_end_matches(['\r', '\n']);
        // 列表项内的正文带有列表缩进，需按公共缩进去除（与 marked 的
        // 列表内容去缩进语义一致），否则内部 Markdown 会被当作缩进代码块。
        let body = if in_list_item {
            dedent(raw_body)
        } else {
            raw_body.to_string()
        };
        segments.push(Segment::Directive {
            kind,
            title,
            body,
            in_list_item,
        });
        // `:::` 之后的残留文本仍属于普通 Markdown，因此这里只前进到 `:::` 之后，
        // 行扫描则从收尾行的下一行继续。
        plain_start = after_close;
        index = closing + 1;
    }

    // 收尾行的 `:::` 之后可能只剩空白（甚至只剩换行），这类尾片段没有块内容，
    // 不作为片段返回，避免让前面的片段误判「后面还有内容」。
    if plain_start < markdown.len() && !markdown[plain_start..].trim().is_empty() {
        segments.push(Segment::Markdown(&markdown[plain_start..]));
    }
    segments
}

/// 把源码切成行。
fn split_lines(markdown: &str) -> Vec<Line<'_>> {
    let mut lines = Vec::new();
    let mut start = 0usize;
    for (offset, byte) in markdown.bytes().enumerate() {
        if byte != b'\n' {
            continue;
        }
        let text = &markdown[start..offset];
        lines.push(Line {
            start,
            text: text.strip_suffix('\r').unwrap_or(text),
        });
        start = offset + 1;
    }
    if start < markdown.len() {
        lines.push(Line {
            start,
            text: &markdown[start..],
        });
    }
    lines
}

/// 解析开围栏行，返回（类型, 标题, 是否列表项内）。
///
/// 列表项内的 `:::type` 优先：它的 `:::` 不在行首，行首解析必失败。
fn parse_directive_opening(line: &str) -> Option<(String, String, bool)> {
    if let Some(offset) = list_item_directive_offset(line) {
        let (kind, title) = parse_opening(&line[offset..])?;
        return Some((kind, title, true));
    }
    let (kind, title) = parse_opening(line)?;
    Some((kind, title, false))
}

/// 解析开围栏行。返回（类型, 标题）。
fn parse_opening(line: &str) -> Option<(String, String)> {
    let rest = line.strip_prefix(":::")?;
    if rest.is_empty() {
        return None;
    }

    // 类型：`[A-Za-z0-9_-]+`
    let kind_len = rest
        .char_indices()
        .take_while(|(_, ch)| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
        .map(|(index, ch)| index + ch.len_utf8())
        .last()?;
    let kind = &rest[..kind_len];
    let after_kind = &rest[kind_len..];

    // 类型之后只能是行尾，或「至少一个空格/制表符 + 标题」。
    if after_kind.is_empty() {
        return Some((kind.to_lowercase(), String::new()));
    }
    if !after_kind.starts_with(' ') && !after_kind.starts_with('\t') {
        return None;
    }
    // `(?:[ \t]+([^\r\n]+))?`：`[ \t]+` 与 `[^\r\n]+` 各需至少一个字符，因此
    // 整段只有 1 个空白时无法匹配（回退到「标题组缺席」也不行——后面紧跟的不是
    // 换行）；≥2 个空白时前者吃掉 k-1 个、后者吃掉最后 1 个，标题 trim 后为空。
    let title = after_kind.trim();
    if title.is_empty() && after_kind.chars().count() < 2 {
        return None;
    }
    Some((kind.to_lowercase(), title.to_string()))
}

/// 定位收尾行，返回（收尾行序号, 收尾行 `:::` 之后的字节偏移）。
///
/// 收尾行是**第一个以 `:::` 开头**的行；`allow_indent` 为真时（列表项内）
/// 允许前置缩进。开围栏行与收尾行之间至少要隔一行。
fn find_closing(lines: &[Line<'_>], opening: usize, allow_indent: bool) -> Option<(usize, usize)> {
    for (index, line) in lines.iter().enumerate().skip(opening + 2) {
        let indent = if allow_indent {
            line.text.len() - line.text.trim_start().len()
        } else {
            0
        };
        if line.text[indent..].starts_with(":::") {
            return Some((index, line.start + indent + 3));
        }
    }
    None
}

/// 若该行是「列表标记 + `:::type`」，返回 `:::` 在行内的字节偏移。
///
/// 只处理列表标记与 `:::` 在**同一行**的情形（`- :::note`），
/// 缩进的续行 directive（`  :::note`）在 TS 侧是字面量，不在此列。
fn list_item_directive_offset(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    let indent = line.len() - trimmed.len();
    let after_marker = if let Some(rest) = trimmed.strip_prefix("- ") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("* ") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("+ ") {
        rest
    } else {
        let digits = trimmed.chars().take_while(char::is_ascii_digit).count();
        if digits == 0 {
            return None;
        }
        let after = &trimmed[digits..];
        after
            .strip_prefix(". ")
            .or_else(|| after.strip_prefix(") "))?
    };
    let spaces = after_marker.len() - after_marker.trim_start().len();
    let candidate = indent + (trimmed.len() - after_marker.len()) + spaces;
    line[candidate..].starts_with(":::").then_some(candidate)
}

/// 按所有非空行的公共前导空白去除缩进。
fn dedent(text: &str) -> String {
    let common = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.len() - line.trim_start().len())
        .min()
        .unwrap_or(0);
    if common == 0 {
        return text.to_string();
    }
    text.lines()
        .map(|line| {
            if line.trim().is_empty() {
                String::new()
            } else {
                line.get(common..).unwrap_or(line).to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_closed_directive() {
        let segments = split_directives(":::tip\n正文\n:::\n");
        assert_eq!(segments.len(), 1);
        match &segments[0] {
            Segment::Directive {
                kind, title, body, ..
            } => {
                assert_eq!(kind, "tip");
                assert_eq!(title, "");
                assert_eq!(body, "正文");
            }
            _ => panic!("应为 directive 片段"),
        }
    }

    #[test]
    fn parses_custom_title() {
        let segments = split_directives(":::warning 注意安全\n正文\n:::");
        match &segments[0] {
            Segment::Directive { kind, title, .. } => {
                assert_eq!(kind, "warning");
                assert_eq!(title, "注意安全");
            }
            _ => panic!("应为 directive 片段"),
        }
    }

    #[test]
    fn unclosed_directive_falls_back_to_markdown() {
        let segments = split_directives(":::tip\n未闭合\n\n# 后续标题\n");
        assert_eq!(segments.len(), 1);
        assert!(matches!(segments[0], Segment::Markdown(_)));
    }

    #[test]
    fn splits_directive_right_after_paragraph() {
        // TS 的 `start()` 会在段落中间切出 directive，不要求前置空行。
        let segments = split_directives("正文段落\n:::tip\n是容器\n:::\n");
        assert_eq!(segments.len(), 2);
        assert!(matches!(segments[0], Segment::Markdown("正文段落\n")));
        match &segments[1] {
            Segment::Directive { body, .. } => assert_eq!(body, "是容器"),
            _ => panic!("应为 directive 片段"),
        }
    }

    #[test]
    fn keeps_surrounding_markdown() {
        let segments = split_directives("# 前\n\n:::note\n内容\n:::\n\n# 后\n");
        assert_eq!(segments.len(), 3);
        assert!(matches!(segments[0], Segment::Markdown(_)));
        assert!(matches!(segments[1], Segment::Directive { .. }));
        assert!(matches!(segments[2], Segment::Markdown(_)));
    }

    #[test]
    fn requires_at_least_one_body_line() {
        // `:::tip\n:::`：body 前后各需一个换行，单行间隔无法同时满足。
        let segments = split_directives(":::tip\n:::");
        assert_eq!(segments.len(), 1);
        assert!(matches!(segments[0], Segment::Markdown(_)));
        // 空行也算 body 行，此时 body 为空串。
        let segments = split_directives(":::tip\n\n:::");
        match &segments[0] {
            Segment::Directive { body, .. } => assert_eq!(body, ""),
            _ => panic!("应为 directive 片段"),
        }
    }

    #[test]
    fn closing_fence_tolerates_trailing_text() {
        let segments = split_directives(":::tip\nx\n::: tail");
        assert_eq!(segments.len(), 2);
        match &segments[0] {
            Segment::Directive { body, .. } => assert_eq!(body, "x"),
            _ => panic!("应为 directive 片段"),
        }
        assert!(matches!(segments[1], Segment::Markdown(" tail")));
    }

    #[test]
    fn closing_fence_must_start_at_line_begin() {
        let segments = split_directives(":::tip\nx\n  :::");
        assert_eq!(segments.len(), 1);
        assert!(matches!(segments[0], Segment::Markdown(_)));
    }

    #[test]
    fn opening_fence_tolerates_trailing_whitespace() {
        // ≥2 个空白 → 空标题开围栏；恰好 1 个空白 → 不是开围栏。
        let segments = split_directives(":::tip  \nx\n:::");
        match &segments[0] {
            Segment::Directive { kind, title, .. } => {
                assert_eq!(kind, "tip");
                assert_eq!(title, "");
            }
            _ => panic!("应为 directive 片段"),
        }
        let segments = split_directives(":::tip \nx\n:::");
        assert!(matches!(segments[0], Segment::Markdown(_)));
        let segments = split_directives(":::tip\t\nx\n:::");
        assert!(matches!(segments[0], Segment::Markdown(_)));
    }

    #[test]
    fn directive_inside_fenced_code_is_literal() {
        let segments = split_directives("```md\n:::tip\nx\n:::\n```");
        assert_eq!(segments.len(), 1);
        assert!(matches!(segments[0], Segment::Markdown(_)));
        let segments = split_directives("~~~\n:::tip\nx\n:::\n~~~");
        assert_eq!(segments.len(), 1);
    }

    #[test]
    fn first_colon_line_closes_the_container() {
        // 收尾行是第一个以 `:::` 开头的行，残留的 `warning…` 属于后续 Markdown。
        let segments = split_directives(":::tip\n:::note\n:::warning\nx\n:::\n:::\n:::");
        match &segments[0] {
            Segment::Directive { kind, body, .. } => {
                assert_eq!(kind, "tip");
                assert_eq!(body, ":::note");
            }
            _ => panic!("应为 directive 片段"),
        }
    }

    #[test]
    fn indented_opening_fence_is_literal() {
        // 1–3 个空格在 TS 侧是独立段落，4 个空格是缩进代码块，都不是容器。
        for markdown in [" :::tip\nx\n:::", "    :::tip\nx\n:::"] {
            let segments = split_directives(markdown);
            assert_eq!(segments.len(), 1, "{markdown}");
            assert!(matches!(segments[0], Segment::Markdown(_)), "{markdown}");
        }
    }

    #[test]
    fn html_block_swallowing_following_lines_keeps_colons_literal() {
        // CommonMark HTML 块（类型 6）延续到空行，`:::` 只是 HTML 原文。
        let segments = split_directives("<div>x</div>\n:::note\nx\n:::\n");
        assert_eq!(segments.len(), 1);
        assert!(matches!(segments[0], Segment::Markdown(_)));
        // 空行结束 HTML 块后，directive 重新生效。
        let segments = split_directives("<div>x</div>\n\n:::note\nx\n:::");
        assert_eq!(segments.len(), 2);
        assert!(matches!(segments[1], Segment::Directive { .. }));
    }

    #[test]
    fn table_rows_keep_colons_literal() {
        // 表格行延续到空行/新块，`:::` 行只是单元格文本。
        let segments = split_directives("| a |\n| --- |\n| b |\n:::tip\nx\n:::");
        assert_eq!(segments.len(), 1);
        assert!(matches!(segments[0], Segment::Markdown(_)));
        let segments = split_directives("| a |\n| --- |\n| b |\n\n:::tip\nx\n:::");
        assert_eq!(segments.len(), 2);
        assert!(matches!(segments[1], Segment::Directive { .. }));
    }

    #[test]
    fn recognizes_directive_inside_list_item() {
        let segments = split_directives("- :::tip\n  x\n  :::");
        match &segments[0] {
            Segment::Directive {
                body, in_list_item, ..
            } => {
                assert_eq!(body, "x");
                assert!(in_list_item);
            }
            _ => panic!("应为 directive 片段"),
        }
    }
}
