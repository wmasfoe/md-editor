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

/// AI-01: a suggestion computed in one mode cannot be inserted after a mode
/// switch, even though the source and selection are unchanged.
///
/// The audit repro injected an already-returned suggestion, pressed `Cmd+/`, and
/// the suggestion was still visible and still inserted. Revision alone cannot
/// catch this: a mode switch changes what the offsets mean without editing the
/// source, which is why the guard is a separate mode generation.
#[gpui_kit::test]
fn ai01_a_suggestion_cannot_land_after_a_mode_switch(cx: &mut TestAppContext) {
    let source = "paragraph text";
    let (view, vcx) = open_focused(cx, source);
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(source.len(), cx)));
    draw(vcx);

    let target = view.read_with(&*vcx, |view, _| {
        (
            view.revision(),
            view.mode_generation(),
            view.selected_range(),
        )
    });

    // The mode changes while the reply is in flight.
    vcx.simulate_keystrokes("cmd-/");
    draw(vcx);

    let after_switch = view.read_with(&*vcx, |view, _| view.mode_generation());
    assert_ne!(
        after_switch, target.1,
        "a mode switch must advance the mode generation"
    );
    assert_eq!(
        view.read_with(&*vcx, |view, _| view.revision()),
        target.0,
        "the source is untouched, which is why revision alone is not enough"
    );

    let result = vcx.update(|_, cx| {
        view.update(cx, |view, cx| {
            view.insert_if_unchanged(target.0, target.1, target.2, "SUGGESTION", cx)
        })
    });
    assert_eq!(
        result,
        Err("The editor mode changed while the insert was pending."),
        "a suggestion from the other mode must be refused"
    );
    assert_eq!(
        view.read_with(&*vcx, |view, _| view.markdown().to_owned()),
        source,
        "the body is untouched"
    );
}

/// AI-01 companion: the same suggestion still lands when nothing changed.
///
/// Without this, a guard that always refuses would pass the test above.
#[gpui_kit::test]
fn ai01_a_suggestion_still_lands_when_the_mode_is_unchanged(cx: &mut TestAppContext) {
    let source = "paragraph text";
    let (view, vcx) = open_focused(cx, source);
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_caret(source.len(), cx)));
    draw(vcx);

    let target = view.read_with(&*vcx, |view, _| {
        (
            view.revision(),
            view.mode_generation(),
            view.selected_range(),
        )
    });
    let result = vcx.update(|_, cx| {
        view.update(cx, |view, cx| {
            view.insert_if_unchanged(target.0, target.1, target.2, "X", cx)
        })
    });
    assert!(
        result.is_ok(),
        "an unchanged document must accept the insert: {result:?}"
    );
    assert_eq!(
        view.read_with(&*vcx, |view, _| view.markdown().to_owned()),
        format!("{source}X")
    );
}
