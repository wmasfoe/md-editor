use super::*;
use gpui_kit::TestAppContext;

#[gpui_kit::test]
fn only_a_click_on_the_checkbox_toggles_a_task(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let source = "- [ ] 中英文 task";
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    vcx.update(|window, cx| window.draw(cx).clear(cx));
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            let key = view.document.leaf_at(source.find('中').unwrap()).unwrap();
            let leaf = view.geometry.get(key).unwrap();
            let origin = leaf.position_for_index(0);
            let first_line = origin.y + leaf.line_height() / 2.;
            let box_center = origin.x - window.rem_size() * 0.9;
            view.place_caret_from_click(gpui_kit::point(origin.x, first_line), window, cx);
            assert_eq!(view.markdown(), source);
            view.place_caret_from_click(gpui_kit::point(box_center, first_line), window, cx);
            assert_eq!(view.markdown(), "- [x] 中英文 task");
            view.undo(cx);
            assert_eq!(view.markdown(), source);
        });
    });
}
