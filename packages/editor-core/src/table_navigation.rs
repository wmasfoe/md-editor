//! Source-aware table cell navigation for editor hosts.
use crate::{BlockKind, MarkdownDocument, SourceBlock, SourceEdit};
use std::ops::Range;

/// The next cell selection or a row insertion at the end of a body row.
#[derive(Debug, PartialEq, Eq)]
pub enum TableNavigation {
    Select(Range<usize>),
    AppendRow {
        offset: usize,
        text: String,
        caret: usize,
    },
}

/// Whether the source could contain a GFM table at all.
///
/// A table's rows are pipe-delimited, so a source with no `|` cannot hold one.
/// This exists because the Enter and arrow paths each parsed the whole document
/// to discover there was no table: measured at 8.4 ms per keystroke on a
/// 1,000-block document and 18.6 ms at 2,000. Returning early keeps a keypress
/// cheap in the common case of a document with no tables.
///
/// It is deliberately conservative: an escaped `\|` still passes, and the
/// parser then decides. Only the conclusive "no pipe, no table" case skips it.
fn could_contain_a_table(source: &str) -> bool {
    source.contains('|')
}

/// Find the selected cell and navigate in row-major order. Returns `None`
/// outside a cell, so hosts can leave their ordinary Tab behavior untouched.
pub fn navigate_table(
    source: &str,
    selection: Range<usize>,
    backward: bool,
) -> Option<TableNavigation> {
    if !could_contain_a_table(source) {
        return None;
    }
    let blocks = MarkdownDocument::new(source).blocks().ok()?;
    navigate_table_in_blocks(source, &blocks, selection, backward)
}

/// Navigates using an already parsed block tree.
pub fn navigate_table_in_blocks(
    source: &str,
    blocks: &[SourceBlock],
    selection: Range<usize>,
    backward: bool,
) -> Option<TableNavigation> {
    fn find(blocks: &[SourceBlock], selection: &Range<usize>) -> Option<(SourceBlock, usize)> {
        for block in blocks {
            if block.kind == BlockKind::Table {
                let cells: Vec<_> = block
                    .children
                    .iter()
                    .flat_map(|row| &row.children)
                    .collect();
                if let Some(index) = cells.iter().position(|cell| {
                    selection.start >= cell.range.start && selection.end <= cell.range.end
                }) {
                    return Some((block.clone(), index));
                }
            }
            if let Some(found) = find(&block.children, selection) {
                return Some(found);
            }
        }
        None
    }
    let (table, index) = find(blocks, &selection)?;
    let cells: Vec<_> = table
        .children
        .iter()
        .flat_map(|row| &row.children)
        .collect();
    let next = if backward {
        index.saturating_sub(1)
    } else {
        (index + 1).min(cells.len() - 1)
    };
    if !backward && index + 1 == cells.len() && table.children.len() > 1 {
        let last = table.children.last()?;
        let columns = table.children.first()?.children.len();
        let leading = source
            .get(last.range.clone())?
            .trim_start()
            .starts_with('|');
        let row = if leading {
            format!("| {} |", vec![" "; columns].join(" | "))
        } else {
            vec![" "; columns].join(" | ")
        };
        // Retain the enclosing quote/list prefix and the document's line ending.
        let line_start = source[..last.range.start].rfind('\n').map_or(0, |i| i + 1);
        let prefix = &source[line_start..last.range.start];
        let ending = if source[last.range.end..].starts_with("\r\n")
            || (line_start >= 2 && &source[line_start - 2..line_start] == "\r\n")
        {
            "\r\n"
        } else {
            "\n"
        };
        let text = format!("{ending}{prefix}{row}");
        let caret = last.range.end + ending.len() + prefix.len() + 2 * usize::from(leading);
        return Some(TableNavigation::AppendRow {
            offset: last.range.end,
            text,
            caret,
        });
    }
    Some(TableNavigation::Select(cells[next].content_range.clone()))
}

/// Generates an empty GFM table with `cols` columns and `rows` body rows.
pub fn generate_empty_table(cols: usize, rows: usize) -> String {
    let cols = cols.max(1);
    let rows = rows.max(1);
    let mut out = String::new();

    let headers: Vec<String> = (1..=cols).map(|i| format!("Header {i}")).collect();
    out.push_str(&format!("| {} |\n", headers.join(" | ")));

    let delims: Vec<&str> = vec!["---"; cols];
    out.push_str(&format!("| {} |\n", delims.join(" | ")));

    for _ in 0..rows {
        let cells: Vec<&str> = vec![" "; cols];
        out.push_str(&format!("| {} |\n", cells.join(" | ")));
    }
    out
}

/// If cursor is inside a table on an empty cell, exits the table with an empty paragraph line below it.
pub fn exit_table(source: &str, caret: usize) -> Option<SourceEdit> {
    if !could_contain_a_table(source) {
        return None;
    }
    let blocks = MarkdownDocument::new(source).blocks().ok()?;
    fn find_table_and_cell(
        blocks: &[SourceBlock],
        caret: usize,
    ) -> Option<(SourceBlock, SourceBlock)> {
        for b in blocks {
            if b.kind == BlockKind::Table && b.range.contains(&caret) {
                for row in &b.children {
                    for cell in &row.children {
                        if cell.range.contains(&caret) {
                            return Some((b.clone(), cell.clone()));
                        }
                    }
                }
                return Some((b.clone(), b.children.last()?.children.last()?.clone()));
            }
            if let Some(found) = find_table_and_cell(&b.children, caret) {
                return Some(found);
            }
        }
        None
    }
    let (table, cell) = find_table_and_cell(&blocks, caret)?;
    let content = source.get(cell.content_range)?;
    if !content.trim().is_empty() {
        return None;
    }
    let insert_at = table.range.end;
    let rest = &source[insert_at..];
    let (replacement, cursor_offset) = if rest.starts_with("\n\n") {
        ("\n\n".to_string(), insert_at + 1)
    } else {
        ("\n\n".to_string(), insert_at + 2)
    };
    Some(SourceEdit {
        range: insert_at..insert_at,
        replacement,
        selection_after: cursor_offset..cursor_offset,
    })
}

/// The paragraph break a caret at the end of a document-final table needs.
///
/// A document may end with a table and no trailing newline. A click in the
/// whitespace below that table resolves to the EOF byte offset, which is still
/// *inside* the table's source range, so typing there appends to the last cell:
/// the audit's repro turned `| c | d |` into `| c | d |继续`.
///
/// The historical contract (wysiwyg_virtual_trailing_line_spec) is that input
/// below the block forms its own paragraph. This returns the break that has to
/// exist before that input, or `None` when the caret is not at the end of a
/// final table.
///
pub fn trailing_paragraph_break(source: &str, caret: usize) -> Option<SourceEdit> {
    // Only the document end is in question: a caret in the middle of a table is
    // ordinary cell editing.
    if caret != source.len() {
        return None;
    }
    if !could_contain_a_table(source) {
        return None;
    }
    let blocks = MarkdownDocument::new(source).blocks().ok()?;
    let last = blocks.last()?;
    if last.kind != BlockKind::Table || last.range.end != source.len() {
        return None;
    }
    // Two newlines make a paragraph boundary in Markdown. One would keep the
    // text attached to the table's last row.
    let break_start = source.len();
    let caret_after = break_start + 2;
    Some(SourceEdit {
        range: break_start..break_start,
        replacement: "\n\n".to_owned(),
        selection_after: caret_after..caret_after,
    })
}

/// Navigates vertically (down or up) within a table, or appends a row if pressing down on the last row.
pub fn navigate_table_vertical(source: &str, caret: usize, down: bool) -> Option<TableNavigation> {
    if !could_contain_a_table(source) {
        return None;
    }
    let blocks = MarkdownDocument::new(source).blocks().ok()?;
    fn find(blocks: &[SourceBlock], caret: usize) -> Option<(SourceBlock, usize, usize)> {
        for block in blocks {
            if block.kind == BlockKind::Table && block.range.contains(&caret) {
                for (row_idx, row) in block.children.iter().enumerate() {
                    for (col_idx, cell) in row.children.iter().enumerate() {
                        if cell.range.contains(&caret) {
                            return Some((block.clone(), row_idx, col_idx));
                        }
                    }
                }
                return Some((block.clone(), 0, 0));
            }
            if let Some(found) = find(&block.children, caret) {
                return Some(found);
            }
        }
        None
    }
    let (table, row_idx, col_idx) = find(&blocks, caret)?;
    let row_count = table.children.len();
    if down {
        if row_idx + 1 < row_count {
            let target_cell = table.children[row_idx + 1]
                .children
                .get(col_idx)
                .or_else(|| table.children[row_idx + 1].children.last())?;
            Some(TableNavigation::Select(target_cell.content_range.clone()))
        } else {
            // Last row: append row!
            let last = table.children.last()?;
            let columns = table.children.first()?.children.len();
            let leading = source
                .get(last.range.clone())?
                .trim_start()
                .starts_with('|');
            let row = if leading {
                format!("| {} |", vec![" "; columns].join(" | "))
            } else {
                vec![" "; columns].join(" | ")
            };
            let line_start = source[..last.range.start].rfind('\n').map_or(0, |i| i + 1);
            let prefix = &source[line_start..last.range.start];
            let ending = if source[last.range.end..].starts_with("\r\n")
                || (line_start >= 2 && &source[line_start - 2..line_start] == "\r\n")
            {
                "\r\n"
            } else {
                "\n"
            };
            let text = format!("{ending}{prefix}{row}");
            let col_offset = 2 * usize::from(leading) + col_idx * 4;
            let target_caret = last.range.end + ending.len() + prefix.len() + col_offset;
            Some(TableNavigation::AppendRow {
                offset: last.range.end,
                text,
                caret: target_caret,
            })
        }
    } else if row_idx > 0 {
        let target_cell = table.children[row_idx - 1]
            .children
            .get(col_idx)
            .or_else(|| table.children[row_idx - 1].children.last())?;
        Some(TableNavigation::Select(target_cell.content_range.clone()))
    } else {
        None
    }
}

/// Inserts `<br>` inside a table cell when Shift-Enter is pressed.
pub fn soft_break_in_table(source: &str, caret: usize) -> Option<SourceEdit> {
    if !could_contain_a_table(source) {
        return None;
    }
    let blocks = MarkdownDocument::new(source).blocks().ok()?;
    fn in_table(blocks: &[SourceBlock], caret: usize) -> bool {
        for b in blocks {
            if b.kind == BlockKind::Table && b.range.contains(&caret) {
                return true;
            }
            if in_table(&b.children, caret) {
                return true;
            }
        }
        false
    }
    if !in_table(&blocks, caret) {
        return None;
    }
    Some(SourceEdit {
        range: caret..caret,
        replacement: "<br>".to_string(),
        selection_after: caret + 4..caret + 4,
    })
}
