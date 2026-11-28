//! Table structure commands against the interaction test matrix.
//!
//! Matrix IDs: TABLE-HANDLE-01, TABLE-COL-01, TABLE-GUARD-01, TABLE-RAGGED-01,
//! TABLE-ALIGN-01 in
//! `.omx/plans/test-spec-gpui-beta-editor-interaction-fixes.md`.
//!
//! Every assertion checks source bytes, because render correctness is not
//! evidence of source correctness.

use inkpoint_editor_core::{
    MarkdownDocument,
    session::EditorSession,
    table_edit::{
        TableAlignment, delete_column, delete_row, insert_column_left, insert_column_right,
        insert_row_above, insert_row_below, set_column_alignment,
    },
};

const TABLE: &str = "| left | right |\n| ---- | ----- |\n| x    | y     |\n";

/// Applies an edit through the session so undo and selection are exercised.
fn apply(source: &str, edit: Option<inkpoint_editor_core::SourceEdit>) -> EditorSession {
    let mut session = EditorSession::new(source);
    session
        .apply_edit(edit.expect("the command produced an edit"))
        .expect("the edit applies");
    session
}

fn caret(source: &str, needle: &str) -> usize {
    source.find(needle).unwrap()
}

/// TABLE-HANDLE-01: inserting a row above the first body row keeps header and
/// delimiter adjacent, and the result is still one table with the right order.
#[test]
fn table_handle01_insert_row_above_keeps_header_and_delimiter_adjacent() {
    let mut session = apply(TABLE, insert_row_above(TABLE, caret(TABLE, "x    ")));
    let result = session.source();

    assert_eq!(
        result, "| left | right |\n| ---- | ----- |\n|   |   |\n| x    | y     |\n",
        "the new row goes between the delimiter and the first body row"
    );
    assert!(session.undo());
    assert_eq!(session.source(), TABLE, "one undo restores the bytes");
}

/// TABLE-HANDLE-01: inserting below a body row adds it after that row.
#[test]
fn table_handle01_insert_row_below_a_body_row_adds_it_after() {
    let session = apply(TABLE, insert_row_below(TABLE, caret(TABLE, "y     ")));
    let result = session.source();

    assert!(
        result.starts_with("| left | right |\n| ---- | ----- |\n| x    | y     |\n|   |   |"),
        "the new row follows the last body row: {result:?}"
    );
}

/// TABLE-HANDLE-01: a row can be inserted above a body row that is not first.
#[test]
fn table_handle01_insert_row_above_a_middle_body_row() {
    let source = "| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n";
    let session = apply(source, insert_row_above(source, caret(source, "3 ")));
    assert_eq!(
        session.source(),
        "| a | b |\n| - | - |\n| 1 | 2 |\n|   |   |\n| 3 | 4 |\n"
    );
}

/// TABLE-HANDLE-01: deleting a body row removes that whole line, one undo.
#[test]
fn table_handle01_delete_a_body_row_removes_its_line() {
    let source = "| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n";
    let mut session = apply(source, delete_row(source, caret(source, "3 ")));
    assert_eq!(session.source(), "| a | b |\n| - | - |\n| 1 | 2 |\n");
    assert!(session.undo());
    assert_eq!(session.source(), source);
}

/// TABLE-HANDLE-01: a row handle on the header inserts above the body, never
/// between the header and its delimiter.
#[test]
fn table_handle01_row_insert_from_the_header_lands_before_the_first_body_row() {
    for edit in [
        insert_row_above(TABLE, caret(TABLE, "left")),
        insert_row_below(TABLE, caret(TABLE, "left")),
    ] {
        let session = apply(TABLE, edit);
        assert_eq!(
            session.source(),
            "| left | right |\n| ---- | ----- |\n|   |   |\n| x    | y     |\n"
        );
    }
}

/// TABLE-HANDLE-01: inserting a column adds an empty cell to every row and a
/// delimiter marker to the delimiter row, keeping column order.
#[test]
fn table_handle01_insert_column_left_adds_a_cell_to_every_row() {
    let mut session = apply(TABLE, insert_column_left(TABLE, caret(TABLE, "right")));
    assert_eq!(
        session.source(),
        "| left |  | right |\n| ---- | --- | ----- |\n| x    |  | y     |\n"
    );
    assert!(session.undo());
    assert_eq!(session.source(), TABLE);
}

/// TABLE-HANDLE-01: inserting to the right of the last column appends.
#[test]
fn table_handle01_insert_column_right_of_the_last_column_appends() {
    let session = apply(TABLE, insert_column_right(TABLE, caret(TABLE, "right")));
    assert_eq!(
        session.source(),
        "| left | right |  |\n| ---- | ----- | --- |\n| x    | y     |  |\n"
    );
}

/// TABLE-COL-01: deleting the rightmost column succeeds and leaves the other
/// bytes, pipes and spacing intact.
#[test]
fn table_col01_delete_the_rightmost_column_preserves_other_bytes() {
    let mut session = apply(TABLE, delete_column(TABLE, caret(TABLE, "right")));
    let result = session.source();
    assert_eq!(
        result, "| left |\n| ---- |\n| x    |\n",
        "only the target cell and its delimiter disappear"
    );
    assert!(session.undo());
    assert_eq!(session.source(), TABLE);
}

/// TABLE-COL-01: deleting a middle column keeps the surrounding cells exactly.
#[test]
fn table_col01_delete_a_middle_column_keeps_neighbour_spacing() {
    let source = "| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n";
    let session = apply(source, delete_column(source, caret(source, "b |")));
    assert_eq!(session.source(), "| a | c |\n| - | - |\n| 1 | 3 |\n");
}

/// TABLE-GUARD-01: the last column cannot be deleted, and the source is
/// byte-identical afterwards because no edit is produced at all.
#[test]
fn table_guard01_deleting_the_only_column_is_refused() {
    let source = "| only |\n| ---- |\n| x    |\n";
    assert_eq!(delete_column(source, caret(source, "only")), None);
}

/// TABLE-GUARD-01: header and delimiter rows cannot be deleted.
#[test]
fn table_guard01_deleting_header_or_delimiter_is_refused() {
    assert_eq!(delete_row(TABLE, caret(TABLE, "left")), None);
    assert_eq!(delete_row(TABLE, caret(TABLE, "----")), None);
}

/// TABLE-GUARD-01: a caret outside any table produces no edit.
#[test]
fn table_guard01_a_caret_outside_a_table_is_refused() {
    let source = "plain paragraph\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    let outside = caret(source, "plain");
    assert_eq!(delete_column(source, outside), None);
    assert_eq!(delete_row(source, outside), None);
    assert_eq!(insert_row_above(source, outside), None);
    assert_eq!(insert_column_left(source, outside), None);
    assert_eq!(
        set_column_alignment(source, outside, TableAlignment::Left),
        None
    );
}

/// TABLE-RAGGED-01: a legal ragged row gains the missing cell when a column is
/// inserted, because every row must end up with the same column count.
#[test]
fn table_ragged01_insert_column_pads_a_missing_cell() {
    let source = "| a | b | c |\n| - | - | - |\n| 1 | 2 |\n";
    let session = apply(source, insert_column_left(source, caret(source, "b |")));
    let result = session.source();
    let document = MarkdownDocument::new(result);
    let table = document
        .blocks()
        .unwrap()
        .into_iter()
        .find(|block| block.kind == inkpoint_editor_core::BlockKind::Table)
        .expect("still a table");
    let counts: Vec<usize> = table
        .children
        .iter()
        .map(|row| row.children.len())
        .collect();
    // The AST models the header and body rows; the delimiter line is not a
    // child. Each of those rows must end up with the new column count.
    assert_eq!(
        counts,
        vec![4, 4],
        "header and the padded ragged row both gain the column: {result:?}"
    );
}

/// TABLE-RAGGED-01: deleting a column a ragged row does not have leaves that
/// row byte-identical.
#[test]
fn table_ragged01_delete_column_leaves_a_row_without_that_cell_untouched() {
    let source = "| a | b | c |\n| - | - | - |\n| 1 | 2 |\n";
    let session = apply(source, delete_column(source, caret(source, "c |")));
    let result = session.source();
    assert!(
        result.contains("| 1 | 2 |"),
        "the ragged row keeps its bytes: {result:?}"
    );
    assert!(
        result.contains("| a | b |"),
        "the header loses only the third column: {result:?}"
    );
}

/// TABLE-ALIGN-01: each alignment rewrites only the delimiter marker of that
/// column; content rows and the other markers keep their bytes.
#[test]
fn table_align01_sets_each_alignment_on_only_the_target_marker() {
    for (alignment, marker) in [
        (TableAlignment::Default, "---"),
        (TableAlignment::Left, ":---"),
        (TableAlignment::Center, ":---:"),
        (TableAlignment::Right, "---:"),
    ] {
        let mut session = apply(
            TABLE,
            set_column_alignment(TABLE, caret(TABLE, "left"), alignment),
        );
        let result = session.source();
        assert_eq!(
            result,
            format!("| left | right |\n| {marker} | ----- |\n| x    | y     |\n"),
            "only the first delimiter cell changes for {alignment:?}"
        );
        assert!(session.undo());
        assert_eq!(session.source(), TABLE);
    }
}

/// TABLE-ALIGN-01: alignment on the second column leaves the first marker.
#[test]
fn table_align01_sets_alignment_on_the_second_column_only() {
    let session = apply(
        TABLE,
        set_column_alignment(TABLE, caret(TABLE, "right"), TableAlignment::Center),
    );
    assert_eq!(
        session.source(),
        "| left | right |\n| ---- | :---: |\n| x    | y     |\n"
    );
}
