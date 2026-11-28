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

/// One paragraph of the long-document latency fixture.
///
/// Mixed CJK/Latin prose with inline emphasis: the shape the interaction audit
/// measured. Changing this text invalidates comparison against earlier runs, so
/// the reported fixture hash covers it.
fn perf_paragraph(index: usize) -> String {
    format!("第 {index} 段。中英文 mixed text 和 **格式** 会一起换行。")
}

/// Builds `blocks` paragraphs separated by blank lines, under one heading.
///
/// The heading is load-bearing, not decoration. A heading makes the renderer
/// look up its content range, and that lookup is what pulls in the source-block
/// parse. A paragraph-only fixture never takes that path, so the gate measured
/// a document shape the app rarely sees and hid a third full parse behind it:
/// one heading was worth 7.7 ms of a 33 ms budget on 1,000 blocks, enough to
/// push a passing document over the gate. Changing this text changes the
/// reported fixture hash, so it invalidates comparison against earlier runs.
fn long_document_fixture(blocks: usize) -> String {
    let mut source = String::from("# 标题\n\n");
    source.push_str(
        &(0..blocks)
            .map(perf_paragraph)
            .collect::<Vec<_>>()
            .join("\n\n"),
    );
    source
}

/// FNV-1a over the fixture bytes.
///
/// A stable, dependency-free digest is enough here: the point is proving two
/// reported runs measured the same Markdown, not cryptographic strength.
fn fixture_hash(source: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in source.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// The commit the benchmark binary was built from.
///
/// CI and release scripts can pin `INKPOINT_BUILD_SHA`; local runs fall back to
/// asking git so the printed report still identifies its source.
fn build_sha() -> String {
    if let Some(sha) = option_env!("INKPOINT_BUILD_SHA") {
        return sha.to_owned();
    }
    std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map_or_else(|| "unknown".to_owned(), |sha| sha.trim().to_owned())
}

/// CPU and OS identity, so a number is never quoted without its machine.
fn machine_label() -> String {
    let cpu = std::process::Command::new("sysctl")
        .args(["-n", "machdep.cpu.brand_string"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map_or_else(
            || std::env::consts::ARCH.to_owned(),
            |name| name.trim().to_owned(),
        );
    let rustc = std::process::Command::new("rustc")
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map_or_else(|| "unknown rustc".to_owned(), |line| line.trim().to_owned());
    format!("{cpu} / {} / {rustc}", std::env::consts::OS)
}

/// Nearest-rank percentile: index `ceil(pct/100 * n)` in 1-based terms.
fn nearest_rank(sorted: &[Duration], percent: usize) -> Duration {
    sorted[(sorted.len() * percent).div_ceil(100) - 1]
}

/// Restores the exact pre-sample state outside the timed region.
///
/// Every sample must start from identical bytes, caret and focus, otherwise the
/// series measures fixture drift instead of input latency.
fn reset_before_sample(
    view: &Entity<TypesetView>,
    vcx: &mut VisualTestContext,
    source: &str,
    caret: usize,
) {
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.replace_markdown(source, cx);
            view.set_caret(caret, cx);
            view.focus(window, cx);
        });
    });
    // Draw to a settled state so the timed sample only pays for its own input.
    draw(vcx);
    draw(vcx);
}

/// Measures `SAMPLE_COUNT` input-to-paint samples for one document size.
fn measure_input_to_paint(
    view: &Entity<TypesetView>,
    vcx: &mut VisualTestContext,
    source: &str,
    caret: usize,
) -> Vec<Duration> {
    // Fixed warm-up so the first timed sample is not paying one-time setup.
    for _ in 0..WARM_UP_COUNT {
        reset_before_sample(view, vcx, source, caret);
        vcx.update(|window, cx| {
            view.update(cx, |view, cx| {
                view.replace_text_in_range(None, "中", window, cx)
            });
            window.draw(cx).clear(cx);
        });
    }
    let mut samples = Vec::with_capacity(SAMPLE_COUNT);
    for _ in 0..SAMPLE_COUNT {
        reset_before_sample(view, vcx, source, caret);
        // Timed section: production text-input entry, then through to GPUI draw.
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
    samples
}

/// Prints every duration plus the percentiles the acceptance gate uses.
fn report_latency(label: &str, source: &str, samples: &[Duration], gate: Duration) -> Duration {
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    let p50 = nearest_rank(&sorted, 50);
    let p95 = nearest_rank(&sorted, 95);
    let durations = sorted
        .iter()
        .map(|sample| format!("{:.2}", sample.as_secs_f64() * 1000.0))
        .collect::<Vec<_>>()
        .join(", ");
    eprintln!(
        "[{label}] fixture fnv1a64={:#018x} bytes={} build={} machine={}",
        fixture_hash(source),
        source.len(),
        build_sha(),
        machine_label()
    );
    eprintln!("[{label}] samples_ms=[{durations}]");
    eprintln!(
        "[{label}] p50={:.2}ms p95={:.2}ms gate={:.0}ms samples={}",
        p50.as_secs_f64() * 1000.0,
        p95.as_secs_f64() * 1000.0,
        gate.as_secs_f64() * 1000.0,
        sorted.len()
    );
    p95
}

const SAMPLE_COUNT: usize = 35;
const WARM_UP_COUNT: usize = 5;

/// Long-document input latency gate: 1,000 blocks p95 <= 33 ms, 2,000 <= 45 ms.
///
/// The timed section runs through the production text-input entry and stops at
/// the GPUI draw call, matching the interaction audit's measurement window. The
/// audit's own 1k=30.16 ms / 2k=66.06 ms series used a different fixture and is
/// not merged with these numbers.
#[gpui_kit::test]
#[ignore = "run on the Mac used for release acceptance"]
fn native_long_document_input_to_paint(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    for (blocks, gate_ms) in [(1000usize, 33u64), (2000, 45)] {
        let source = long_document_fixture(blocks);
        // Type mid-document: the realistic hot path is one block relaid out
        // between neighbours, not an append at EOF.
        let mut caret = source.len() / 2;
        while !source.is_char_boundary(caret) {
            caret += 1;
        }
        let (view, vcx) =
            cx.add_window_view(|window, cx| TypesetView::new(window, cx, source.as_str()));
        vcx.update(|window, cx| view.update(cx, |view, cx| view.focus(window, cx)));
        draw(vcx);
        draw(vcx);
        let samples = measure_input_to_paint(&view, vcx, source.as_str(), caret);
        let gate = Duration::from_millis(gate_ms);
        let p95 = report_latency(&format!("{blocks} blocks"), source.as_str(), &samples, gate);
        assert!(
            p95 <= gate,
            "{blocks}-block native input-to-paint p95 {p95:?} exceeds gate {gate:?}"
        );
    }
}

/// PERF-MIXED-01: prose, a GFM table, a Mermaid flowchart and Chinese input
/// stay consistent through a round of edits.
///
/// This is the regression the perf work must not break, and it is deliberately
/// separate from the 1k/2k fixtures: those measure latency, this one measures
/// that a mixed document still holds together. There is no threshold here.
#[gpui_kit::test]
fn perf_mixed01_a_table_diagram_and_chinese_input_stay_consistent(cx: &mut TestAppContext) {
    let source = "开头段落。\n\n| 列一 | 列二 |\n| --- | --- |\n| a | b |\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n结尾段落。\n";
    let (view, vcx) = open_focused(cx, source);

    // Initial state: one table with all six cells, nothing failed to parse.
    view.read_with(&*vcx, |view, _| {
        assert_eq!(view.markdown(), source, "the fixture opens unchanged");
        let groups = view.document.table_cells();
        assert_eq!(groups.len(), 1, "one table");
        assert_eq!(groups[0].len(), 6, "3x2 cells");
        assert!(view.parse_error().is_none(), "the fixture parses");
    });

    // 1. Edit prose.
    let prose = source.find("开头段落。").expect("the opening paragraph") + "开头段落。".len();
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(prose, cx)));
    vcx.simulate_input("补充");
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert!(
            view.markdown().contains("开头段落。补充"),
            "the prose edit landed: {:?}",
            view.markdown()
        );
    });

    // 2. Edit a table cell: the table must still be one table with six cells.
    let cell = view.read_with(&*vcx, |view, _| {
        view.markdown().find("| a |").expect("the cell")
    });
    let caret = cell + "| ".len();
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(caret, cx)));
    vcx.simulate_input("单元");
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert!(
            view.markdown().contains("| 单元a |"),
            "the cell edit stayed inside the cell: {:?}",
            view.markdown()
        );
        let groups = view.document.table_cells();
        assert_eq!(groups.len(), 1, "still one table");
        assert_eq!(groups[0].len(), 6, "the table did not gain or lose cells");
    });

    // 3. Commit Chinese composition at the end of the document.
    let end = view.read_with(&*vcx, |view, _| view.markdown().len());
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(end, cx)));
    vcx.simulate_input("中文组合");
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert!(
            view.markdown().contains("中文组合"),
            "the composed text is in the source: {:?}",
            view.markdown()
        );
        assert!(
            view.document.table_cells().len() == 1,
            "composing outside the table left it intact"
        );
    });

    // 4. Update the Mermaid diagram's content.
    let arrow = view.read_with(&*vcx, |view, _| {
        view.markdown().find("A-->B").expect("the edge")
    });
    let target = arrow + "A-->B".len();
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(target, cx)));
    vcx.simulate_input("C");
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert!(
            view.markdown().contains("A-->BC"),
            "the diagram source changed: {:?}",
            view.markdown()
        );
        assert!(
            view.document.table_cells().len() == 1,
            "editing the fence left the table intact"
        );
    });

    // 5. Break the diagram: the source must survive and the document must stay
    //    editable. A failed diagram degrades to its source rather than failing
    //    the whole document.
    // Deleting the header through the keyboard is what a user does; two
    // `set_caret` calls are not a selection, so typing would insert instead of
    // replace.
    let header_end = view.read_with(&*vcx, |view, _| {
        let markdown = view.markdown().to_owned();
        let at = markdown.find("flowchart LR").expect("the diagram header");
        at + "flowchart LR".len()
    });
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(header_end, cx)));
    for _ in 0.."flowchart LR".len() {
        vcx.simulate_keystrokes("backspace");
    }
    draw(vcx);
    view.read_with(&*vcx, |view, _| {
        assert!(
            !view.markdown().contains("flowchart LR"),
            "the header was deleted: {:?}",
            view.markdown()
        );
        assert!(
            view.markdown().contains("```mermaid"),
            "the fence itself survives, so the source is preserved: {:?}",
            view.markdown()
        );
        assert!(
            view.document.table_cells().len() == 1,
            "an invalid diagram does not disturb the table"
        );
        assert!(
            view.markdown().contains("中文组合"),
            "the composed text survived every later edit"
        );
    });
}
