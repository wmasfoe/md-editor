//! Caret movement within a laid-out leaf.
//!
//! gpui-kit reports where a byte index sits and which index a point maps to.
//! It deliberately stops there: moving the caret up or down a visual line is
//! the host's job, because only the host knows which leaf the caret is in and
//! which leaf it should move into.
//!
//! All offsets here are UTF-8 byte offsets into the leaf's own text.

use std::ops::Range;

use gpui_kit::base::text::editor_host::{Caret, LeafGeometry};
use gpui_kit::{Pixels, Point};

/// Which way the caret moves for a vertical key press.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Vertical {
    Up,
    Down,
}

/// The caret one visual line above or below `caret` within `leaf`.
///
/// Returns `None` when the move would leave the leaf. The caller decides what
/// happens next — moving into the neighbouring block, or stopping at the edge.
///
/// The horizontal position is preserved, which is what a reader expects: moving
/// down from the middle of a line lands in the middle of the next one, not at
/// its start. A short line clamps to its own end.
pub fn move_vertical(leaf: &LeafGeometry, caret: Caret, direction: Vertical) -> Option<Caret> {
    move_vertical_with_goal(leaf, caret, direction, None)
}

/// The caret one visual line above or below `caret` within `leaf`, preserving
/// `goal_x` if provided.
pub fn move_vertical_with_goal(
    leaf: &LeafGeometry,
    caret: Caret,
    direction: Vertical,
    goal_x: Option<Pixels>,
) -> Option<Caret> {
    let origin = leaf.position_for_caret(caret);
    let step = leaf.line_height();
    if step <= Pixels::ZERO {
        return None;
    }
    let target_y = match direction {
        Vertical::Up => origin.y - step,
        Vertical::Down => origin.y + step,
    };

    // A caret above the first line or below the last would leave the leaf.
    // The target line has to exist inside the leaf, not merely sit within its
    // bounds. A caret on the last of N lines has `origin.y` at the top of that
    // line, so stepping down lands exactly on `bottom` — inside the box, but on
    // no line. Testing `> bottom` there would report a move that has nowhere to
    // go, which is why the down test is strict at the bottom edge while the up
    // test is strict at the top.
    let bounds = leaf.bounds();
    let top = bounds.origin.y;
    let bottom = bounds.origin.y + bounds.size.height;
    let outside = match direction {
        Vertical::Up => target_y < top,
        Vertical::Down => target_y + step > bottom,
    };
    if outside {
        return None;
    }

    let target_x = goal_x.unwrap_or(origin.x);
    Some(leaf.caret_for_position(Point {
        x: target_x,
        y: target_y,
    }))
}

/// The caret one visual line above `caret`, or `None` at the first line.
pub fn move_up(leaf: &LeafGeometry, caret: Caret) -> Option<Caret> {
    move_vertical(leaf, caret, Vertical::Up)
}

/// The caret one visual line below `caret`, or `None` at the last line.
pub fn move_down(leaf: &LeafGeometry, caret: Caret) -> Option<Caret> {
    move_vertical(leaf, caret, Vertical::Down)
}

/// The caret one character left, clamped at the leaf start.
///
/// Byte offsets must land on a character boundary, so this walks back over a
/// whole UTF-8 sequence rather than one byte: moving left inside "中" must not
/// produce an offset the source cannot slice.
pub fn move_left(text: &str, caret: Caret) -> Caret {
    let index = caret.index.min(text.len());
    let previous = text
        .get(..index)
        .and_then(|prefix| prefix.char_indices().next_back())
        .map_or(0, |(offset, _)| offset);
    Caret::new(previous)
}

/// The caret one character right, clamped at the leaf end.
pub fn move_right(text: &str, caret: Caret) -> Caret {
    let index = caret.index.min(text.len());
    let next = text
        .get(index..)
        .and_then(|rest| rest.chars().next())
        .map_or(text.len(), |character| index + character.len_utf8());
    Caret::new(next)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CharClass {
    Whitespace,
    Word,
    Punctuation,
}

fn char_class(c: char) -> CharClass {
    if c.is_whitespace() {
        CharClass::Whitespace
    } else if c.is_alphanumeric() || c == '_' {
        CharClass::Word
    } else {
        CharClass::Punctuation
    }
}

/// The caret one word backwards, stopping at word or punctuation boundaries.
pub fn move_word_left(text: &str, caret: Caret) -> Caret {
    let index = caret.index.min(text.len());
    if index == 0 {
        return Caret::new(0);
    }
    let chars: Vec<(usize, char)> = text[..index].char_indices().collect();
    if chars.is_empty() {
        return Caret::new(0);
    }
    let mut i = chars.len();
    while i > 0 && char_class(chars[i - 1].1) == CharClass::Whitespace {
        if chars[i - 1].1 == '\n' {
            return Caret::new(chars[i - 1].0);
        }
        i -= 1;
    }
    if i == 0 {
        return Caret::new(0);
    }
    let class = char_class(chars[i - 1].1);
    while i > 0 && char_class(chars[i - 1].1) == class {
        i -= 1;
    }
    Caret::new(chars[i].0)
}

/// The caret one word forward, stopping at word or punctuation boundaries.
pub fn move_word_right(text: &str, caret: Caret) -> Caret {
    let index = caret.index.min(text.len());
    if index >= text.len() {
        return Caret::new(text.len());
    }
    let chars: Vec<(usize, char)> = text[index..]
        .char_indices()
        .map(|(offset, ch)| (index + offset, ch))
        .collect();
    if chars.is_empty() {
        return Caret::new(text.len());
    }
    let mut i = 0;
    while i < chars.len() && char_class(chars[i].1) == CharClass::Whitespace {
        if chars[i].1 == '\n' {
            return Caret::new(chars[i].0 + 1);
        }
        i += 1;
    }
    if i >= chars.len() {
        return Caret::new(text.len());
    }
    let class = char_class(chars[i].1);
    while i < chars.len() && char_class(chars[i].1) == class {
        i += 1;
    }
    if i < chars.len() {
        Caret::new(chars[i].0)
    } else {
        Caret::new(text.len())
    }
}

/// The word range surrounding `index`, suitable for double-click selection.
pub fn word_range_at(text: &str, index: usize) -> Range<usize> {
    let len = text.len();
    if len == 0 {
        return 0..0;
    }
    let index = index.min(len);
    let char_index = if index == len {
        text.char_indices().last().map(|(i, _)| i).unwrap_or(0)
    } else {
        let mut idx = index;
        while idx > 0 && !text.is_char_boundary(idx) {
            idx -= 1;
        }
        idx
    };
    let target_char = text[char_index..].chars().next().unwrap_or(' ');
    let target_class = char_class(target_char);

    let mut start = char_index;
    for (i, ch) in text[..char_index].char_indices().rev() {
        if char_class(ch) == target_class {
            start = i;
        } else {
            break;
        }
    }

    let mut end = char_index + target_char.len_utf8();
    for (i, ch) in text[end..].char_indices() {
        if char_class(ch) == target_class {
            end = char_index + target_char.len_utf8() + i + ch.len_utf8();
        } else {
            break;
        }
    }
    start..end
}

/// The line range surrounding `index`, including any trailing newline, suitable for triple-click selection.
pub fn line_range_at(text: &str, index: usize) -> Range<usize> {
    let len = text.len();
    if len == 0 {
        return 0..0;
    }
    let index = index.min(len);
    let start = text[..index].rfind('\n').map_or(0, |i| i + 1);
    let end = text[index..].find('\n').map_or(len, |i| index + i + 1);
    start..end
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moving_left_walks_a_whole_character() {
        // "中" is three bytes; the caret must never land inside it.
        let text = "a中b";
        let after_cjk = Caret::new(4);
        assert_eq!(move_left(text, after_cjk).index, 1);
        assert_eq!(move_left(text, Caret::new(1)).index, 0);
        assert_eq!(move_left(text, Caret::new(0)).index, 0);
    }

    #[test]
    fn moving_right_walks_a_whole_character() {
        let text = "a中b";
        assert_eq!(move_right(text, Caret::new(0)).index, 1);
        assert_eq!(move_right(text, Caret::new(1)).index, 4);
        assert_eq!(move_right(text, Caret::new(4)).index, 5);
        assert_eq!(move_right(text, Caret::new(5)).index, 5);
    }

    #[test]
    fn moving_past_the_end_clamps() {
        let text = "ab";
        assert_eq!(move_left(text, Caret::new(99)).index, 1);
        assert_eq!(move_right(text, Caret::new(99)).index, 2);
    }

    #[test]
    fn moving_word_left_and_right() {
        let text = "hello world foo.bar";
        assert_eq!(move_word_left(text, Caret::new(11)).index, 6);
        assert_eq!(move_word_left(text, Caret::new(6)).index, 0);
        assert_eq!(move_word_left(text, Caret::new(0)).index, 0);

        assert_eq!(move_word_right(text, Caret::new(0)).index, 5);
        assert_eq!(move_word_right(text, Caret::new(5)).index, 11);
        assert_eq!(move_word_right(text, Caret::new(11)).index, 15);
        assert_eq!(move_word_right(text, Caret::new(15)).index, 16);
        assert_eq!(move_word_right(text, Caret::new(16)).index, 19);
        assert_eq!(move_word_right(text, Caret::new(19)).index, 19);
    }

    #[test]
    fn word_and_line_ranges() {
        let text = "hello world\nsecond line";
        assert_eq!(word_range_at(text, 1), 0..5);
        assert_eq!(word_range_at(text, 7), 6..11);
        assert_eq!(line_range_at(text, 2), 0..12);
        assert_eq!(line_range_at(text, 15), 12..23);
    }
}
