use gpui_kit::TestAppContext;
use inkpoint_editor_gpui::TypesetView;

#[gpui_kit::test]
fn tab_navigates_cells_and_adds_a_row_without_touching_other_input(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let source = "| 中文 | a\\|b |\n| --- | --- |\n| one | two |\n";
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.focus(window, cx);
            view.set_caret(source.find("中文").unwrap(), cx);
        })
    });
    for _ in 0..3 {
        vcx.update(|window, cx| window.draw(cx).clear(cx));
        vcx.run_until_parked();
    }
    vcx.simulate_keystrokes("tab");
    assert_eq!(
        view.read_with(&*vcx, |v, _| v.selected_range()),
        source.find("a\\|b").unwrap()..source.find("a\\|b").unwrap() + 4
    );
    vcx.simulate_keystrokes("shift-tab");
    assert_eq!(
        view.read_with(&*vcx, |v, _| v.selected_range()),
        source.find("中文").unwrap()..source.find("中文").unwrap() + 6
    );
    vcx.update(|_, cx| view.update(cx, |v, cx| v.set_caret(source.find("two").unwrap(), cx)));
    vcx.update(|window, cx| window.draw(cx).clear(cx));
    vcx.run_until_parked();
    vcx.simulate_keystrokes("tab");
    assert_eq!(
        view.read_with(&*vcx, |v, _| v.markdown().to_owned()),
        format!("{}|   |   |\n", source)
    );
}

#[gpui_kit::test]
fn readonly_last_cell_does_not_append(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let source = "| a | b |\n| - | - |\n| c | d |";
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.focus(window, cx);
            view.set_readonly(true, cx);
            view.set_caret(source.rfind('d').unwrap(), cx);
        })
    });
    for _ in 0..3 {
        vcx.update(|window, cx| window.draw(cx).clear(cx));
        vcx.run_until_parked();
    }
    vcx.simulate_keystrokes("tab");
    assert_eq!(
        view.read_with(&*vcx, |v, _| v.markdown().to_owned()),
        source
    );
}

#[gpui_kit::test]
fn tab_during_composition_keeps_selection_and_preedit(cx: &mut TestAppContext) {
    use gpui_kit::EntityInputHandler;
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let source = "| a | b |\n| - | - |\n| c | d |";
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.focus(window, cx);
            view.set_caret(source.find('a').unwrap(), cx);
            view.replace_and_mark_text_in_range(None, "中", None, window, cx);
        })
    });
    for _ in 0..3 {
        vcx.update(|window, cx| window.draw(cx).clear(cx));
        vcx.run_until_parked();
    }
    let before = view.read_with(&*vcx, |v, _| (v.markdown().to_owned(), v.selected_range()));
    vcx.simulate_keystrokes("tab");
    assert_eq!(
        view.read_with(&*vcx, |v, _| (v.markdown().to_owned(), v.selected_range())),
        before
    );
    assert!(view.read_with(&*vcx, |v, _| v.composing()));
}

/// Tab on a plain prose line indents the line by two spaces.
///
/// This test used to assert `or\tdinary paragraph`: a literal tab inserted at
/// the caret. The interaction audit lists that as the defect — the historical
/// contract is a two-space *line* indent with the caret kept on the same text
/// (spec: TAB-01, editor_interaction_tab_and_links_spec 契约一). The old
/// assertion locked the bug in, so it is replaced rather than kept alongside.
#[gpui_kit::test]
fn tab_on_plain_prose_indents_the_line(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let source = "ordinary paragraph";
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.focus(window, cx);
            view.set_caret(2, cx);
        })
    });
    for _ in 0..3 {
        vcx.update(|window, cx| window.draw(cx).clear(cx));
        vcx.run_until_parked();
    }
    vcx.simulate_keystrokes("tab");
    assert_eq!(
        view.read_with(&*vcx, |v, _| (v.markdown().to_owned(), v.selected_range())),
        (format!("  {source}"), 4..4),
        "Tab must indent the line by two spaces and keep the caret on the same text"
    );

    // Shift+Tab reverses exactly the same operation.
    vcx.simulate_keystrokes("shift-tab");
    assert_eq!(
        view.read_with(&*vcx, |v, _| (v.markdown().to_owned(), v.selected_range())),
        (source.to_owned(), 2..2),
        "Shift+Tab must remove the two-space indent and restore the caret"
    );
}

#[gpui_kit::test]
fn tab_on_selection_indents_selected_lines(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let source = "line one\nline two\nline three";
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.focus(window, cx);
            // Select across line one and line two
            view.set_selected_range(0..15, cx);
        })
    });
    for _ in 0..3 {
        vcx.update(|window, cx| window.draw(cx).clear(cx));
        vcx.run_until_parked();
    }
    vcx.simulate_keystrokes("tab");
    assert_eq!(
        view.read_with(&*vcx, |v, _| v.markdown().to_owned()),
        "  line one\n  line two\nline three"
    );
}

#[gpui_kit::test]
fn arrows_on_selection_collapse_to_boundaries(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let source = "hello world";
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.focus(window, cx);
            view.set_selected_range(2..7, cx);
        })
    });
    for _ in 0..3 {
        vcx.update(|window, cx| window.draw(cx).clear(cx));
        vcx.run_until_parked();
    }
    // Left arrow should collapse to selection start (index 2)
    vcx.simulate_keystrokes("left");
    assert_eq!(view.read_with(&*vcx, |v, _| v.selected_range()), 2..2);

    // Re-select 2..7 and press right arrow -> should collapse to selection end (index 7)
    vcx.update(|_, cx| {
        view.update(cx, |view, cx| {
            view.set_selected_range(2..7, cx);
        })
    });
    vcx.update(|window, cx| window.draw(cx).clear(cx));
    vcx.run_until_parked();

    vcx.simulate_keystrokes("right");
    assert_eq!(view.read_with(&*vcx, |v, _| v.selected_range()), 7..7);
}

/// TABLE-NAV-02: Shift+Enter inside a table cell makes a soft line break
/// inside that cell, not a new row and not a broken table.
///
/// The existing Shift+Enter test uses a plain paragraph. A table cell is the
/// case that can go wrong: the break has to stay inside the cell, and the row
/// must still parse as one row with the same number of cells.
#[gpui_kit::test]
fn shift_enter_inside_a_table_cell_keeps_the_break_in_the_cell(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let source = "| 列一 | 列二 |\n| --- | --- |\n| ab | cd |\n";
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    let caret = source.find("ab").expect("the first body cell") + "a".len();
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.focus(window, cx);
            view.set_caret(caret, cx);
        })
    });
    for _ in 0..3 {
        vcx.update(|window, cx| window.draw(cx).clear(cx));
        vcx.run_until_parked();
    }

    vcx.simulate_keystrokes("shift-enter");
    let after = view.read_with(&*vcx, |view, _| view.markdown().to_owned());

    // A GFM table row is a single line, so a soft break inside a cell has to be
    // written as `<br>`. A real newline would end the row and split the table.
    assert_eq!(
        after, "| 列一 | 列二 |\n| --- | --- |\n| a<br>b | cd |\n",
        "the break is a <br> inside the cell"
    );
    // The table is unchanged in shape: three lines, one body row, two columns.
    assert_eq!(after.lines().count(), 3, "still three source lines");
    let body = after.lines().nth(2).expect("the body row");
    assert_eq!(
        body.matches('|').count(),
        3,
        "the row still has two cells: {body:?}"
    );
    // The caret sits right after the four-character `<br>`, so the next
    // keystroke continues the cell's text.
    let after_break = caret + "<br>".len();
    assert_eq!(
        view.read_with(&*vcx, |view, _| view.selected_range()),
        after_break..after_break,
        "the caret sits after the inserted break"
    );
}
