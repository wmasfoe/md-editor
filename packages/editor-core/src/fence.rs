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
    let Ok(blocks) = crate::MarkdownDocument::new(source).blocks() else {
        return false;
    };
    blocks
        .iter()
        .any(|block| block_contains_body_start(source, block, caret))
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
