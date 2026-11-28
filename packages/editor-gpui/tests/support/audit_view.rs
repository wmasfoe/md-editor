//! Crate-internal audit reproductions.
//!
//! Included through `#[path]` from `typeset_view.rs` so these tests can read
//! private view state (`native_layout`, scroll position) that the public surface
//! deliberately does not expose. Public-surface reproductions live in
//! `packages/editor-gpui/tests/audit_reproductions.rs` instead.

use super::*;
use gpui_kit::{TestAppContext, VisualTestContext};

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

/// VIEW-01: toggling source mode keeps the reading position instead of pulling
/// the viewport back to an off-screen caret.
///
/// The audit repro: caret left at the document start, scrolled to paragraph
/// ~300, then `Cmd+/`. The selection stayed put but the viewport jumped back to
/// the top, losing the reader's place. The contract is to keep the reading
/// position and only re-anchor when the caret is actually visible.
#[gpui_kit::test]
fn view01_toggling_source_mode_keeps_the_reading_position(cx: &mut TestAppContext) {
    let source = (0..500)
        .map(|index| format!("第 {index} 段。正文内容。"))
        .collect::<Vec<_>>()
        .join("\n\n");
    let (view, vcx) = open_focused(cx, &source);
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(0, cx)));
    draw(vcx);
    let start_top = view.read_with(&*vcx, |view, _| view.native_layout.top_item_index());

    // Scroll away from the caret without moving it: this is the reader state the
    // contract protects.
    vcx.update(|_, cx| {
        view.update(cx, |view, _| {
            view.native_layout.scroll_by(gpui_kit::px(2000.));
        });
    });
    draw(vcx);
    draw(vcx);
    let scrolled_top = view.read_with(&*vcx, |view, _| view.native_layout.top_item_index());
    assert!(
        scrolled_top > start_top,
        "the test must actually scroll away from the caret: {start_top} -> {scrolled_top}"
    );

    vcx.simulate_keystrokes("cmd-/");
    draw(vcx);
    draw(vcx);
    let after_toggle = view.read_with(&*vcx, |view, _| view.native_layout.top_item_index());
    // The two modes decompose the document into different block counts, so an
    // exact index match is not the contract. The contract is "the same reading
    // region": the viewport must stay where the reader was instead of jumping
    // back to the off-screen caret at the top.
    assert!(
        after_toggle.abs_diff(scrolled_top) <= 20,
        "toggling source mode must keep the reading position: {scrolled_top} -> {after_toggle}"
    );
    assert!(
        after_toggle > start_top + 100,
        "the viewport must not jump back to the off-screen caret: {start_top} -> {after_toggle}"
    );

    // The selection must be untouched by the mode switch.
    assert_eq!(view.read_with(&*vcx, |view, _| view.selected_range()), 0..0);
}

/// TABLE-HANDLE-01: a freshly opened document already knows its table cells.
///
/// The regression this pins: `new` records the document revision, so the first
/// `reparse` short-circuits and never filled the cell cache. Handles then only
/// appeared after the first edit, which reads as "the table has no controls"
/// for exactly as long as the user is looking at it.
#[gpui_kit::test]
fn table_handle01_a_freshly_opened_document_knows_its_table_cells(cx: &mut TestAppContext) {
    let source = "| a | b |\n| - | - |\n| c | d |\n";
    let (view, vcx) = open_focused(cx, source);
    draw(vcx);
    let groups = view.read_with(&*vcx, |view, _| view.table_slots.len());
    assert_eq!(groups, 1, "the open document's table is cached immediately");
    let cells = view.read_with(&*vcx, |view, _| view.table_slots[0].len());
    assert_eq!(cells, 6, "all 3x2 cells, ready for the first hover");
}

/// TABLE-HANDLE-01: source mode renders literal lines, so a table there is text
/// and must not grow handles; switching back restores them.
#[gpui_kit::test]
fn table_handle01_source_mode_has_no_table_handles(cx: &mut TestAppContext) {
    let source = "| a | b |\n| - | - |\n| c | d |\n";
    let (view, vcx) = open_focused(cx, source);
    draw(vcx);
    vcx.simulate_keystrokes("cmd-/");
    draw(vcx);
    draw(vcx);
    assert!(
        view.read_with(&*vcx, |view, _| view.source_mode()),
        "the keystroke must actually switch mode"
    );
    assert_eq!(
        view.read_with(&*vcx, |view, _| view.table_slots.len()),
        0,
        "literal source has no table structure"
    );

    vcx.simulate_keystrokes("cmd-/");
    draw(vcx);
    draw(vcx);
    assert!(
        !view.read_with(&*vcx, |view, _| view.source_mode()),
        "switched back to rendered mode"
    );
    assert_eq!(
        view.read_with(&*vcx, |view, _| view.table_slots.len()),
        1,
        "the table is a table again"
    );
}
