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

#[gpui_kit::test]
fn tab_outside_a_table_keeps_text_input_behavior(cx: &mut TestAppContext) {
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
        view.read_with(&*vcx, |v, _| v.markdown().to_owned()),
        "or\tdinary paragraph"
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
