//! Maps the text that GPUI actually shapes back to the original Markdown bytes.

use std::collections::HashMap;
use std::ops::Range;

use gpui_kit::base::text::editor_host::{BlockNode, Paragraph};

/// Restores editable rows for blank source lines between top-level blocks.
pub(super) fn retain_empty_lines(
    blocks: Vec<BlockNode>,
    ranges: Vec<Option<Range<usize>>>,
    source: &str,
) -> (Vec<BlockNode>, Vec<Option<Range<usize>>>) {
    let mut projected_blocks = Vec::with_capacity(blocks.len());
    let mut projected_ranges = Vec::with_capacity(ranges.len());
    let mut previous_end = None;
    for (block, mut range) in blocks.into_iter().zip(ranges) {
        if let Some(range) = &mut range {
            let gap = previous_end.unwrap_or(0)..range.start;
            for line in blank_line_ranges(source, gap, true) {
                projected_blocks.push(BlockNode::Paragraph(Paragraph::default()));
                projected_ranges.push(Some(line));
            }
            range.end = block_content_end(&block, range.end, source);
            previous_end = Some(range.end);
        }
        projected_blocks.push(block);
        projected_ranges.push(range);
    }
    let gap = previous_end.unwrap_or(0)..source.len();
    for line in blank_line_ranges(source, gap, false) {
        projected_blocks.push(BlockNode::Paragraph(Paragraph::default()));
        projected_ranges.push(Some(line));
    }
    (projected_blocks, projected_ranges)
}

/// List and item spans can include separator lines beyond their last child.
/// A terminal code block keeps its own contents, including any blank lines.
fn block_content_end(block: &BlockNode, end: usize, source: &str) -> usize {
    let (BlockNode::List { children, .. } | BlockNode::ListItem { children, .. }) = block else {
        return end;
    };
    let Some(child) = children.last() else {
        return end;
    };
    let Some(span) = child.span() else {
        return end;
    };
    if source
        .get(span.end..end)
        .is_some_and(|tail| tail.bytes().all(|byte| byte.is_ascii_whitespace()))
    {
        block_content_end(child, span.end, source)
    } else {
        end
    }
}

fn blank_line_ranges(
    source: &str,
    gap: Range<usize>,
    has_next: bool,
) -> impl Iterator<Item = Range<usize>> + '_ {
    let previous = source
        .as_bytes()
        .get(..gap.start)
        .and_then(|bytes| bytes.last());
    let starts_on_line = gap.start == 0
        || previous == Some(&b'\n')
        || (previous == Some(&b'\r') && source.as_bytes().get(gap.start) != Some(&b'\n'));
    let mut next = if gap.is_empty() {
        None
    } else if starts_on_line {
        Some(gap.start)
    } else {
        // Skip the rest of the preceding content line.
        let (line, ending) = source_line(&source[gap.clone()]);
        (ending > 0).then_some(gap.start + line.len() + ending)
    };
    std::iter::from_fn(move || {
        while let Some(start) = next.take() {
            let (line, ending) = source_line(&source[start..gap.end]);
            let end = start + line.len();
            next = (ending > 0).then_some(end + ending);
            // Before another block, an unfinished line belongs to that block.
            if (ending > 0 || !has_next) && line.bytes().all(|b| matches!(b, b' ' | b'\t')) {
                return Some(start..end);
            }
        }
        None
    })
}

/// Finds marker-only quote lines that the parser leaves between its child blocks.
pub(super) fn quote_blank_line_offsets(
    source: &str,
    gap: Range<usize>,
) -> impl Iterator<Item = usize> + '_ {
    let mut start = gap.start;
    std::iter::from_fn(move || {
        while start < gap.end {
            let (line, ending) = source_line(&source[start..]);
            let line_end = start + line.len();
            // The next child's marker prefix can also consist of '>' and spaces.
            // Only a complete source line can represent an empty caret row.
            if line_end > gap.end {
                break;
            }
            start = line_end + ending;
            if line.contains('>') && line.trim_matches([' ', '\t', '>']).is_empty() {
                return Some(line_end);
            }
        }
        None
    })
}

pub(super) struct RenderedLeafText {
    pub(super) text: String,
    pub(super) code: bool,
}

pub(super) fn collect_rendered_text(
    block: &BlockNode,
    next_key: &mut u64,
    output: &mut HashMap<u64, RenderedLeafText>,
) {
    use BlockNode::*;
    use gpui_kit::base::text::editor_host::Paragraph as TextParagraph;
    let paragraph_text = |paragraph: &TextParagraph| RenderedLeafText {
        text: paragraph.children().iter().map(run_display_text).collect(),
        code: false,
    };
    match block {
        Paragraph(paragraph) => {
            output.insert(*next_key, paragraph_text(paragraph));
            *next_key += 1;
        }
        Heading { children, .. } => {
            output.insert(*next_key, paragraph_text(children));
            *next_key += 1;
        }
        CodeBlock(code) => {
            output.insert(
                *next_key,
                RenderedLeafText {
                    text: code.code().to_string(),
                    code: true,
                },
            );
            *next_key += 1;
        }
        Table(table) => {
            for row in table.rows() {
                for paragraph in row {
                    output.insert(*next_key, paragraph_text(paragraph));
                    *next_key += 1;
                }
            }
        }
        Root { children, .. }
        | Blockquote { children, .. }
        | Surface { children, .. }
        | List { children, .. }
        | ListItem { children, .. } => {
            for child in children {
                collect_rendered_text(child, next_key, output);
            }
        }
        _ => {}
    }
}

fn run_display_text(run: &gpui_kit::base::text::editor_host::InlineNode) -> &str {
    if run.as_image().is_some() {
        "\u{fffc}"
    } else {
        run.text()
    }
}

/// Locates each shaped code line within its own source line. The opening
/// fence, closing fence, and indentation belong to the source but are not
/// part of the editable code text rendered inside the block.
pub(super) fn map_code_to_source(
    span: &Range<usize>,
    display: &str,
    source: &str,
) -> (Vec<usize>, Vec<usize>) {
    let raw = &source[span.clone()];
    let first = raw.trim_start_matches([' ', '\t']);
    let mut at = span.start;
    if first.starts_with("~~~") || first.starts_with("```") {
        let (line, ending) = source_line(raw);
        at += line.len() + ending;
    }
    if display.is_empty() {
        return (vec![at], vec![at]);
    }
    let mut leading = vec![at];
    let mut trailing = vec![at];
    let mut remaining = display;
    loop {
        let (line, displayed_ending) = source_line(remaining);
        let (raw_content, ending) = source_line(&source[at..span.end]);
        let line_end = at + raw_content.len();
        let start = match raw_content.strip_suffix(line) {
            Some(prefix) => at + prefix.len(),
            None => at + raw_content.find(line).unwrap_or_default(),
        };
        *leading.last_mut().unwrap() = start;
        if leading.len() == 1 {
            trailing[0] = start;
        }
        for (offset, character) in line.char_indices() {
            let start = source.floor_char_boundary((start + offset).min(line_end));
            let end = source.floor_char_boundary((start + character.len_utf8()).min(line_end));
            for _ in 1..character.len_utf8() {
                leading.push(start);
                trailing.push(start);
            }
            leading.push(end);
            trailing.push(end);
        }
        if displayed_ending == 0 {
            break;
        }
        for byte in 1..displayed_ending {
            leading.push(line_end + byte.min(ending));
            trailing.push(line_end + byte.min(ending));
        }
        at = line_end + ending;
        leading.push(at);
        trailing.push(at);
        remaining = &remaining[line.len() + displayed_ending..];
    }
    (leading, trailing)
}

pub(super) fn source_line(source: &str) -> (&str, usize) {
    let end = source.find(['\r', '\n']).unwrap_or(source.len());
    let ending = if source[end..].starts_with("\r\n") {
        2
    } else {
        usize::from(end < source.len())
    };
    (&source[..end], ending)
}

/// Maps the parser's actual display text back to UTF-8 source byte boundaries.
/// Hidden delimiters move the leading affinity across their source range;
/// decoded escapes/entities and atomic images map to their complete source run.
pub(super) fn map_display_to_source(
    span: &Range<usize>,
    display: &str,
    source: &str,
    marks: &[inkpoint_editor_core::InlineMark],
) -> (Vec<usize>, Vec<usize>) {
    let mut positions = vec![span.start];
    let mut before = vec![span.start];
    let mut source_at = span.start;
    let mut display_at = 0;
    while display_at < display.len() {
        if display[display_at..].starts_with('\u{fffc}') {
            let source_end = marks
                .iter()
                .find(|mark| {
                    mark.syntax_range.start == source_at
                        && matches!(
                            mark.kind,
                            inkpoint_editor_core::InlineMarkKind::Image { .. }
                        )
                })
                .map(|mark| mark.syntax_range.end)
                .or_else(|| (display == "\u{fffc}").then_some(span.end));
            if let Some(source_end) = source_end {
                let display_end = display_at + '\u{fffc}'.len_utf8();
                for map in [&mut positions, &mut before] {
                    append_mapped_display(
                        map,
                        display,
                        display_at..display_end,
                        source_at,
                        source_end,
                    );
                }
                source_at = source_end;
                display_at = display_end;
                continue;
            }
        }
        if marks.iter().any(|mark| {
            mark.kind != inkpoint_editor_core::InlineMarkKind::InlineMath
                && mark.syntax_range.contains(&source_at)
                && !mark.range.contains(&source_at)
        }) {
            source_at += source[source_at..].chars().next().unwrap().len_utf8();
            *positions.last_mut().unwrap() = source_at;
            continue;
        }
        let Some(source_char) = source
            .get(source_at..span.end)
            .and_then(|rest| rest.chars().next())
        else {
            break;
        };
        let Some(display_char) = display
            .get(display_at..)
            .and_then(|rest| rest.chars().next())
        else {
            break;
        };
        let literal = marks.iter().any(|mark| {
            mark.kind == inkpoint_editor_core::InlineMarkKind::Code
                && mark.range.contains(&source_at)
        });
        if source_char == '\\' && !literal {
            let escaped_at = source_at + 1;
            if source
                .get(escaped_at..span.end)
                .and_then(|rest| rest.chars().next())
                == Some(display_char)
            {
                source_at = escaped_at;
                *positions.last_mut().unwrap() = source_at;
                continue;
            }
        }
        if source_char == '&' && !literal {
            // Named references contain at most 32 ASCII alphanumerics.
            let candidate: String = source[source_at..span.end].chars().take(34).collect();
            if let Some((entity, _)) = candidate.split_once(';') {
                let entity_end = source_at + entity.len() + 1;
                if let Some(decoded) =
                    inkpoint_editor_core::decode_character_reference(&source[source_at..entity_end])
                    && display[display_at..].starts_with(&decoded)
                {
                    let display_end = display_at + decoded.len();
                    append_mapped_display(
                        &mut positions,
                        display,
                        display_at..display_end,
                        source_at,
                        entity_end,
                    );
                    append_mapped_display(
                        &mut before,
                        display,
                        display_at..display_end,
                        source_at,
                        entity_end,
                    );
                    display_at = display_end;
                    source_at = entity_end;
                    continue;
                }
            }
        }
        let normalized_whitespace = (display_char == ' '
            && matches!(source_char, '\n' | '\r' | '\t'))
            || (display_char == '\n' && source_char == '\r');
        if source_char == display_char || normalized_whitespace {
            let source_end = if source_char == '\r'
                && normalized_whitespace
                && source[source_at..span.end].starts_with("\r\n")
            {
                source_at + 2
            } else {
                source_at + source_char.len_utf8()
            };
            let display_end = display_at + display_char.len_utf8();
            append_mapped_display(
                &mut positions,
                display,
                display_at..display_end,
                source_at,
                source_end,
            );
            append_mapped_display(
                &mut before,
                display,
                display_at..display_end,
                source_at,
                source_end,
            );
            source_at = source_end;
            display_at = display_end;
        } else {
            source_at += source_char.len_utf8();
            *positions.last_mut().unwrap() = source_at;
        }
    }
    *positions.last_mut().unwrap() = span.end;
    if positions.len() < display.len() + 1 {
        positions.resize(display.len() + 1, span.end);
    }
    if before.len() < display.len() + 1 {
        before.resize(display.len() + 1, span.end);
    }
    (positions, before)
}

fn append_mapped_display(
    positions: &mut Vec<usize>,
    display: &str,
    range: Range<usize>,
    source_start: usize,
    source_end: usize,
) {
    let text = &display[range];
    for character in text.chars() {
        for _ in 1..character.len_utf8() {
            positions.push(source_start);
        }
        positions.push(source_end);
    }
}

/// Rebuilds only the active keyed text leaf with its Markdown delimiters shown.
/// Leaving the mark restores the saved block without reparsing Markdown.
pub(super) fn reveal_in_block(
    block: &BlockNode,
    target_key: u64,
    content_range: &Range<usize>,
    syntax_range: &Range<usize>,
    source: &str,
    positions: &[usize],
    next_key: &mut u64,
) -> BlockNode {
    use BlockNode::*;
    let mut children = |nodes: &[BlockNode]| {
        nodes
            .iter()
            .map(|node| {
                reveal_in_block(
                    node,
                    target_key,
                    content_range,
                    syntax_range,
                    source,
                    positions,
                    next_key,
                )
            })
            .collect()
    };
    match block {
        Paragraph(paragraph) => {
            let key = *next_key;
            *next_key += 1;
            Paragraph(if key == target_key {
                reveal_paragraph(
                    paragraph,
                    key,
                    content_range,
                    syntax_range,
                    source,
                    positions,
                )
            } else {
                paragraph.clone()
            })
        }
        Heading {
            level,
            children: paragraph,
            span,
        } => {
            let key = *next_key;
            *next_key += 1;
            Heading {
                level: *level,
                children: if key == target_key {
                    reveal_paragraph(
                        paragraph,
                        key,
                        content_range,
                        syntax_range,
                        source,
                        positions,
                    )
                } else {
                    paragraph.clone()
                }
                .with_leaf_key(key),
                span: *span,
            }
        }
        CodeBlock(code) => {
            *next_key += 1;
            CodeBlock(code.clone())
        }
        Table(table) => {
            let rows = table
                .rows()
                .map(|row| {
                    row.map(|paragraph| {
                        let key = *next_key;
                        *next_key += 1;
                        if key == target_key {
                            reveal_paragraph(
                                paragraph,
                                key,
                                content_range,
                                syntax_range,
                                source,
                                positions,
                            )
                        } else {
                            paragraph.clone()
                        }
                        .with_leaf_key(key)
                    })
                    .collect()
                })
                .collect();
            Table(gpui_kit::base::text::editor_host::Table::new(
                rows,
                table.column_aligns().to_vec(),
            ))
        }
        Root {
            children: nodes,
            span,
        } => Root {
            children: children(nodes),
            span: *span,
        },
        Blockquote {
            children: nodes,
            span,
        } => Blockquote {
            children: children(nodes),
            span: *span,
        },
        Surface {
            name,
            children: nodes,
            span,
        } => Surface {
            name: name.clone(),
            children: children(nodes),
            span: *span,
        },
        List {
            children: nodes,
            ordered,
            start,
            span,
        } => List {
            children: children(nodes),
            ordered: *ordered,
            start: *start,
            span: *span,
        },
        ListItem {
            children: nodes,
            spread,
            checked,
            task_marker,
            span,
        } => ListItem {
            children: children(nodes),
            spread: *spread,
            checked: *checked,
            task_marker: *task_marker,
            span: *span,
        },
        other => other.clone(),
    }
}

fn reveal_paragraph(
    paragraph: &gpui_kit::base::text::editor_host::Paragraph,
    key: u64,
    content_range: &Range<usize>,
    syntax_range: &Range<usize>,
    source: &str,
    positions: &[usize],
) -> gpui_kit::base::text::editor_host::Paragraph {
    let Some(syntax) = source.get(syntax_range.clone()) else {
        return paragraph.clone();
    };
    if positions.is_empty() {
        return paragraph.clone();
    }
    let start = positions
        .partition_point(|offset| *offset < content_range.start)
        .min(positions.len() - 1);
    let end = positions
        .partition_point(|offset| *offset < content_range.end)
        .min(positions.len() - 1);
    let text: String = paragraph.children().iter().map(run_display_text).collect();
    if start > end
        || end > text.len()
        || !text.is_char_boundary(start)
        || !text.is_char_boundary(end)
    {
        return paragraph.clone();
    }
    let mut projected = gpui_kit::base::text::editor_host::Paragraph::default();
    let mut replaced = false;
    let mut cursor = 0;
    for child in paragraph.children() {
        let child_start = cursor;
        let local_text = run_display_text(child);
        let child_end = child_start + local_text.len();
        cursor = child_end;
        if child_end <= start || child_start >= end {
            projected.push(child.clone());
            continue;
        }
        let local_start = start.saturating_sub(child_start);
        let local_end = end.saturating_sub(child_start).min(local_text.len());
        if local_start != 0 {
            projected.push(slice_inline_text(child, 0..local_start));
        }
        if !replaced {
            projected.push(gpui_kit::base::text::editor_host::InlineNode::new(syntax));
        }
        replaced = true;
        if local_end != local_text.len() {
            projected.push(slice_inline_text(child, local_end..local_text.len()));
        }
    }
    if replaced {
        projected.with_leaf_key(key)
    } else {
        paragraph.clone()
    }
}

fn slice_inline_text(
    run: &gpui_kit::base::text::editor_host::InlineNode,
    range: Range<usize>,
) -> gpui_kit::base::text::editor_host::InlineNode {
    let marks = run
        .mark_runs()
        .iter()
        .filter_map(|(marked, style)| {
            let start = marked.start.max(range.start);
            let end = marked.end.min(range.end);
            (start < end).then(|| (start - range.start..end - range.start, style.clone()))
        })
        .collect();
    gpui_kit::base::text::editor_host::InlineNode::new(&run_display_text(run)[range]).marks(marks)
}
