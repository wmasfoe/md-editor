//! Audit reproductions for the GPUI interaction layer.
//!
//! Same contract as `packages/editor-core/tests/audit_reproductions.rs`: these
//! assert the *required* behaviour, so a failure on the baseline commit is the
//! evidence that the test discriminates. Matrix IDs follow
//! `.omx/plans/test-spec-gpui-beta-editor-interaction-fixes.md`.
//!
//! Everything here goes through the public `TypesetView` surface plus simulated
//! key and text input, so the test exercises the same entry points the user does.

use gpui_kit::{TestAppContext, VisualTestContext};
use inkpoint_editor_gpui::TypesetView;

fn draw(vcx: &mut VisualTestContext) {
    vcx.update(|window, cx| window.draw(cx).clear(cx));
    vcx.run_until_parked();
}

fn open_focused<'a>(
    cx: &'a mut TestAppContext,
    source: &str,
) -> (gpui_kit::Entity<TypesetView>, &'a mut VisualTestContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
    vcx.update(|window, cx| view.update(cx, |view, cx| view.focus(window, cx)));
    // Two settled draws: the first lays out, the second measures the caret.
    draw(vcx);
    draw(vcx);
    (view, vcx)
}

/// TABLE-NAV-01: `↓` on a header cell must land in the same column of the next
/// row, not jump past the table.
///
/// The audit repro: with a paragraph after the table, pressing down on the left
/// header cell skipped the whole table. The cause is in the view's vertical
/// move, which steps by laid-out leaf and treats a table as one stop.
#[gpui_kit::test]
#[ignore = "red until G002 fixes it; run with --ignored to see the failure"]
fn table_nav01_down_from_header_reaches_the_same_column(cx: &mut TestAppContext) {
    let source = "| left | right |\n| ---- | ----- |\n| x    | y     |\n\nAfter paragraph.\n";
    let (view, vcx) = open_focused(cx, source);
    let header_left = source.find("left").unwrap();
    let body_x = source.find("x    ").unwrap();

    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(header_left, cx)));
    draw(vcx);
    vcx.simulate_keystrokes("down");
    draw(vcx);

    let caret = view.read_with(&*vcx, |view, _| view.selected_range().start);
    assert!(
        (body_x..body_x + 4).contains(&caret),
        "down from the header must land in the same column of the next row, got {caret} (expected near {body_x})"
    );
}

/// TABLE-EXIT-01: typing below a document-final table must create a paragraph
/// outside the table.
///
/// The audit repro appended `继续` to the last cell because the click below the
/// table resolves to the EOF byte offset, which is inside the table's source.
#[gpui_kit::test]
#[ignore = "red until G002 fixes it; run with --ignored to see the failure"]
fn table_exit01_typing_below_a_final_table_creates_a_paragraph(cx: &mut TestAppContext) {
    let source = "| a | b |\n| - | - |\n| c | d |";
    let (view, vcx) = open_focused(cx, source);
    // A click in the space below the table resolves to EOF.
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(source.len(), cx)));
    draw(vcx);
    vcx.simulate_input("继续");
    draw(vcx);

    let markdown = view.read_with(&*vcx, |view, _| view.markdown().to_owned());
    assert!(
        markdown.ends_with("\n\n继续"),
        "input below the table must form its own paragraph, got {markdown:?}"
    );
    assert!(
        markdown.starts_with(source),
        "the table source must be untouched, got {markdown:?}"
    );
}

/// TAB-01: Tab on a plain prose line indents by two spaces at the line start and
/// Shift+Tab reverses it, keeping body focus.
///
/// The audit repro inserted a literal tab at the caret. The historical contract
/// is a two-space line indent.
#[gpui_kit::test]
#[ignore = "red until G002 fixes it; run with --ignored to see the failure"]
fn tab01_plain_prose_tab_indents_the_line_by_two_spaces(cx: &mut TestAppContext) {
    let source = "plain paragraph text";
    let (view, vcx) = open_focused(cx, source);
    // Caret mid-line: the historical contract indents the line, not the caret.
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(6, cx)));
    draw(vcx);
    vcx.simulate_keystrokes("tab");
    draw(vcx);
    assert_eq!(
        view.read_with(&*vcx, |view, _| view.markdown().to_owned()),
        format!("  {source}"),
        "Tab on a prose line must add a two-space line indent"
    );

    vcx.simulate_keystrokes("shift-tab");
    draw(vcx);
    assert_eq!(
        view.read_with(&*vcx, |view, _| view.markdown().to_owned()),
        source,
        "Shift+Tab must remove the two-space indent"
    );
}

/// TABLE-SOURCE-01: in source mode, Tab on collapsed text inserts exactly one
/// U+0009 and does not navigate cells or add a table row.
///
/// The audit repro: caret in the last cell of source mode, Tab added an empty
/// row. Cell navigation belongs to WYSIWYG only.
#[gpui_kit::test]
#[ignore = "red until G002 fixes it; run with --ignored to see the failure"]
fn table_source01_source_mode_tab_inserts_a_literal_tab(cx: &mut TestAppContext) {
    let source = "| a | b |\n| - | - |\n| c | d |\n";
    let (view, vcx) = open_focused(cx, source);
    // Switch to source mode, then put the caret in the last cell.
    vcx.simulate_keystrokes("cmd-/");
    draw(vcx);
    let last_cell = source.rfind('d').unwrap();
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(last_cell, cx)));
    draw(vcx);
    vcx.simulate_keystrokes("tab");
    draw(vcx);

    let markdown = view.read_with(&*vcx, |view, _| view.markdown().to_owned());
    assert!(
        markdown.contains("\t"),
        "source-mode Tab must insert one literal U+0009, got {markdown:?}"
    );
    assert_eq!(
        markdown.lines().count(),
        source.lines().count(),
        "source-mode Tab must not add a table row, got {markdown:?}"
    );
}

// VIEW-01 lives in `tests/support/audit_view.rs`, which is compiled into the
// crate so it can read the private scroll position. The public surface here has
// no accessor for it, and adding one just for a test would widen the API.
