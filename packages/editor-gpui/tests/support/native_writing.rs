//! Native editor acceptance through the same input and geometry used at runtime.

use super::*;
use gpui_kit::{TestAppContext, VisualTestContext};
use std::time::{Duration, Instant};

const ARTICLE: &str = include_str!("../fixtures/desktop-writing.md");

fn draw(vcx: &mut VisualTestContext) {
    vcx.update(|window, cx| window.draw(cx).clear(cx));
    vcx.run_until_parked();
}

fn open_focused<'a>(
    cx: &'a mut TestAppContext,
    source: &str,
) -> (Entity<TypesetView>, &'a mut VisualTestContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    vcx.update(|window, cx| view.update(cx, |view, cx| view.focus(window, cx)));
    draw(vcx);
    draw(vcx);
    (view, vcx)
}

#[gpui_kit::test]
fn return_at_the_end_makes_a_visible_empty_paragraph(cx: &mut TestAppContext) {
    let source = "在这里写。";
    let (view, vcx) = open_focused(cx, source);
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(source.len(), cx)));
    draw(vcx);
    let before = view.read_with(&*vcx, |view, _| view.caret_bounds().unwrap());

    vcx.simulate_keystrokes("enter");
    draw(vcx);
    let first_break = view.read_with(&*vcx, |view, _| {
        assert_eq!(view.markdown(), "在这里写。\n\n");
        assert_eq!(view.selected_range(), source.len() + 2..source.len() + 2);
        let caret = view
            .caret_bounds()
            .expect("the empty paragraph has a caret");
        assert!(caret.top() > before.bottom());
        assert!(caret.left() < before.left());
        caret
    });

    vcx.simulate_keystrokes("enter");
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert_eq!(view.markdown(), "在这里写。\n\n\n");
        assert!(view.caret_bounds().unwrap().top() > first_break.bottom());
    });
    vcx.simulate_input("后续");
    view.read_with(&*vcx, |view, _| {
        assert_eq!(view.markdown(), "在这里写。\n\n\n后续")
    });
}

#[gpui_kit::test]
fn return_splits_a_paragraph_and_shift_return_breaks_its_line(cx: &mut TestAppContext) {
    let source = "第一部分第二部分";
    let (view, vcx) = open_focused(cx, source);
    let split = "第一部分".len();
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(split, cx)));
    draw(vcx);
    let before = view.read_with(&*vcx, |view, _| view.caret_bounds().unwrap());

    vcx.simulate_keystrokes("enter");
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert_eq!(view.markdown(), "第一部分\n\n第二部分");
        assert!(view.caret_bounds().unwrap().top() > before.bottom());
    });

    vcx.update(|_, cx| view.update(cx, |view, cx| view.undo(cx)));
    vcx.simulate_keystrokes("shift-enter");
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert_eq!(view.markdown(), "第一部分  \n第二部分");
        assert!(view.caret_bounds().unwrap().top() > before.bottom());
    });
}

#[gpui_kit::test]
fn return_in_a_list_moves_the_caret_to_the_continued_item(cx: &mut TestAppContext) {
    let source = "- 列表";
    let (view, vcx) = open_focused(cx, source);
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(source.len(), cx)));
    draw(vcx);
    let before = view.read_with(&*vcx, |view, _| view.caret_bounds().unwrap());

    vcx.simulate_keystrokes("enter");
    draw(vcx);
    let after = view.read_with(&*vcx, |view, _| {
        assert_eq!(view.markdown(), "- 列表\n- ");
        assert_eq!(view.selected_range(), source.len() + 3..source.len() + 3);
        let caret = view.caret_bounds().expect("the continued item has a caret");
        assert!(caret.top() > before.bottom());
        caret
    });

    vcx.simulate_input("后续");
    view.read_with(&*vcx, |view, _| {
        assert_eq!(view.markdown(), "- 列表\n- 后续");
        assert!(view.caret_bounds().unwrap().top() >= after.top());
    });
}

#[gpui_kit::test]
fn return_in_a_blockquote_moves_the_caret_to_the_continued_quote(cx: &mut TestAppContext) {
    let source = "> 引用";
    let (view, vcx) = open_focused(cx, source);
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(source.len(), cx)));
    draw(vcx);
    let before = view.read_with(&*vcx, |view, _| view.caret_bounds().unwrap());

    vcx.simulate_keystrokes("enter");
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        let continued = "> 引用  \n> ";
        assert_eq!(view.markdown(), continued);
        assert_eq!(view.selected_range(), continued.len()..continued.len());
        let caret = view
            .caret_bounds()
            .expect("the continued quote has a caret");
        assert!(caret.top() > before.bottom());
    });

    vcx.simulate_input("后续");
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert_eq!(view.markdown(), "> 引用  \n> 后续");
        assert!(view.caret_bounds().unwrap().top() > before.bottom());
    });
}

#[gpui_kit::test]
fn blank_lines_between_structured_blocks_keep_distinct_caret_rows(cx: &mut TestAppContext) {
    let source = "> 下一行可以继续引用或回到正文。\n\n\n\n1. 调整列表层级。\n\n\n---";
    let (view, vcx) = open_focused(cx, source);
    let line_ends: Vec<_> = source
        .split_inclusive('\n')
        .scan(0, |offset, line| {
            *offset += line.len();
            Some(*offset)
        })
        .take_while(|end| *end < source.len())
        .map(|end| end - 1)
        .collect();
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(line_ends[0], cx)));
    draw(vcx);
    let mut previous = view.read_with(&*vcx, |view, _| view.caret_bounds().unwrap());
    for offset in line_ends.into_iter().skip(1) {
        vcx.simulate_keystrokes("down");
        draw(vcx);
        let bounds = view.read_with(&*vcx, |view, _| {
            assert_eq!(view.selected_range(), offset..offset);
            view.caret_bounds()
                .expect("each Markdown blank line has a visible caret row")
        });
        assert!(bounds.top() > previous.bottom());
        previous = bounds;
    }
    view.read_with(&*vcx, |view, _| assert_eq!(view.markdown(), source));
}

#[gpui_kit::test]
fn caret_centers_on_wrapped_chinese_text_with_line_leading(cx: &mut TestAppContext) {
    let source = "这是一段中英文 mixed text，用来检查自动换行后的光标。".repeat(12);
    let (view, vcx) = open_focused(cx, &source);
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(source.len(), cx)));
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        let leaf = view.geometry.get(view.caret_leaf.unwrap()).unwrap();
        let line_top = leaf.position_for_index(leaf.len()).y;
        let caret = view.caret_bounds().unwrap();
        assert!(line_top > leaf.bounds().top());
        assert!(caret.top() > line_top);
        assert_eq!(caret.center().y, line_top + leaf.line_height() / 2.);
    });
}

#[gpui_kit::test]
fn switching_to_source_invalidates_the_native_layout(cx: &mut TestAppContext) {
    let source = "# 中文标题";
    let (view, vcx) = open_focused(cx, source);
    let visible_len =
        |view: &TypesetView, _: &App| view.geometry.get(view.caret_leaf.unwrap()).unwrap().len();
    assert_eq!(view.read_with(&*vcx, visible_len), "中文标题".len());

    vcx.simulate_keystrokes("cmd-/");
    draw(vcx);
    assert_eq!(view.read_with(&*vcx, visible_len), source.len());

    vcx.simulate_keystrokes("cmd-/");
    draw(vcx);
    assert_eq!(view.read_with(&*vcx, visible_len), "中文标题".len());
}

#[gpui_kit::test]
fn active_format_reflows_without_moving_the_source_caret(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, ARTICLE));
    draw(vcx);
    let target = ARTICLE.find("加粗").unwrap() + "加".len();
    let local = |view: &TypesetView| {
        let key = view.document.leaf_at(target).unwrap();
        let index = view.document.rendered_offset(key, target).unwrap();
        assert!(index <= view.geometry.get(key).unwrap().len());
        index
    };
    let hidden_index = view.read_with(&*vcx, |view, _| local(view));
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(target, cx)));
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert_eq!(view.selected_range(), target..target);
        assert_eq!(view.revision(), 0);
        assert_eq!(view.markdown(), ARTICLE);
        assert_eq!(local(view), hidden_index + 2);
        let bounds = view.caret_bounds().unwrap();
        let hit = view.source_offset_for_point(bounds.origin + gpui_kit::point(px(0.), px(3.)));
        assert_eq!(hit, Some(target));
    });

    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(0, cx)));
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert_eq!(local(view), hidden_index);
        assert!(view.document.active_reveal().is_none());
    });
}

#[gpui_kit::test]
fn preedit_is_visible_without_changing_the_savable_source(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let source = "在这里写。";
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    let start = "在".len();
    let end = "在这里".len();
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.set_selected_range(start..end, cx);
            view.replace_and_mark_text_in_range(None, "zhong", Some(5..5), window, cx);
        });
    });
    draw(vcx);
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            assert_eq!(view.markdown(), source);
            assert_eq!(view.selected_range(), start..end);
            assert_eq!(view.editor.display_source(), "在zhong写。");
            assert_eq!(view.marked_text_range(window, cx), Some(1..6));
            assert!(
                view.bounds_for_range(1..6, Bounds::default(), window, cx)
                    .is_some()
            );
            view.replace_and_mark_text_in_range(None, "", None, window, cx);
            assert_eq!(view.markdown(), source);
            assert_eq!(view.selected_range(), start..end);
            assert!(!view.can_undo());
        });
    });
}

#[gpui_kit::test]
fn native_layout_reveals_offscreen_caret_and_keeps_idle_scroll_position(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let source = (0..1000)
        .map(|index| format!("Paragraph {index}: readable source text."))
        .collect::<Vec<_>>()
        .join("\n\n");
    let target = source.find("Paragraph 900").unwrap();
    let (view, vcx) =
        cx.add_window_view(|window, cx| TypesetView::new(window, cx, source.as_str()));
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(target, cx)));
    draw(vcx);
    draw(vcx);
    let target_key = view.read_with(&*vcx, |view, _| {
        let key = view.document.leaf_at(target).unwrap();
        assert!(
            view.geometry.get(key).is_some(),
            "setting a caret before first paint must materialize its offscreen block"
        );
        assert_eq!(view.caret_leaf, Some(key));
        key
    });

    // An ordinary user scroll must remain in place on subsequent prepaints;
    // caret geometry collection must not automatically pull focus back onscreen.
    vcx.update(|_, cx| {
        view.update(cx, |view, _| {
            view.native_layout.scroll_by(gpui_kit::px(180.));
        })
    });
    draw(vcx);
    let scrolled_top = view.read_with(&*vcx, |view, _| view.native_layout.top_item_index());
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert_eq!(view.native_layout.top_item_index(), scrolled_top);
    });

    vcx.update(|_, cx| {
        view.update(cx, |view, _| {
            view.native_layout.reveal_block(0);
        })
    });
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert_eq!(view.native_layout.top_item_index(), 0);
        assert!(view.geometry.get(target_key).is_none());
        assert_eq!(view.selected_range(), target..target);
    });
}

#[gpui_kit::test]
fn native_layout_reveals_end_after_a_trailing_newline(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let source = (0..200)
        .map(|index| format!("Paragraph {index}: readable source text."))
        .collect::<Vec<_>>()
        .join("\n\n")
        + "\n";
    let (view, vcx) =
        cx.add_window_view(|window, cx| TypesetView::new(window, cx, source.as_str()));
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(source.len(), cx)));
    draw(vcx);
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        let key = view.document.leaf_at(source.len()).unwrap();
        assert!(
            view.geometry.get(key).is_some(),
            "the trailing newline's EOF caret must reveal the final source block"
        );
        assert_eq!(view.caret_leaf, Some(key));
    });
}

#[gpui_kit::test]
#[ignore = "run on the Mac used for release acceptance"]
fn native_long_document_input_to_paint(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let source = (0..1000)
        .map(|i| format!("第 {i} 段。中英文 mixed text 和 **格式** 会一起换行。"))
        .collect::<Vec<_>>()
        .join("\n\n");
    let (view, vcx) =
        cx.add_window_view(|window, cx| TypesetView::new(window, cx, source.as_str()));
    draw(vcx);
    const SAMPLE_COUNT: usize = 35;
    let mut samples = Vec::with_capacity(SAMPLE_COUNT);
    for _ in 0..SAMPLE_COUNT {
        let elapsed = vcx.update(|window, cx| {
            let start = Instant::now();
            view.update(cx, |view, cx| {
                view.replace_text_in_range(None, "中", window, cx)
            });
            window.draw(cx).clear(cx);
            start.elapsed()
        });
        samples.push(elapsed);
    }
    samples.sort_unstable();
    let p95 = samples[(samples.len() * 95).div_ceil(100) - 1];
    eprintln!("1000 blocks, native input to paint p95 {p95:?}");
    assert!(
        p95 <= Duration::from_millis(33),
        "native long-document p95: {p95:?}"
    );
}
