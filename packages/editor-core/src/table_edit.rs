//! Table structure commands: row and column insert/delete, and alignment.
//!
//! These live in the core because they are document semantics, not UI. A row
//! handle, a column handle and an alignment menu are three ways of asking for
//! the same source transformation, and every entry point must produce the same
//! bytes, the same selection and the same undo record. Implementing them in the
//! GPUI layer would mean the next entry point re-implements them.
//!
//! Two different editing strategies are used deliberately:
//!
//! * **Insert** rebuilds the affected lines from their trimmed cell text. The
//!   historical contract only requires that structure and order are right, and
//!   rebuilding is the only way to pad a ragged row consistently.
//! * **Delete** is byte-surgical: it removes exactly the target cell and its
//!   delimiter. `TABLE-COL-01` requires the other bytes, pipes and spacing to
//!   survive, and a rebuild would normalise them.
//!
//! Every command returns `None` rather than a half-applied edit when the
//! request is not representable, so a caller can report "not available" and the
//! source stays byte-identical. That is the `TABLE-GUARD-01` contract.

use std::ops::Range;

use crate::{BlockKind, MarkdownDocument, SourceBlock, SourceEdit};

/// Column alignment, matching the GFM delimiter markers.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TableAlignment {
    Default,
    Left,
    Center,
    Right,
}

impl TableAlignment {
    /// The delimiter cell text for this alignment.
    fn marker(self) -> &'static str {
        match self {
            Self::Default => "---",
            Self::Left => ":---",
            Self::Center => ":---:",
            Self::Right => "---:",
        }
    }
}

/// One source line of a table and its cell slots.
///
/// A slot is the raw byte range between two delimiters, padding included. That
/// is what a surgical delete needs; inserts trim it first.
struct RowLayout {
    line: Range<usize>,
    cells: Vec<Range<usize>>,
}

impl RowLayout {
    /// Cell index whose slot contains `caret`, if any.
    fn cell_at(&self, caret: usize) -> Option<usize> {
        self.cells
            .iter()
            .position(|cell| cell.start <= caret && caret <= cell.end)
    }
}

/// A table's source structure: header line, delimiter line, body lines.
struct TableLayout {
    /// `rows[0]` is the header, `rows[1]` the delimiter, `rows[2..]` the body.
    rows: Vec<RowLayout>,
    leading_pipe: bool,
}

impl TableLayout {
    fn columns(&self) -> usize {
        self.rows.first().map_or(0, |row| row.cells.len())
    }

    /// Index of the row containing `caret`.
    fn row_at(&self, caret: usize) -> Option<usize> {
        self.rows
            .iter()
            .position(|row| row.line.start <= caret && caret <= row.line.end)
    }
}

/// Builds the layout of the table containing `caret`.
fn layout_at(source: &str, caret: usize) -> Option<TableLayout> {
    let table = table_at(source, caret)?;
    layout_of(source, &table)
}

fn table_at(source: &str, caret: usize) -> Option<SourceBlock> {
    fn find(blocks: &[SourceBlock], caret: usize) -> Option<SourceBlock> {
        for block in blocks {
            if block.kind == BlockKind::Table && block.range.contains(&caret) {
                return Some(block.clone());
            }
            if let Some(found) = find(&block.children, caret) {
                return Some(found);
            }
        }
        None
    }
    find(&MarkdownDocument::new(source).blocks().ok()?, caret)
}

fn layout_of(source: &str, table: &SourceBlock) -> Option<TableLayout> {
    let mut rows = Vec::new();
    let mut line_start = table.range.start;
    for line in source.get(table.range.clone())?.split_inclusive('\n') {
        let content_end = line.trim_end_matches('\n').len();
        let line_range = line_start..line_start + content_end;
        rows.push(RowLayout {
            cells: cell_slots(source, line_range.clone())?,
            line: line_range,
        });
        line_start += line.len();
    }
    if rows.len() < 2 {
        return None;
    }
    let leading_pipe = source
        .get(rows[0].line.clone())?
        .trim_start()
        .starts_with('|');
    Some(TableLayout { rows, leading_pipe })
}

/// Raw cell slots of one row line: the bytes between consecutive delimiters.
///
/// Mirrors the projection's scanner so the two agree on where a cell ends: an
/// escaped pipe and a pipe inside an inline code span are content, not
/// structure.
fn cell_slots(source: &str, line: Range<usize>) -> Option<Vec<Range<usize>>> {
    let text = source.get(line.clone())?;
    let pipes = pipe_offsets(text);
    let mut slots = Vec::new();
    let mut start = 0usize;
    for (index, pipe) in pipes.iter().copied().enumerate() {
        if index == 0 && pipe == 0 {
            start = 1;
            continue;
        }
        slots.push(line.start + start..line.start + pipe);
        start = pipe + 1;
    }
    if pipes.last().is_none_or(|pipe| pipe + 1 != text.len()) {
        slots.push(line.start + start..line.end);
    }
    Some(slots)
}

/// Offsets of unescaped pipes outside inline code spans.
fn pipe_offsets(text: &str) -> Vec<usize> {
    let bytes = text.as_bytes();
    let mut pipes = Vec::new();
    let mut offset = 0;
    let mut code_ticks = 0;
    let mut escaped = false;
    while offset < bytes.len() {
        match bytes[offset] {
            b'\\' => {
                let start = offset;
                while bytes.get(offset) == Some(&b'\\') {
                    offset += 1;
                }
                escaped = (offset - start) % 2 == 1;
                continue;
            }
            b'|' if !escaped && code_ticks == 0 => pipes.push(offset),
            b'`' if !escaped => {
                let start = offset;
                while bytes.get(offset) == Some(&b'`') {
                    offset += 1;
                }
                let run = offset - start;
                code_ticks = if code_ticks == run {
                    0
                } else if code_ticks == 0 {
                    run
                } else {
                    code_ticks
                };
                escaped = false;
                continue;
            }
            _ => {}
        }
        if bytes[offset] != b'\\' {
            escaped = false;
        }
        offset += 1;
    }
    pipes
}

/// Trims surrounding padding from a cell slot.
fn trimmed<'a>(source: &'a str, slot: &Range<usize>) -> &'a str {
    source.get(slot.clone()).unwrap_or_default().trim()
}

/// Serialises one row line from its cell texts.
fn serialize(cells: &[&str], leading_pipe: bool) -> String {
    let body = cells.join(" | ");
    if leading_pipe {
        format!("| {body} |")
    } else {
        body
    }
}

/// Cell texts of `row`, padded with empty cells up to `columns`.
fn padded_cells<'a>(source: &'a str, row: &RowLayout, columns: usize) -> Vec<&'a str> {
    let mut cells: Vec<&str> = row.cells.iter().map(|slot| trimmed(source, slot)).collect();
    while cells.len() < columns {
        cells.push("");
    }
    cells
}

/// A cell address inside a table, together with that table's shape.
///
/// A pointer lands on one cell; the row handle and the column handle are then
/// two questions about that same address. Reporting the shape alongside lets a
/// caller hide a handle whose edit would be unrepresentable *before* the user
/// clicks it, instead of letting the click fail afterwards.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TableCell {
    /// Byte offset of the table block that owns this cell.
    ///
    /// Two tables in one document are two independent handle groups, so a
    /// caller needs to tell their cells apart without re-parsing per cell.
    pub table_start: usize,
    /// Index into the table's source lines: 0 header, 1 delimiter, 2.. body.
    pub row: usize,
    /// Index into the row's cells.
    pub column: usize,
    /// How many source lines the table has.
    pub rows: usize,
    /// How many cells the widest row has.
    pub columns: usize,
    /// A byte offset inside this cell.
    ///
    /// The insert commands take an offset and resolve the row themselves, so a
    /// handle click has to carry one: without it the caller would have to
    /// re-derive the offset from a row and column index.
    pub offset: usize,
}

/// One cell of a table with the byte slot it occupies.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TableCellSlot {
    /// The cell's address.
    pub cell: TableCell,
    /// The cell's raw byte slot, padding included.
    pub range: Range<usize>,
}

/// Every table's cells, one group per table, in document order.
///
/// Parsing a long document is the expensive part, so this takes the blocks the
/// caller already parsed rather than parsing again: a renderer that has them
/// must not pay for the parse twice just to place handles.
pub fn table_cells_in(source: &str, blocks: &[SourceBlock]) -> Vec<Vec<TableCellSlot>> {
    let mut tables = Vec::new();
    collect_tables(blocks, &mut tables);
    tables
        .into_iter()
        .filter_map(|table| cells_of(source, &table))
        .collect()
}

fn collect_tables(blocks: &[SourceBlock], out: &mut Vec<SourceBlock>) {
    for block in blocks {
        if block.kind == BlockKind::Table {
            out.push(block.clone());
        }
        collect_tables(&block.children, out);
    }
}

fn cells_of(source: &str, table: &SourceBlock) -> Option<Vec<TableCellSlot>> {
    let layout = layout_of(source, table)?;
    let rows = layout.rows.len();
    let columns = layout.columns();
    let table_start = table.range.start;
    let mut slots = Vec::with_capacity(rows * columns);
    for (row, line) in layout.rows.iter().enumerate() {
        for (column, range) in line.cells.iter().enumerate() {
            slots.push(TableCellSlot {
                cell: TableCell {
                    table_start,
                    row,
                    column,
                    rows,
                    columns,
                    offset: range.start,
                },
                range: range.clone(),
            });
        }
    }
    Some(slots)
}

/// Inserts a body row above the row containing `caret`.
pub fn insert_row_above(source: &str, caret: usize) -> Option<SourceEdit> {
    let layout = layout_at(source, caret)?;
    let row = layout.row_at(caret)?;
    // Above the header or the delimiter there is no table content, so the only
    // meaningful position is before the first body row.
    let before_body = match row {
        0 | 1 => 2,
        index => index,
    };
    insert_body_row_at(source, &layout, before_body, true)
}

/// Inserts a body row below the row containing `caret`.
pub fn insert_row_below(source: &str, caret: usize) -> Option<SourceEdit> {
    let layout = layout_at(source, caret)?;
    let row = layout.row_at(caret)?;
    // Below the header still means the first body row: a row between the header
    // and its delimiter would not be part of the table.
    let (before_body, above) = match row {
        0 | 1 => (2, true),
        index => (index + 1, false),
    };
    insert_body_row_at(source, &layout, before_body, above)
}

/// Inserts a body row at `row_index` in the layout's row list.
///
/// `above` places the new line before that row, otherwise after it. When the row
/// is past the last body row the line is appended at the end of the table.
fn insert_body_row_at(
    source: &str,
    layout: &TableLayout,
    row_index: usize,
    above: bool,
) -> Option<SourceEdit> {
    let columns = layout.columns();
    if columns == 0 {
        return None;
    }
    // A single space is the established placeholder for an empty cell: a truly
    // empty cell is unstable across some GFM parse paths, and this matches the
    // row-append convention the editor already uses.
    let empty: Vec<&str> = vec![" "; columns];
    let row_text = serialize(&empty, layout.leading_pipe);

    let anchor = match layout.rows.get(row_index) {
        Some(row) => row,
        // Past the last body row: append after the final line.
        None => layout.rows.last()?,
    };
    let has_newline = source.get(anchor.line.end..anchor.line.end + 1) == Some("\n");
    let offset = if above {
        anchor.line.start
    } else if has_newline {
        anchor.line.end + 1
    } else {
        anchor.line.end
    };
    let text = if above || has_newline {
        format!("{row_text}\n")
    } else {
        format!("\n{row_text}")
    };
    Some(SourceEdit {
        range: offset..offset,
        replacement: text,
        selection_after: offset..offset,
    })
}

/// Deletes the body row containing `caret`.
///
/// The header and delimiter rows are structure, not content: deleting either
/// would leave something that is no longer a table, so both are refused.
pub fn delete_row(source: &str, caret: usize) -> Option<SourceEdit> {
    let layout = layout_at(source, caret)?;
    let row = layout.row_at(caret)?;
    if row < 2 {
        return None;
    }
    let line = &layout.rows[row].line;
    // Consume the line's own newline so the deletion removes a line rather than
    // leaving a blank one. The last line has none, so it stops at the line end.
    let end = if source.get(line.end..line.end + 1) == Some("\n") {
        line.end + 1
    } else {
        line.end
    };
    Some(SourceEdit {
        range: line.start..end,
        replacement: String::new(),
        selection_after: line.start..line.start,
    })
}

/// Inserts an empty column to the left of the column containing `caret`.
pub fn insert_column_left(source: &str, caret: usize) -> Option<SourceEdit> {
    let layout = layout_at(source, caret)?;
    let row = layout.row_at(caret)?;
    let column = layout.rows.get(row)?.cell_at(caret)?;
    insert_column(source, &layout, column)
}

/// Inserts an empty column to the right of the column containing `caret`.
pub fn insert_column_right(source: &str, caret: usize) -> Option<SourceEdit> {
    let layout = layout_at(source, caret)?;
    let row = layout.row_at(caret)?;
    let column = layout.rows.get(row)?.cell_at(caret)?;
    insert_column(source, &layout, column + 1)
}

/// Inserts a column at `column`, preserving every existing byte when it can.
///
/// Two strategies, chosen per row:
///
/// * **Surgical** when the row already has the full column count and uses a
///   leading pipe: one new delimiter plus the new cell is inserted at the
///   target cell's boundary, so existing padding, pipes and content keep their
///   bytes.
/// * **Rebuild** otherwise. A ragged row must gain its missing cells
///   (`TABLE-RAGGED-01`) and a row without a leading pipe has no delimiter to
///   anchor against, so both are rebuilt from trimmed cell text.
fn insert_column(source: &str, layout: &TableLayout, column: usize) -> Option<SourceEdit> {
    let columns = layout.columns();
    if columns == 0 || column > columns {
        return None;
    }
    let start = layout.rows.first()?.line.start;
    let end = layout.rows.last()?.line.end;
    let mut replacement = String::with_capacity(end - start);
    let mut cursor = start;

    for (index, row) in layout.rows.iter().enumerate() {
        // The delimiter row needs a real marker; every other row gets an empty
        // cell. The text includes the closing pipe so it reads as
        // "<new cell> | <existing cell>".
        let insert = if index == 1 { " --- |" } else { "  |" };
        let full_row = row.cells.len() == columns;
        if layout.leading_pipe && full_row {
            // Insert before the target cell, or after the final pipe when
            // appending past the last column.
            let offset = row
                .cells
                .get(column)
                .map_or(row.line.end, |slot| slot.start);
            replacement.push_str(source.get(cursor..offset)?);
            replacement.push_str(insert);
            cursor = offset;
            continue;
        }
        let mut cells = padded_cells(source, row, columns);
        let filler = if index == 1 { "---" } else { "" };
        cells.insert(column, filler);
        replacement.push_str(source.get(cursor..row.line.start)?);
        replacement.push_str(&serialize(&cells, layout.leading_pipe));
        cursor = row.line.end;
    }
    replacement.push_str(source.get(cursor..end)?);

    let caret = start + replacement.len();
    Some(SourceEdit {
        range: start..end,
        replacement,
        selection_after: caret..caret,
    })
}

/// Deletes the column containing `caret`.
///
/// A table needs at least one column, so the last one is refused. Rows that do
/// not have this cell (a legal ragged row) are left byte-identical.
pub fn delete_column(source: &str, caret: usize) -> Option<SourceEdit> {
    let layout = layout_at(source, caret)?;
    let columns = layout.columns();
    if columns <= 1 {
        return None;
    }
    let row = layout.row_at(caret)?;
    let column = layout.rows.get(row)?.cell_at(caret)?;
    if column >= columns {
        return None;
    }

    // Byte-surgical: for each row that actually has this cell, remove the cell
    // slot together with the delimiter that precedes it. Rows without the cell
    // are skipped, so their bytes stay untouched.
    let mut removals = Vec::new();
    for row in &layout.rows {
        if column >= row.cells.len() {
            continue;
        }
        let slot = &row.cells[column];
        // `slot.start - 1` is the delimiter that opens this cell: a cell slot
        // always starts immediately after a pipe, except for a first cell with
        // no leading pipe, which instead consumes the pipe that follows it.
        let start = if slot.start > row.line.start {
            slot.start - 1
        } else {
            slot.start
        };
        let end = if start == slot.start {
            slot.end + 1
        } else {
            slot.end
        };
        removals.push((start, end.min(row.line.end)));
    }
    if removals.is_empty() {
        return None;
    }

    // Build the replacement by walking the source once and skipping removals.
    let start = layout.rows.first()?.line.start;
    let end = layout.rows.last()?.line.end;
    let mut replacement = String::with_capacity(end - start);
    let mut cursor = start;
    for (remove_start, remove_end) in removals {
        replacement.push_str(source.get(cursor..remove_start)?);
        cursor = remove_end;
    }
    replacement.push_str(source.get(cursor..end)?);
    let caret_after = start + replacement.len();
    Some(SourceEdit {
        range: start..end,
        replacement,
        selection_after: caret_after..caret_after,
    })
}

/// Sets the alignment of the column containing `caret`.
///
/// Only the delimiter cell for that column changes; content rows and the other
/// delimiter cells keep their bytes.
pub fn set_column_alignment(
    source: &str,
    caret: usize,
    alignment: TableAlignment,
) -> Option<SourceEdit> {
    let layout = layout_at(source, caret)?;
    let row = layout.row_at(caret)?;
    let column = layout.rows.get(row)?.cell_at(caret)?;
    let delimiter = layout.rows.get(1)?;
    let slot = delimiter.cells.get(column)?;

    // Replace only the trimmed marker, so surrounding padding survives.
    let raw = source.get(slot.clone())?;
    let leading = raw.len() - raw.trim_start().len();
    let marker_start = slot.start + leading;
    let marker_end = marker_start + raw.trim().len();
    let marker = alignment.marker();
    let caret_after = marker_start + marker.len();
    Some(SourceEdit {
        range: marker_start..marker_end,
        replacement: marker.to_owned(),
        selection_after: caret_after..caret_after,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A legal ragged row is kept by the parser, with its missing cells absent.
    ///
    /// `TABLE-RAGGED-01` depends on this: if the parser dropped the row there
    /// would be nothing to pad and the matrix case would be unrepresentable.
    /// The AST `children` are the header plus body rows; the delimiter line is
    /// not a child, which is why a two-row table reports two entries here.
    #[test]
    fn a_ragged_row_is_parsed_as_a_table_row() {
        let source = "| a | b | c |\n| - | - | - |\n| 1 | 2 |\n";
        let table = table_at(source, 0).expect("a table");
        let counts: Vec<usize> = table
            .children
            .iter()
            .map(|row| row.children.len())
            .collect();
        assert_eq!(counts, vec![3, 2], "header plus the short body row");
    }

    /// The row layout sees the delimiter line, because inserts and alignment
    /// need to rewrite it even though the AST does not model it as a row.
    #[test]
    fn the_layout_includes_the_delimiter_row() {
        let source = "| a | b |\n| - | - |\n| 1 | 2 |\n";
        let layout = layout_at(source, 0).expect("a layout");
        assert_eq!(layout.rows.len(), 3, "header, delimiter and one body row");
        assert_eq!(layout.columns(), 2);
    }
}
