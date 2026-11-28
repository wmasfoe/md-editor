use inkpoint_editor_core::{
    session::EditorSession,
    table_navigation::{TableNavigation, navigate_table},
};

#[test]
fn boundaries_and_multiple_tables_stay_local() {
    let source = "| a | b |\n| - | - |\n\n| 中 | d |\n| - | - |\n| e | f |";
    let first = source.find('a').unwrap();
    assert_eq!(
        navigate_table(source, first..first, true),
        Some(TableNavigation::Select(first..first + 1))
    );
    let last = source.rfind('f').unwrap();
    match navigate_table(source, last..last, false).unwrap() {
        TableNavigation::AppendRow {
            offset,
            text,
            caret,
        } => {
            assert_eq!(offset, source.len());
            assert_eq!(text, "\n|   |   |");
            assert!(caret > offset && caret < offset + text.len());
        }
        other => panic!("expected row insertion, got {other:?}"),
    }
    assert!(
        navigate_table(
            source,
            source.find("- | -").unwrap()..source.find("- | -").unwrap(),
            false
        )
        .is_none()
    );
}

#[test]
fn appended_rows_preserve_container_prefix_and_crlf() {
    let source = "> | a | b |\r\n> | - | - |\r\n> | c | d |";
    let offset = source.rfind('d').unwrap();
    match navigate_table(source, offset..offset, false).unwrap() {
        TableNavigation::AppendRow { text, .. } => assert_eq!(text, "\r\n> |   |   |"),
        other => panic!("expected row insertion, got {other:?}"),
    }
}

#[test]
fn undo_of_return_at_the_last_row_restores_the_original_cell() {
    let source = "| a | b |\n| - | - |\n| c | d |";
    let offset = source.rfind('d').unwrap();
    let mut editor = EditorSession::new(source);
    editor.set_caret(offset);
    editor.insert_newline().unwrap();
    assert_eq!(editor.source(), format!("{source}\n|   |   |"));
    assert!(editor.undo());
    assert_eq!(editor.source(), source);
    assert_eq!(editor.selection().head(), offset);
}

/// The "no pipe, no table" pre-filter must not disable any table path.
///
/// It exists so Enter and the arrow keys stop parsing the whole document to
/// discover there is no table: measured at 8.4 ms per keystroke on a
/// 1,000-block document. A filter that rejected a real table would silently
/// turn those keys into no-ops, which is worse than the cost it saves.
#[test]
fn a_table_without_outer_pipes_still_navigates() {
    // No leading or trailing pipe: the rows are still pipe-delimited, and this
    // is the shape the pre-filter has to let through.
    let source = "a | b\n--- | ---\nc | d\n";
    let first = source.find('a').expect("the first cell");
    assert_eq!(
        navigate_table(source, first..first, true),
        Some(TableNavigation::Select(first..first + 1)),
        "Tab navigation works on a table with no outer pipes"
    );

    let last = source.find('d').expect("the last cell");
    match navigate_table(source, last..last, false).expect("the last cell navigates") {
        TableNavigation::AppendRow { .. } => {}
        other => panic!("expected AppendRow from the last cell, got {other:?}"),
    }
}

/// A document with no pipe is not a table, so the table paths stay out of the
/// way and leave ordinary key behavior untouched.
#[test]
fn a_document_without_pipes_has_no_table_navigation() {
    let source = "just a paragraph\n\nand another\n";
    for caret in [0, 5, source.len()] {
        assert_eq!(navigate_table(source, caret..caret, true), None);
        assert_eq!(navigate_table(source, caret..caret, false), None);
    }
}
