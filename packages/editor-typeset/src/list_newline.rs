//! Source-preserving list continuation, limited to parsed list item markers.
use inkpoint_editor_core::{BlockKind, MarkdownDocument, SourceBlock, SourceEdit};

#[derive(Default)]
struct ListContext {
    item: bool,
    checked: Option<bool>,
    enclosing_item: bool,
    code: bool,
}

// Inspect the parsed structure once; marker-like text inside code is not a list.
fn collect_context(blocks: &[SourceBlock], start: usize, marker: usize, result: &mut ListContext) {
    for block in blocks {
        match block.kind {
            BlockKind::ListItem { checked } if (start..=marker).contains(&block.range.start) => {
                result.item = true;
                result.checked = checked;
            }
            BlockKind::ListItem { .. }
                if block.range.start < marker && marker < block.range.end =>
            {
                result.enclosing_item = true;
            }
            BlockKind::Code { .. } if block.range.contains(&marker) => result.code = true,
            _ => {}
        }
        collect_context(&block.children, start, marker, result);
    }
}

pub(crate) fn list_newline(document: &MarkdownDocument, caret: usize) -> Option<SourceEdit> {
    let source = document.source();
    let before = source.get(..caret)?;
    let start = before.rfind('\n').map_or(0, |offset| offset + 1);
    let end = source[caret..]
        .find('\n')
        .map_or(source.len(), |offset| caret + offset);
    let line = &source[start..end];
    let indent = line
        .bytes()
        .take_while(|b| matches!(b, b' ' | b'\t'))
        .count();
    let rest = &line[indent..];
    let marker_len = if rest.starts_with(['-', '+', '*']) {
        1
    } else {
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || digits > 9 || !matches!(rest.as_bytes().get(digits), Some(b'.' | b')')) {
            return None;
        }
        digits + 1
    };
    let separator = rest[marker_len..]
        .bytes()
        .take_while(|b| matches!(b, b' ' | b'\t'))
        .count();
    let blocks = document.blocks().ok()?;
    let empty = rest[marker_len + separator..].trim().is_empty();
    let mut context = ListContext::default();
    collect_context(&blocks, start, start + indent, &mut context);
    if separator == 0
        || context.code
        || !(context.item || (indent > 0 && empty && context.enclosing_item))
    {
        return None;
    }
    let marker = &rest[..marker_len];
    let mut prefix = format!("{}{}", &line[..indent], marker);
    if marker_len > 1 {
        let number: u64 = marker[..marker_len - 1].parse().ok()?;
        prefix = format!(
            "{}{}{}",
            &line[..indent],
            number + 1,
            &marker[marker_len - 1..]
        );
    }
    prefix.push_str(&rest[marker_len..marker_len + separator]);
    let mut content = &rest[marker_len + separator..];
    if context.checked.is_some() && content.len() >= 3 {
        prefix.push_str("[ ]");
        content = &content[3..];
        let spaces = content
            .bytes()
            .take_while(|b| matches!(b, b' ' | b'\t'))
            .count();
        prefix.push_str(&content[..spaces]);
        content = &content[spaces..];
    }
    if content.trim().is_empty() {
        let range = if indent > 0 {
            start + indent.saturating_sub(2)..start + indent
        } else {
            start..end
        };
        return Some(SourceEdit {
            selection_after: if indent > 0 {
                end - (range.end - range.start)..end - (range.end - range.start)
            } else {
                start..start
            },
            range,
            replacement: String::new(),
        });
    }
    let content_start = start + indent + marker_len + separator;
    if caret < content_start {
        return None;
    }
    // The existing editor tolerates a one-character projection offset at line end.
    let at_end = source[caret..end].chars().count() <= 1 || source[caret..end].trim().is_empty();
    let at = if at_end { end } else { caret };
    let from = if at_end {
        at
    } else {
        let trimmed = source[content_start..at].trim_end_matches([' ', '\t']);
        content_start + trimmed.len()
    };
    let replacement = format!("\n{prefix}");
    let after = from + replacement.len();
    Some(SourceEdit {
        range: from..at,
        replacement,
        selection_after: after..after,
    })
}

/// Indents (forward = true) or outdents (forward = false) the list item at `caret`.
pub(crate) fn indent_list(
    document: &MarkdownDocument,
    caret: usize,
    forward: bool,
) -> Option<SourceEdit> {
    let source = document.source();
    let before = source.get(..caret)?;
    let start = before.rfind('\n').map_or(0, |offset| offset + 1);
    let end = source[caret..]
        .find('\n')
        .map_or(source.len(), |offset| caret + offset);
    let line = &source[start..end];
    let indent = line
        .bytes()
        .take_while(|b| matches!(b, b' ' | b'\t'))
        .count();
    let rest = &line[indent..];
    let marker_len = if rest.starts_with(['-', '+', '*']) {
        1
    } else {
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || digits > 9 || !matches!(rest.as_bytes().get(digits), Some(b'.' | b')')) {
            return None;
        }
        digits + 1
    };
    let separator = rest[marker_len..]
        .bytes()
        .take_while(|b| matches!(b, b' ' | b'\t'))
        .count();
    if separator == 0 {
        return None;
    }
    let blocks = document.blocks().ok()?;
    let mut context = ListContext::default();
    collect_context(&blocks, start, start + indent, &mut context);
    if context.code || !context.item {
        return None;
    }
    if forward {
        Some(SourceEdit {
            range: start..start,
            replacement: "  ".to_string(),
            selection_after: (caret + 2)..(caret + 2),
        })
    } else {
        if indent == 0 {
            return None;
        }
        let remove = indent.min(2);
        Some(SourceEdit {
            range: start..start + remove,
            replacement: String::new(),
            selection_after: (caret - remove)..(caret - remove),
        })
    }
}

/// Toggles the checkbox `[ ]` <-> `[x]` of a task item if `caret` is near the checkbox.
pub(crate) fn toggle_task_checkbox(
    document: &MarkdownDocument,
    caret: usize,
) -> Option<SourceEdit> {
    let source = document.source();
    if !source.is_char_boundary(caret) {
        return None;
    }
    let before = source.get(..caret)?;
    let start = before.rfind('\n').map_or(0, |offset| offset + 1);
    let end = source[caret..]
        .find('\n')
        .map_or(source.len(), |offset| caret + offset);
    let line = &source[start..end];
    let indent = line
        .bytes()
        .take_while(|b| matches!(b, b' ' | b'\t'))
        .count();
    let rest = &line[indent..];
    let (marker_len, is_checked) =
        if rest.starts_with("- [ ] ") || rest.starts_with("* [ ] ") || rest.starts_with("+ [ ] ") {
            (2, false)
        } else if rest.starts_with("- [x] ")
            || rest.starts_with("- [X] ")
            || rest.starts_with("* [x] ")
            || rest.starts_with("+ [x] ")
        {
            (2, true)
        } else {
            return None;
        };
    let check_start = start + indent + marker_len;
    if caret >= check_start && caret <= check_start + 4 {
        let replacement = if is_checked { "[ ]" } else { "[x]" };
        return Some(SourceEdit {
            range: check_start..check_start + 3,
            replacement: replacement.to_string(),
            selection_after: caret..caret,
        });
    }
    None
}

/// Continues or exits a blockquote (`> `) on Enter.
pub(crate) fn blockquote_newline(document: &MarkdownDocument, caret: usize) -> Option<SourceEdit> {
    let source = document.source();
    let before = source.get(..caret)?;
    let start = before.rfind('\n').map_or(0, |offset| offset + 1);
    let end = source[caret..]
        .find('\n')
        .map_or(source.len(), |offset| caret + offset);
    let line = &source[start..end];
    let indent = line
        .bytes()
        .take_while(|b| matches!(b, b' ' | b'\t'))
        .count();
    let rest = &line[indent..];
    if !rest.starts_with('>') {
        return None;
    }
    let blocks = document.blocks().ok()?;
    let mut in_code = false;
    for block in &blocks {
        if matches!(block.kind, BlockKind::Code { .. }) && block.range.contains(&caret) {
            in_code = true;
            break;
        }
    }
    if in_code {
        return None;
    }

    let mut quote_prefix_len = 0;
    let bytes = rest.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'>' {
            i += 1;
            while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
                i += 1;
            }
            quote_prefix_len = i;
        } else {
            break;
        }
    }
    if quote_prefix_len == 0 {
        return None;
    }

    let content = &rest[quote_prefix_len..];
    let prefix = format!("{}{}", &line[..indent], &rest[..quote_prefix_len]);

    // If the line is empty (only > and spaces), pressing Enter exits the quote
    if content.trim().is_empty() {
        return Some(SourceEdit {
            range: start..end,
            replacement: String::new(),
            selection_after: start..start,
        });
    }

    if caret < start + indent + quote_prefix_len {
        return None;
    }

    let at_end = source[caret..end].chars().count() <= 1 || source[caret..end].trim().is_empty();
    let at = if at_end { end } else { caret };
    let replacement = format!("\n{prefix}");
    let after = at + replacement.len();
    Some(SourceEdit {
        range: at..at,
        replacement,
        selection_after: after..after,
    })
}
