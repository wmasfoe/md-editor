use inkpoint_editor_core::session::EditorSession;

#[test]
fn task_toggling_uses_the_parsed_item_and_preserves_its_prefix() {
    let source = "> 2. [ ] quoted task";
    let mut editor = EditorSession::new(source);
    assert!(
        editor
            .toggle_task_checkbox(source.find("quoted").unwrap())
            .unwrap()
    );
    assert_eq!(editor.source(), "> 2. [x] quoted task");
    assert!(editor.undo());
    assert_eq!(editor.source(), source);

    let source = "~~~md\n- [ ] code sample\n~~~";
    let mut editor = EditorSession::new(source);
    assert!(
        !editor
            .toggle_task_checkbox(source.find("code").unwrap())
            .unwrap()
    );
    assert_eq!(editor.source(), source);
}

#[test]
fn continues_and_exits_list_items_as_single_undo_steps() {
    for (source, expected) in [
        ("- 甲", "- 甲\n- "),
        ("- 甲\n  - 乙", "- 甲\n  - 乙\n  - "),
        ("2. 乙", "2. 乙\n3. "),
        ("- [x] 乙", "- [x] 乙\n- [ ] "),
        ("- 甲\n- ", "- 甲\n"),
        ("- 甲\n  - ", "- 甲\n- "),
    ] {
        let mut editor = EditorSession::new(source);
        editor.set_selection(source.len(), source.len());
        editor.insert_newline().unwrap();
        assert_eq!(editor.source(), expected, "{source:?}");
        assert!(editor.undo());
        assert_eq!(editor.source(), source);
    }
}

#[test]
fn return_uses_paragraph_breaks_in_prose_and_single_breaks_in_code() {
    for (source, line_break) in [("段落", "\n\n"), ("```\n- code\n```", "\n")] {
        let mut editor = EditorSession::new(source);
        let caret = source.find("code").map_or(source.len(), |at| at + 4);
        editor.set_selection(caret, caret);
        editor.insert_newline().unwrap();
        assert_eq!(
            editor.source(),
            format!("{}{line_break}{}", &source[..caret], &source[caret..])
        );
    }
    let mut editor = EditorSession::new("- 内容");
    editor.set_selection(2, editor.source().len());
    editor.insert_newline().unwrap();
    assert_eq!(editor.source(), "- \n");
    editor.set_readonly(true);
    assert!(editor.insert_newline().is_err());
    assert!(editor.insert_source_newline().is_err());
    assert!(editor.insert_source_text("|").is_err());
    assert_eq!(editor.source(), "- \n");
}

#[test]
fn splits_list_content_and_distinguishes_task_syntax() {
    for (source, caret, expected) in [
        ("- 甲乙丙丁", "- 甲乙".len(), "- 甲乙\n- 丙丁"),
        ("- [x]xxx", "- [x]xxx".len(), "- [x]xxx\n- "),
        (
            "- 甲\n  ```\n  - code\n  ```",
            "- 甲\n  ```\n  - code".len(),
            "- 甲\n  ```\n  - code\n  \n  ```",
        ),
    ] {
        let mut editor = EditorSession::new(source);
        editor.set_selection(caret, caret);
        editor.insert_newline().unwrap();
        assert_eq!(editor.source(), expected);
    }
}

#[test]
fn nested_empty_item_can_exit_on_two_enters() {
    let mut editor = EditorSession::new("- 甲\n  - ");
    editor.set_selection(editor.source().len(), editor.source().len());
    editor.insert_newline().unwrap();
    assert_eq!(editor.source(), "- 甲\n- ");
    assert_eq!(editor.selection().head(), editor.source().len());
    editor.insert_newline().unwrap();
    assert_eq!(editor.source(), "- 甲\n");
}

#[test]
fn continues_and_exits_blockquotes() {
    let mut editor = EditorSession::new("> 引用文本");
    editor.set_selection(editor.source().len(), editor.source().len());
    editor.insert_newline().unwrap();
    assert_eq!(editor.source(), "> 引用文本\n> ");
    assert_eq!(editor.selection().head(), editor.source().len());

    // Press enter on empty quote line exits
    editor.insert_newline().unwrap();
    assert_eq!(editor.source(), "> 引用文本\n");
}
