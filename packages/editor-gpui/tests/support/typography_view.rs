//! Regression coverage for updating typography on an already open view.
use super::*;
use gpui_kit::TestAppContext;

#[gpui_kit::test]
fn changing_typography_reflows_without_changing_document_state(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let source = "Body text with `inline code`.\n\n```rust\nlet value = 42;\n```\n";
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    let draw = |vcx: &mut gpui_kit::VisualTestContext| {
        for _ in 0..3 {
            vcx.update(|window, cx| window.draw(cx).clear(cx));
            vcx.run_until_parked();
        }
    };
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.focus(window, cx);
            view.select_all(cx);
        })
    });
    draw(vcx);
    let (before_height, before_source, before_revision, before_selection) =
        view.read_with(&*vcx, |view, _| {
            let key = view.document.leaf_at(0).unwrap();
            (
                view.geometry.get(key).unwrap().bounds().size.height,
                view.markdown().to_owned(),
                view.revision(),
                view.selected_range(),
            )
        });
    vcx.update(|_, cx| {
        view.update(cx, |view, cx| {
            view.set_typography(
                TypesetTypography {
                    body_font_size: 22.,
                    prose_font_family: "Helvetica".into(),
                    code_font_family: "Menlo".into(),
                },
                cx,
            )
        })
    });
    draw(vcx);
    vcx.update(|_, cx| {
        let typography = &view.read(cx).typography;
        let context = typography.render_context(cx);
        assert_eq!(
            context.style().code_block().text.font_family.as_deref(),
            Some("Menlo")
        );
        assert_eq!(
            context
                .style()
                .inline_code_style()
                .text
                .font_family
                .as_deref(),
            Some("Menlo")
        );
    });
    view.read_with(&*vcx, |view, _| {
        let key = view.document.leaf_at(0).unwrap();
        let height = view.geometry.get(key).unwrap().bounds().size.height;
        assert!(
            height > before_height,
            "body must reflow at the larger size: {before_height:?} -> {height:?}"
        );
        assert_eq!(view.markdown(), before_source);
        assert_eq!(view.revision(), before_revision);
        assert_eq!(view.selected_range(), before_selection);
        assert_eq!(view.typography.prose_font_family, "Helvetica");
        assert_eq!(view.typography.code_font_family, "Menlo");
    });
}
