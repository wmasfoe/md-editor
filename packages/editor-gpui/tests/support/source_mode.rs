use gpui_kit::{TestAppContext, VisualTestContext};
use inkpoint_editor_gpui::TypesetView;

const SOURCE: &str = "**中文**\n第二行";

fn draw(vcx: &mut VisualTestContext) {
    vcx.update(|window, cx| window.draw(cx).clear(cx));
    vcx.run_until_parked();
}

#[gpui_kit::test]
fn shortcut_toggles_source_mode_without_changing_source_selection_or_history(
    cx: &mut TestAppContext,
) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, SOURCE));
    draw(vcx);
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.focus(window, cx);
            view.set_caret(3, cx);
        });
    });
    draw(vcx);
    let original_revision = view.read_with(&*vcx, |view, _| view.revision());
    let original_selection = view.read_with(&*vcx, |view, _| view.selected_range());

    vcx.simulate_keystrokes("cmd-/");
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert!(view.source_mode());
        assert_eq!(view.markdown(), SOURCE);
        assert_eq!(view.revision(), original_revision);
        assert_eq!(view.selected_range(), original_selection);
        assert!(view.caret_leaf().is_some());
    });

    vcx.simulate_keystrokes("cmd-/");
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert!(!view.source_mode());
        assert_eq!(view.markdown(), SOURCE);
        assert_eq!(view.revision(), original_revision);
        assert_eq!(view.selected_range(), original_selection);
        assert!(view.caret_leaf().is_some());
    });
}

#[gpui_kit::test]
fn mouse_mode_switch_keeps_the_caret_visible(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, SOURCE));
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret("**中文**".len(), cx)));
    draw(vcx);
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_source_mode(true, cx)));
    draw(vcx);
    assert!(view.read_with(&*vcx, |view, _| view.caret_leaf().is_some()));
}

#[gpui_kit::test]
fn source_mode_switch_preserves_the_edit_undo_history(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, "中文"));
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.focus(window, cx);
            view.set_selected_range(0.."中文".len(), cx);
        });
    });
    draw(vcx);

    vcx.simulate_keystrokes("cmd-b");
    assert_eq!(
        view.read_with(&*vcx, |view, _| view.markdown().to_owned()),
        "**中文**"
    );
    vcx.update(|_, cx| view.update(cx, |view, cx| view.toggle_source_mode(cx)));
    vcx.simulate_keystrokes("cmd-z");

    view.read_with(&*vcx, |view, _| {
        assert!(view.source_mode());
        assert_eq!(view.markdown(), "中文");
    });
}

#[gpui_kit::test]
fn source_mode_return_inserts_one_literal_line_ending(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let source = "- 项目\r\n\r\n下一段";
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.focus(window, cx);
            view.set_caret("- 项目".len(), cx);
        });
    });
    draw(vcx);
    vcx.simulate_keystrokes("cmd-/ enter");
    draw(vcx);
    vcx.simulate_input("继续");

    view.read_with(&*vcx, |view, _| {
        assert!(view.source_mode());
        assert_eq!(view.markdown(), "- 项目\r\n继续\r\n\r\n下一段");
    });
}

/// TABLE-MODE-01: a table edit survives a mode switch, structure and alignment
/// included.
///
/// The spec's case is a table, but the existing mode tests use inline
/// formatting on a paragraph. Those prove the mode switch keeps source and
/// history; they do not prove a table's cells and delimiter markers come back
/// intact, which is where a projection bug would show up.
#[gpui_kit::test]
fn table_mode01_a_table_edit_survives_a_mode_switch(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let source = "| 列一 | 列二 |\n| :--- | ---: |\n| a | b |\n";
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    vcx.update(|window, cx| view.update(cx, |view, cx| view.focus(window, cx)));
    draw(vcx);
    draw(vcx);

    // Edit inside a body cell.
    let caret = view.read_with(&*vcx, |view, _| {
        view.markdown().find("| a |").expect("the body cell") + "| ".len()
    });
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(caret, cx)));
    vcx.simulate_input("改");
    draw(vcx);

    let edited = view.read_with(&*vcx, |view, _| view.markdown().to_owned());
    assert!(
        edited.contains("| 改a |"),
        "the cell edit landed: {edited:?}"
    );

    // Switch to source mode and back.
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_source_mode(true, cx)));
    draw(vcx);
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_source_mode(false, cx)));
    draw(vcx);

    view.read_with(&*vcx, |view, _| {
        assert!(!view.source_mode(), "back in rendered mode");
        // Assert on source bytes, not on rendered output: the contract is that
        // the saved Markdown is unchanged, and that is what a user would lose.
        assert_eq!(
            view.markdown(),
            edited,
            "the source is byte-identical across the round trip"
        );

        // Structure: still one table, three rows, two columns, six cell slots.
        let pipes_per_row: Vec<usize> = view
            .markdown()
            .lines()
            .map(|line| line.matches('|').count())
            .collect();
        assert_eq!(
            pipes_per_row,
            vec![3, 3, 3],
            "three rows of two cells each: {:?}",
            view.markdown()
        );

        // Alignment: the delimiter markers are untouched.
        assert!(
            view.markdown().contains("| :--- | ---: |"),
            "left and right alignment survive the switch: {:?}",
            view.markdown()
        );
    });
}
