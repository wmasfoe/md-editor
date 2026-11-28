//! Fenced code block boundaries.
//!
//! A fenced code block's source range starts at the opening fence line and ends
//! at the closing fence. The newline that terminates the opening fence is
//! *syntax*: it separates the info string from the first line of code. Deleting
//! it silently changes the document — the audit's repro turned
//!
//! ````text
//! ```js
//! const n = 1;
//! ```
//! ````
//!
//! into a single line reading ` ```jsconst n = 1; `, which is no longer a code
//! block at all.
//!
//! The renderer reports a caret at the first byte of the code body as a plain
//! byte offset, so a Backspace there looks like an ordinary character deletion.
//! This module supplies the missing fact: whether a given offset is a code
//! body's first byte, which is the boundary that must not be crossed.

use std::ops::Range;

use crate::{BlockKind, SourceBlock};

/// The first byte of a fenced code block's body.
///
/// That is the byte just past the newline that ends the opening fence line.
/// Returns `None` for a block that is not code, and for a block whose opening
/// line has no newline (nothing follows it, so there is no body).
pub fn code_body_start(source: &str, block: &SourceBlock) -> Option<usize> {
    if !matches!(block.kind, BlockKind::Code { .. }) {
        return None;
    }
    body_start_of(source, &block.range)
}

fn body_start_of(source: &str, range: &Range<usize>) -> Option<usize> {
    let slice = source.get(range.clone())?;
    let opening_line_end = slice.find('\n')?;
    let start = range.start + opening_line_end + 1;
    (start <= range.end).then_some(start)
}

/// Whether `caret` sits at the first byte of a fenced code block's body.
///
/// This is the guard a Backspace consults: at this offset the preceding byte is
/// the opening fence's newline, which is structure rather than text, so deleting
/// it would merge the code into the info string.
pub fn at_code_body_start(source: &str, caret: usize) -> bool {
    // Cheap necessary conditions first. A code body starts immediately after the
    // newline that ends a fence opening line, so anything else cannot be one.
    //
    // This guard is what keeps Backspace affordable: without it every keystroke
    // parsed the whole document to answer a question that is almost always "no".
    // Measured at 8.5 ms (1,000 blocks) and 18.6 ms (2,000 blocks) per backspace.
    if !could_be_a_fence_boundary(source, caret) {
        return false;
    }
    let Ok(blocks) = crate::MarkdownDocument::new(source).blocks() else {
        return false;
    };
    blocks
        .iter()
        .any(|block| block_contains_body_start(source, block, caret))
}

/// Whether `caret` could be a code body start, judged from the text alone.
///
/// Both conditions are necessary, so `false` is conclusive and `true` only means
/// the parser still has to decide. Keeping it textual avoids parsing for the
/// common case: typing mid-line, or backspacing inside a paragraph.
fn could_be_a_fence_boundary(source: &str, caret: usize) -> bool {
    let Some(before) = caret.checked_sub(1) else {
        return false;
    };
    // The byte before a body start is the opening fence's newline.
    if source.as_bytes().get(before) != Some(&b'\n') {
        return false;
    }
    // The line ending at that newline is the candidate opening fence, and a fence
    // line begins with three backticks or three tildes after any indentation.
    let line_start = source[..before].rfind('\n').map_or(0, |at| at + 1);
    let line = source[line_start..before].trim_start();
    line.starts_with("```") || line.starts_with("~~~")
}

fn block_contains_body_start(source: &str, block: &SourceBlock, caret: usize) -> bool {
    if code_body_start(source, block) == Some(caret) {
        return true;
    }
    block
        .children
        .iter()
        .any(|child| block_contains_body_start(source, child, caret))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code_block(source: &str) -> SourceBlock {
        crate::MarkdownDocument::new(source)
            .blocks()
            .unwrap()
            .into_iter()
            .find(|block| matches!(block.kind, BlockKind::Code { .. }))
            .expect("a code block")
    }

    #[test]
    fn body_start_is_the_byte_after_the_opening_fence_newline() {
        let source = "```js\nconst n = 1;\n```\n";
        let block = code_block(source);
        let expected = source.find("const").unwrap();
        assert_eq!(code_body_start(source, &block), Some(expected));
        assert!(at_code_body_start(source, expected));
    }

    #[test]
    fn caret_elsewhere_is_not_a_body_start() {
        let source = "```js\nconst n = 1;\n```\n";
        assert!(!at_code_body_start(source, 0));
        assert!(!at_code_body_start(source, source.len()));
        assert!(!at_code_body_start(
            source,
            source.find("const").unwrap() + 1
        ));
    }

    #[test]
    fn plain_paragraph_text_has_no_body_start() {
        assert!(!at_code_body_start("plain text\n", 0));
        assert!(!at_code_body_start("plain text\n", 5));
    }

    #[test]
    fn an_empty_code_block_still_reports_the_boundary() {
        // The body is empty, but the offset right after the opening fence
        // newline is still the boundary a Backspace must not cross.
        let source = "```\n```\n";
        assert!(at_code_body_start(source, 4));
    }

    /// The textual pre-filter must never reject a real boundary.
    ///
    /// It exists so Backspace does not parse the document on every keystroke
    /// (measured at 8.5 ms / 1,000 blocks before the filter). A filter that is
    /// too strict would silently disable the fence guard instead, which is worse
    /// than the cost it saves — so every fence form the parser accepts is checked
    /// against the parser itself.
    #[test]
    fn the_prefilter_accepts_every_fence_form() {
        for source in [
            "```js\ncode\n```\n",
            "~~~js\ncode\n~~~\n",
            "```\ncode\n```\n",
            "  ```js\ncode\n```\n", // indented opener
            "\t```js\ncode\n```\n", // tab-indented opener
            "```js \ncode\n```\n",  // trailing space in the info string
            "```js\n\n```\n",       // body starts with a blank line
        ] {
            let body_start = code_body_start(source, &code_block(source))
                .unwrap_or_else(|| panic!("no body start for {source:?}"));
            assert!(
                could_be_a_fence_boundary(source, body_start),
                "the pre-filter rejected a real boundary in {source:?}"
            );
            assert!(
                at_code_body_start(source, body_start),
                "the full check agrees for {source:?}"
            );
        }
    }

    /// The pre-filter rejects ordinary text without parsing.
    #[test]
    fn the_prefilter_rejects_ordinary_text() {
        // Mid-line: the byte before is not a newline.
        assert!(!could_be_a_fence_boundary("plain text\n", 5));
        // After a newline, but the line above is not a fence.
        assert!(!could_be_a_fence_boundary("plain text\nmore", 11));
        // Start of the document.
        assert!(!could_be_a_fence_boundary("plain text\n", 0));
        // A line that merely contains backticks later on is not a fence opener.
        assert!(!could_be_a_fence_boundary("text ```inline\nbody", 15));
    }

    #[test]
    fn a_non_code_block_has_no_body_start() {
        let source = "# heading\n";
        let block = crate::MarkdownDocument::new(source)
            .blocks()
            .unwrap()
            .into_iter()
            .next()
            .expect("a heading");
        assert_eq!(code_body_start(source, &block), None);
    }
}
