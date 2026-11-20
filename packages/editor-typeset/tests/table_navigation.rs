use inkpoint_editor_typeset::{TableNavigation, navigate_table};

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
