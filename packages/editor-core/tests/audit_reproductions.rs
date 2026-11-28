//! Audit reproductions for the Rust beta interaction fixes.
//!
//! Every test here encodes the behaviour the interaction audit says is wrong and
//! the test spec says is required. They are written against the *required*
//! behaviour on purpose: on the baseline commit they fail, and that failure is
//! the evidence that the test discriminates. A test that passes before the fix
//! would prove nothing.
//!
//! Matrix IDs follow `.omx/plans/test-spec-gpui-beta-editor-interaction-fixes.md`.

use inkpoint_editor_core::{
    InlineMarkKind, MarkdownDocument,
    session::EditorSession,
    table_navigation::{TableNavigation, navigate_table_vertical},
};

/// Source of the CJK emphasis sample from the audit and the CJK spec.
const CJK_SAMPLE: &str =
    "本文档整理了从**「爆款洗稿（视频/小说逆向拆解）」**到**「角色锁定」**的完整落地路径";

/// CJK-01: the two quoted phrases must be bold separately and the `到` between
/// them must stay plain text.
///
/// CommonMark's flanking rules treat full-width punctuation as punctuation, so
/// both delimiter runs fail and the parser instead matches the *second* opener
/// against the *first* closer. The result is not "no bold" but bold across the
/// wrong pair, which is why this is a P1-class body-integrity bug.
#[test]
#[ignore = "red until G002 fixes it; run with --ignored to see the failure"]
fn cjk01_bold_spans_each_quoted_phrase_and_leaves_the_conjunction_plain() {
    let document = MarkdownDocument::new(CJK_SAMPLE);
    let marks = document.inline_marks().unwrap();
    let strong: Vec<&str> = marks
        .iter()
        .filter(|mark| mark.kind == InlineMarkKind::Strong)
        .map(|mark| &CJK_SAMPLE[mark.range.clone()])
        .collect();

    assert_eq!(
        strong,
        vec!["「爆款洗稿（视频/小说逆向拆解）」", "「角色锁定」"],
        "each quoted phrase is its own strong span; got {strong:?}"
    );
}

/// CJK-01 companion: non-CJK text and underscore word-internal rules must not
/// change. This guards the fix from becoming a global loosening.
#[test]
fn cjk01_keeps_standard_commonmark_emphasis_semantics() {
    let source = "plain **bold** text and a_b_c plus 中_斜体_文";
    let document = MarkdownDocument::new(source);
    let marks = document.inline_marks().unwrap();
    let strong: Vec<&str> = marks
        .iter()
        .filter(|mark| mark.kind == InlineMarkKind::Strong)
        .map(|mark| &source[mark.range.clone()])
        .collect();
    assert_eq!(strong, vec!["bold"]);

    // `a_b_c` and `中_斜体_文` stay literal: the CJK amendment deliberately does
    // not relax the underscore word-internal restriction.
    assert!(
        !marks
            .iter()
            .any(|mark| mark.kind == InlineMarkKind::Emphasis),
        "underscore emphasis inside words must not parse: {marks:?}"
    );
}

/// FENCE-01: Backspace at the first byte of fenced code body must delete the
/// previous grapheme of the *body*, never the newline that ends the opening
/// fence line.
///
/// The audit repro: clicking before `const` and pressing Backspace merged the
/// code into the language line, producing ` ```jsconst n = 1; `. Losing a fence
/// newline silently changes the document structure.
#[test]
#[ignore = "red until G002 fixes it; run with --ignored to see the failure"]
fn fence01_backspace_at_code_body_start_keeps_the_fence_newline() {
    let source = "```js\nconst n = 1;\n```\n";
    let body_start = source.find("const").unwrap();
    let mut editor = EditorSession::new(source);
    editor.set_caret(body_start);
    editor.delete_backward().unwrap();

    assert_eq!(
        editor.source(),
        source,
        "a Backspace at the code body's first byte must not consume the fence newline"
    );
    assert_eq!(editor.selection().head(), body_start);
}

/// FENCE-01 companion: ordinary Backspace inside the code body deletes one full
/// extended grapheme, including a family emoji and a combining mark.
#[test]
fn fence01_backspace_inside_code_deletes_one_extended_grapheme() {
    // Family emoji (ZWJ sequence) then a base letter with a combining accent.
    let source = "```\n👨‍👩‍👧‍👦a\u{0301}\n```\n";
    let body_start = source.find('\n').unwrap() + 1;
    let mut editor = EditorSession::new(source);
    // Caret right after the family emoji.
    let after_emoji = body_start + "👨‍👩‍👧‍👦".len();
    editor.set_caret(after_emoji);
    editor.delete_backward().unwrap();
    assert_eq!(
        editor.source(),
        "```\na\u{0301}\n```\n",
        "Backspace must remove the whole ZWJ emoji sequence, not one scalar"
    );

    // Now the combining accent: `a` + U+0301 is one grapheme. The caret sits at
    // the end of the body line, i.e. just before the closing fence's newline.
    let mut editor = EditorSession::new(editor.source());
    let accent_end = "```\na\u{0301}".len();
    editor.set_caret(accent_end);
    editor.delete_backward().unwrap();
    assert_eq!(
        editor.source(),
        "```\n\n```\n",
        "Backspace must remove the base letter and its combining mark together"
    );
}

/// TABLE-PASTE-01: pasting text with real newlines into a header cell keeps it
/// in that single cell.
///
/// The audit repro turned the pasted `first` into a paragraph outside the table
/// and `second` into the first column of the header. The historical contract
/// normalises the newline inside the cell instead.
#[test]
#[ignore = "red until G002 fixes it; run with --ignored to see the failure"]
fn table_paste01_multiline_paste_stays_inside_one_header_cell() {
    let source = "| left | right |\n| ---- | ----- |\n| x    | y     |\n";
    let target = source.find("left").unwrap()..source.find("left").unwrap() + 4;
    let mut editor = EditorSession::new(source);
    editor.set_selection(target.start, target.end);
    editor.insert("first\nsecond").unwrap();

    let result = editor.source();
    let document = MarkdownDocument::new(result);
    let blocks = document.blocks().unwrap();
    let tables: Vec<_> = blocks
        .iter()
        .filter(|block| block.kind == inkpoint_editor_core::BlockKind::Table)
        .collect();
    assert_eq!(
        tables.len(),
        1,
        "the paste must not split the table: {result:?}"
    );
    assert!(
        !result.contains("\nfirst\n"),
        "the pasted newline must be normalised inside the cell: {result:?}"
    );

    // Structure is intact: same column count, same delimiter row, other cells
    // byte-identical.
    let header = result.lines().next().unwrap();
    assert_eq!(
        header.matches('|').count(),
        source.lines().next().unwrap().matches('|').count(),
        "header column count must not change: {header:?}"
    );
    assert!(result.contains("| ---- | ----- |"));
    assert!(result.contains("| x    | y     |"));

    // One undo restores the original bytes exactly.
    assert!(editor.undo());
    assert_eq!(editor.source(), source);
}

/// TABLE-NAV-01 and TABLE-EXIT-01 are layered in `editor-gpui`: the audit's root
/// cause is the GPUI caret/key routing, not the core table commands. Their red
/// reproductions live in `packages/editor-gpui/tests/audit_reproductions.rs` so
/// the failing layer matches the one that must change.
///
/// The core command below is asserted here to pin what GPUI may rely on: core
/// vertical navigation already reaches the same column of the next row.
#[test]
fn table_nav01_core_vertical_navigation_reaches_the_same_column_below() {
    let source = "| left | right |\n| ---- | ----- |\n| x    | y     |\n";
    let header_left = source.find("left").unwrap();
    let body_x = source.find("x    ").unwrap();
    let target = navigate_table_vertical(source, header_left, true);
    assert_eq!(
        target,
        Some(TableNavigation::Select(body_x..body_x + 1)),
        "core navigation from the header must land in the same column of the next row"
    );
}
