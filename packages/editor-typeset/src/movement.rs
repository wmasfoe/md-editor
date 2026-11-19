//! Caret movement within a laid-out leaf.
//!
//! gpui-kit reports where a byte index sits and which index a point maps to.
//! It deliberately stops there: moving the caret up or down a visual line is
//! the host's job, because only the host knows which leaf the caret is in and
//! which leaf it should move into.
//!
//! All offsets here are UTF-8 byte offsets into the leaf's own text.

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

    Some(leaf.caret_for_position(Point {
        x: origin.x,
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
}
