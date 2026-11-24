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
//! 关键点：
//! - 开围栏必须落在**块边界**（文档开头，或前一行为空行），否则不识别；
//! - 开围栏行只有 `:::type` 与可选标题，标题前至少一个空格/制表符；
//! - 收尾行必须是**恰好** `:::`（行首无缩进）；
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

/// 把源码切成普通片段与 directive 片段。
pub fn split_directives(markdown: &str) -> Vec<Segment<'_>> {
    let mut segments = Vec::new();
    let mut plain_start = 0usize;
    let mut index = 0usize;
    let mut at_block_boundary = true;

    while index < markdown.len() {
        let line_end = markdown[index..]
            .find('\n')
            .map(|offset| index + offset)
            .unwrap_or(markdown.len());
        let line = &markdown[index..line_end];
        let stripped = line.strip_suffix('\r').unwrap_or(line);

        // 列表项内的 directive（`- :::note`）与「行首缩进的 directive」
        // 在 TS 侧行为不同：前者识别为容器，后者是字面量。
        // 因此这里额外允许「列表标记之后的 `:::`」。
        let list_item_directive = list_item_prefix(stripped).and_then(parse_opening);
        let is_list_item = list_item_directive.is_some();

        let directive = if at_block_boundary {
            parse_opening(stripped).or(list_item_directive)
        } else {
            list_item_directive
        };

        if let Some((kind, title)) = directive {
            // 从下一行开始找收尾行。
            let body_start = if line_end < markdown.len() {
                line_end + 1
            } else {
                markdown.len()
            };
            // 空容器（开标签行后**立即**是收尾行）不构成 directive：
            // TS 的正则 `[\r\n]+([\s\S]*?)[\r\n]+:::` 要求 body 前后各有一个换行，
            // 空 body 无法同时满足，因此 `:::note\n:::` 在 TS 侧只是普通段落文本。
            let body_is_empty = markdown[body_start..]
                .lines()
                .next()
                .map(|line| line.trim_end_matches('\r') == ":::")
                .unwrap_or(false);
            if body_is_empty {
                at_block_boundary = false;
                if line_end >= markdown.len() {
                    break;
                }
                index = line_end + 1;
                continue;
            }

            if let Some((body_end, after_close)) =
                find_closing_with(markdown, body_start, is_list_item)
            {
                if plain_start < index {
                    segments.push(Segment::Markdown(&markdown[plain_start..index]));
                }
                let raw_body = strip_trailing_newline(&markdown[body_start..body_end]);
                // 列表项内的正文带有列表缩进，需按公共缩进去除（与 marked 的
                // 列表内容去缩进语义一致），否则内部 Markdown 会被当作缩进代码块。
                let body = if is_list_item {
                    dedent(raw_body)
                } else {
                    raw_body.to_string()
                };
                segments.push(Segment::Directive {
                    kind,
                    title,
                    body,
                    in_list_item: is_list_item,
                });
                plain_start = after_close;
                index = after_close;
                at_block_boundary = true;
                continue;
            }
            // 未闭合：不是 directive，按普通文本继续。
        }

        // 定义副本与分隔注释不构成「内容块」，其后仍算块边界。
        at_block_boundary = stripped.trim().is_empty()
            || stripped.starts_with("<!--md-def")
            || stripped.starts_with("[") && stripped.contains("]:") && !stripped.starts_with("[^");
        if line_end >= markdown.len() {
            break;
        }
        index = line_end + 1;
    }

    if plain_start < markdown.len() {
        segments.push(Segment::Markdown(&markdown[plain_start..]));
    }

    segments
}

/// 去掉结尾的一个换行序列。
///
/// JS 的正则是 `[\r\n]+([\s\S]*?)[\r\n]+:::`，body 捕获组不含收尾行前的换行。
fn strip_trailing_newline(text: &str) -> &str {
    text.strip_suffix("\r\n")
        .or_else(|| text.strip_suffix('\n'))
        .unwrap_or(text)
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

    // 类型之后只能是结束，或「至少一个空格/制表符 + 标题」。
    if after_kind.is_empty() {
        return Some((kind.to_lowercase(), String::new()));
    }
    if !after_kind.starts_with(' ') && !after_kind.starts_with('\t') {
        return None;
    }
    let title = after_kind.trim();
    if title.is_empty() {
        return None;
    }
    Some((kind.to_lowercase(), title.to_string()))
}

/// 从 `start` 起寻找恰好为 `:::` 的收尾行。
///
/// 返回（正文结束偏移, 收尾行之后的首个偏移）。
/// 同 [`find_closing`]，但 `allow_indent` 为真时允许缩进的收尾行（列表项内）。
fn find_closing_with(markdown: &str, start: usize, allow_indent: bool) -> Option<(usize, usize)> {
    let mut index = start;
    while index <= markdown.len() {
        let line_end = markdown[index..]
            .find('\n')
            .map(|offset| index + offset)
            .unwrap_or(markdown.len());
        let line = &markdown[index..line_end];
        let stripped = line.strip_suffix('\r').unwrap_or(line);
        let candidate = if allow_indent {
            stripped.trim()
        } else {
            stripped
        };
        if candidate == ":::" {
            let after = if line_end < markdown.len() {
                line_end + 1
            } else {
                markdown.len()
            };
            return Some((index, after));
        }
        if line_end >= markdown.len() {
            return None;
        }
        index = line_end + 1;
    }
    None
}

/// 若该行是「列表标记 + `:::type`」，返回 `:::` 起的部分。
///
/// 只处理列表标记与 `:::` 在**同一行**的情形（`- :::note`），
/// 缩进的续行 directive（`  :::note`）在 TS 侧是字面量，不在此列。
fn list_item_prefix(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
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
    let candidate = after_marker.trim_start();
    candidate.starts_with(":::").then_some(candidate)
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
    fn directive_requires_block_boundary() {
        // 段落中间出现的 `:::` 不是 directive
        let segments = split_directives("正文段落\n:::tip\n不是容器\n:::\n");
        assert!(matches!(segments[0], Segment::Markdown(_)));
    }

    #[test]
    fn keeps_surrounding_markdown() {
        let segments = split_directives("# 前\n\n:::note\n内容\n:::\n\n# 后\n");
        assert_eq!(segments.len(), 3);
        assert!(matches!(segments[0], Segment::Markdown(_)));
        assert!(matches!(segments[1], Segment::Directive { .. }));
        assert!(matches!(segments[2], Segment::Markdown(_)));
    }
}
