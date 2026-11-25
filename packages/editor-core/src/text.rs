//! Text offset arithmetic the platform boundary needs.
//!
//! A Markdown source is indexed in UTF-8 bytes, because that is what slicing a
//! `&str` requires and what every edit range in this crate uses. The platform
//! input contract is UTF-16, because that is what macOS and Windows text input
//! report. Converting between the two is pure string arithmetic with no GUI
//! dependency, so it lives here rather than in the view that happens to call it.
//!
//! Getting this wrong is visible: an offset off by one inside a CJK character
//! puts the IME composing region in the wrong place, or makes a caret land
//! mid-character where the source cannot be sliced.

/// Converts a UTF-8 byte offset to a UTF-16 code-unit offset.
///
/// Offsets past the end clamp to the string length, so a stale offset from a
/// platform event cannot panic.
pub fn utf16_offset(text: &str, byte: usize) -> usize {
    let byte = byte.min(text.len());
    text.get(..byte)
        .map_or(0, |prefix| prefix.encode_utf16().count())
}

/// Converts a UTF-16 code-unit offset to a UTF-8 byte offset.
///
/// An offset that lands inside a surrogate pair rounds down to the character
/// start, because every byte offset this crate accepts must be a char boundary.
pub fn byte_offset(text: &str, utf16: usize) -> usize {
    let mut units = 0;
    for (byte, character) in text.char_indices() {
        units += character.len_utf16();
        if units > utf16 {
            return byte;
        }
        if units == utf16 {
            return byte + character.len_utf8();
        }
    }
    text.len()
}

/// The byte offset where `line` starts, counting from one.
///
/// Out-of-range lines clamp: line 0 and line 1 both give the document start, and
/// a line past the end gives the offset after the last newline. The outline uses
/// this to jump to a heading, so an off-by-one here lands the caret on the wrong
/// block.
pub fn line_start(source: &str, line: usize) -> usize {
    if line <= 1 {
        return 0;
    }
    let mut current = 1;
    for (index, byte) in source.bytes().enumerate() {
        if byte == b'\n' {
            current += 1;
            if current == line {
                return index + 1;
            }
        }
    }
    source.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_offsets_map_one_to_one() {
        let text = "hello";
        assert_eq!(utf16_offset(text, 0), 0);
        assert_eq!(utf16_offset(text, 3), 3);
        assert_eq!(byte_offset(text, 3), 3);
    }

    #[test]
    fn a_cjk_character_is_one_utf16_unit_and_three_bytes() {
        // "中" is one UTF-16 unit and three UTF-8 bytes.
        let text = "a中b";
        assert_eq!(utf16_offset(text, 1), 1);
        assert_eq!(utf16_offset(text, 4), 2);
        assert_eq!(byte_offset(text, 1), 1);
        assert_eq!(byte_offset(text, 2), 4);
    }

    #[test]
    fn an_emoji_uses_a_surrogate_pair() {
        let text = "a😀b";
        assert_eq!(utf16_offset(text, 1), 1);
        assert_eq!(utf16_offset(text, 5), 3);
        assert_eq!(byte_offset(text, 3), 5);
    }

    #[test]
    fn an_offset_inside_a_surrogate_pair_rounds_to_the_character_start() {
        let text = "a😀b";
        // UTF-16 offset 2 is the middle of the surrogate pair.
        assert_eq!(byte_offset(text, 2), 1);
    }

    #[test]
    fn offsets_past_the_end_clamp() {
        let text = "abc";
        assert_eq!(utf16_offset(text, 99), 3);
        assert_eq!(byte_offset(text, 99), 3);
    }

    #[test]
    fn the_first_line_starts_at_the_document_start() {
        let source = "one\ntwo\nthree\n";
        assert_eq!(line_start(source, 0), 0);
        assert_eq!(line_start(source, 1), 0);
    }

    #[test]
    fn each_line_starts_after_the_previous_newline() {
        let source = "one\ntwo\nthree\n";
        assert_eq!(&source[line_start(source, 2)..], "two\nthree\n");
        assert_eq!(&source[line_start(source, 3)..], "three\n");
    }

    #[test]
    fn a_line_past_the_end_clamps_to_the_end() {
        let source = "one\ntwo\n";
        assert_eq!(line_start(source, 99), source.len());
    }
}
