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
