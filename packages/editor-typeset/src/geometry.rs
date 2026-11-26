//! Caret and hit-testing over laid-out text leaves.
//!
//! gpui-kit reports geometry per keyed leaf; this module turns those reports
//! into the two answers an editor needs: where the caret goes for a click, and
//! which byte index a caret position corresponds to.

use std::collections::HashMap;

use gpui_kit::base::text::editor_host::{Caret, LeafGeometry};
use gpui_kit::{Bounds, Pixels, Point, px, size};

/// Places a font-height caret inside its shaped line box. GPUI uses half the
/// leading above the glyphs, so the unadjusted line origin sits too high.
pub fn caret_bounds_at(leaf: &LeafGeometry, caret: Caret) -> Bounds<Pixels> {
    let height = leaf.caret_height();
    let mut origin = leaf.position_for_caret(caret);
    origin.y += (leaf.line_height() - height) / 2.;
    Bounds {
        origin,
        size: size(px(2.), height),
    }
}

/// Laid-out geometry for every keyed leaf of one rendered frame.
///
/// It is a snapshot, not a handle: later frames do not mutate it, and the
/// caller replaces it after content, width, typography or scroll changes.
#[derive(Clone, Default)]
pub struct LeafIndex {
    leaves: HashMap<u64, LeafGeometry>,
}

impl LeafIndex {
    /// Builds an index from one frame's geometry report.
    pub fn new(leaves: HashMap<u64, LeafGeometry>) -> Self {
        Self { leaves }
    }

    /// The geometry for `key`, when that leaf was laid out this frame.
    pub fn get(&self, key: u64) -> Option<&LeafGeometry> {
        self.leaves.get(&key)
    }

    /// How many leaves were laid out this frame.
    pub fn len(&self) -> usize {
        self.leaves.len()
    }

    /// Whether no leaf was laid out.
    pub fn is_empty(&self) -> bool {
        self.leaves.is_empty()
    }

    /// Every laid-out leaf with its key, in unspecified order.
    pub fn entries(&self) -> impl Iterator<Item = (u64, &LeafGeometry)> {
        self.leaves.iter().map(|(key, leaf)| (*key, leaf))
    }

    /// Every laid-out leaf, in unspecified order.
    pub fn leaves(&self) -> impl Iterator<Item = &LeafGeometry> {
        self.leaves.values()
    }

    /// The caret for a click at `point`, together with the leaf it landed in.
    ///
    /// The key matters as much as the index: a caret index counts bytes from the
    /// leaf's own start, so a caller that only receives the index has no way to
    /// turn it into a document offset. Returning both keeps that pairing intact.
    pub fn caret_and_key_for_point(&self, point: Point<Pixels>) -> Option<(u64, Caret)> {
        let (key, geometry) = self.nearest(point)?;
        Some((key, geometry.caret_for_position(point)))
    }

    /// The caret for a click at `point`, choosing the leaf whose bounds
    /// contain it.
    ///
    /// When the point falls outside every leaf — the gap between blocks, or
    /// below the last one — the nearest leaf by vertical distance wins, so a
    /// click in the margin still places a caret instead of doing nothing.
    pub fn caret_for_point(&self, point: Point<Pixels>) -> Option<Caret> {
        let (_, geometry) = self.nearest(point)?;
        Some(geometry.caret_for_position(point))
    }

    /// The byte index for a click at `point`, within the leaf that owns it.
    pub fn index_for_point(&self, point: Point<Pixels>) -> Option<usize> {
        let (_, geometry) = self.nearest(point)?;
        Some(geometry.index_for_position(point))
    }

    /// The leaf whose bounds contain `point`, else the nearest one by weighted distance.
    fn nearest(&self, point: Point<Pixels>) -> Option<(u64, &LeafGeometry)> {
        let mut fallback: Option<(u64, &LeafGeometry, f32)> = None;
        for (key, geometry) in &self.leaves {
            let bounds = geometry.bounds();
            if bounds.contains(&point) {
                return Some((*key, geometry));
            }
            let dx = if point.x < bounds.origin.x {
                (bounds.origin.x - point.x).as_f32()
            } else if point.x > bounds.origin.x + bounds.size.width {
                (point.x - (bounds.origin.x + bounds.size.width)).as_f32()
            } else {
                0.0
            };
            let dy = if point.y < bounds.origin.y {
                (bounds.origin.y - point.y).as_f32()
            } else if point.y > bounds.origin.y + bounds.size.height {
                (point.y - (bounds.origin.y + bounds.size.height)).as_f32()
            } else {
                0.0
            };
            // Vertical distance is primary, horizontal distance disambiguates leaves
            // on the same line (such as table cells in the same row).
            let dist = dy * 1000.0 + dx;
            let better = fallback.as_ref().is_none_or(|(_, _, best)| dist < *best);
            if better {
                fallback = Some((*key, geometry, dist));
            }
        }
        fallback.map(|(key, geometry, _)| (key, geometry))
    }
}

/// The caret for a click at `point` across the whole frame.
pub fn caret_at(index: &LeafIndex, point: Point<Pixels>) -> Option<Caret> {
    index.caret_for_point(point)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_index_has_no_caret() {
        let index = LeafIndex::default();
        assert!(index.is_empty());
        assert!(index.caret_for_point(Point::default()).is_none());
    }
}
