//! Table row and column handles: hover tracking, hit testing and the commands
//! they route to.
//!
//! The geometry and the hit test live in `editor-typeset`, because they are
//! pure functions of laid-out rectangles. This module is the part that needs a
//! view: it keeps the handle groups for the current frame, remembers where the
//! pointer is, and turns a click into a core command.
//!
//! Only insertion is offered here. Delete and alignment stay in the table menu,
//! where the target is named in words instead of implied by a small floating
//! button that is easy to mis-click.

use std::ops::Range;

use gpui_kit::{Bounds, Pixels, Point};
use inkpoint_editor_core::table_edit::{self, TableCellSlot};
use inkpoint_editor_typeset::{
    HandleTarget, PlacedCell, TableHandle, TableHandles, placed_cells, table_handles,
};

/// The handle groups for one frame, plus the pointer position that decides
/// which of them is showing.
#[derive(Default)]
pub(crate) struct TableHandleState {
    groups: Vec<TableHandles>,
    /// Last pointer position over the document, in window coordinates.
    ///
    /// Stored as a point rather than resolved to a target: a rebuild after
    /// scrolling or relayout must re-decide against the new rectangles instead
    /// of pointing at a handle that has moved.
    pointer: Option<Point<Pixels>>,
}

impl TableHandleState {
    /// Rebuilds the groups from the document's tables and this frame's leaves.
    ///
    /// One group per table, so a document with several tables gets one set of
    /// handles per table and never mixes cells across them.
    pub(crate) fn rebuild(
        &mut self,
        slots: &[Vec<TableCellSlot>],
        leaves: &[(Range<usize>, Bounds<Pixels>)],
    ) {
        self.groups = slots
            .iter()
            .map(|table| {
                let placed: Vec<PlacedCell> = placed_cells(table, leaves);
                table_handles(&placed)
            })
            .filter(|handles| !handles.is_empty())
            .collect();
    }

    /// Records where the pointer is, so the next frame reveals the right group.
    pub(crate) fn set_pointer(&mut self, point: Option<Point<Pixels>>) {
        self.pointer = point;
    }

    /// The pointer position, when it is over the document.
    pub(crate) fn pointer(&self) -> Option<Point<Pixels>> {
        self.pointer
    }

    /// The group the pointer is near, which is the one to draw.
    pub(crate) fn visible(&self) -> Option<&TableHandles> {
        let point = self.pointer?;
        self.groups.iter().find(|group| group.shows_for(point))
    }

    /// Whether the handles are currently showing, for change detection.
    pub(crate) fn is_visible(&self) -> bool {
        self.visible().is_some()
    }

    /// Which handle the pointer is over, if any.
    ///
    /// Visibility alone is not enough to decide whether to repaint: moving from
    /// one handle to another keeps the group showing, but the highlight has to
    /// follow the pointer or it stays on the handle the pointer left.
    pub(crate) fn hovered(&self) -> Option<TableHandle> {
        self.hit_at(self.pointer?)
    }

    /// The handle under `point`, when the pointer is on one.
    pub(crate) fn hit_at(&self, point: Point<Pixels>) -> Option<TableHandle> {
        self.groups
            .iter()
            .find(|group| group.shows_for(point))?
            .hit(point)
    }

    /// Every handle of the visible group, paired with whether it is hovered.
    ///
    /// The whole group is drawn, not just the one under the pointer: the set is
    /// what tells the user which rows and columns can take an insert.
    pub(crate) fn visible_handles(&self) -> Vec<(Bounds<Pixels>, bool)> {
        let Some(point) = self.pointer else {
            return Vec::new();
        };
        let Some(group) = self.visible() else {
            return Vec::new();
        };
        group
            .all()
            .iter()
            .map(|handle| (handle.bounds, handle.bounds.contains(&point)))
            .collect()
    }
}

/// The core command for a handle target.
///
/// The target carries a byte offset inside the cell, and the core commands
/// resolve the row or column from that offset. That keeps the row/column
/// arithmetic in one place instead of repeating it per entry point.
///
/// Returns `None` for a target the core cannot represent, which the caller
/// reports as a refusal rather than silently doing nothing.
pub(crate) fn apply(
    target: HandleTarget,
    source: &str,
) -> Option<inkpoint_editor_core::SourceEdit> {
    match target {
        HandleTarget::RowAbove(cell) => table_edit::insert_row_above(source, cell.offset),
        HandleTarget::ColumnLeft(cell) => table_edit::insert_column_left(source, cell.offset),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::{px, size};

    /// A 3x2 table laid out as a grid at (200, 100), 100pt columns, 20pt rows.
    fn grid_slots(source: &str) -> Vec<Vec<TableCellSlot>> {
        let blocks = inkpoint_editor_core::MarkdownDocument::new(source)
            .blocks()
            .expect("the fixture parses");
        table_edit::table_cells_in(source, &blocks)
    }

    fn leaves() -> Vec<(Range<usize>, Bounds<Pixels>)> {
        // Six cells in row-major order, matching the slots the core reports.
        let source = "| a | b |\n| - | - |\n| c | d |\n";
        let mut leaves = Vec::new();
        for (index, needle) in ["a", "b", "-", "-", "c", "d"].iter().enumerate() {
            let at = source.find(needle).expect("the cell text is present");
            let row = index / 2;
            let column = index % 2;
            leaves.push((
                at..at + needle.len(),
                Bounds {
                    origin: Point {
                        x: px(200.0 + column as f32 * 100.0),
                        y: px(100.0 + row as f32 * 20.0),
                    },
                    size: size(px(100.0), px(20.0)),
                },
            ));
        }
        leaves
    }

    /// TABLE-HANDLE-01: the state builds one group per table and reveals it
    /// only while the pointer is near that table.
    #[test]
    fn table_handle01_state_reveals_only_near_the_table() {
        let source = "| a | b |\n| - | - |\n| c | d |\n";
        let mut state = TableHandleState::default();
        state.rebuild(&grid_slots(source), &leaves());
        assert!(!state.is_visible(), "no pointer means nothing showing");

        state.set_pointer(Some(Point {
            x: px(250.0),
            y: px(150.0),
        }));
        assert!(state.is_visible(), "inside the table");
        assert_eq!(state.visible_handles().len(), 3, "one row, two columns");

        state.set_pointer(Some(Point {
            x: px(250.0),
            y: px(600.0),
        }));
        assert!(!state.is_visible(), "far below the table");
        assert!(state.visible_handles().is_empty());
    }

    /// TABLE-HANDLE-01: moving from one handle to another changes which handle
    /// is hovered, even though the group stays visible.
    ///
    /// This is the signal the repaint decision keys off. Without it, dragging
    /// the pointer along a column of handles leaves the highlight on whichever
    /// handle the pointer first touched.
    #[test]
    fn table_handle01_moving_between_handles_changes_the_hovered_one() {
        let source = "| a | b |\n| - | - |\n| c | d |\n";
        let mut state = TableHandleState::default();
        state.rebuild(&grid_slots(source), &leaves());

        // Two different column handles: both keep the group visible.
        let handles = {
            state.set_pointer(Some(Point {
                x: px(250.0),
                y: px(150.0),
            }));
            state
                .visible()
                .expect("the table is showing")
                .all()
                .to_vec()
        };
        let first = handles
            .iter()
            .find(|handle| matches!(handle.target, HandleTarget::ColumnLeft(_)))
            .copied()
            .expect("a column handle exists");
        let second = handles
            .iter()
            .filter(|handle| matches!(handle.target, HandleTarget::ColumnLeft(_)))
            .nth(1)
            .copied()
            .expect("a second column handle exists");

        let centre = |handle: TableHandle| Point {
            x: handle.bounds.origin.x + px(7.0),
            y: handle.bounds.origin.y + px(7.0),
        };

        state.set_pointer(Some(centre(first)));
        assert_eq!(
            state.hovered().map(|handle| handle.target),
            Some(first.target)
        );
        assert!(state.is_visible(), "still showing between the two");

        state.set_pointer(Some(centre(second)));
        assert!(
            state.is_visible(),
            "the group stays visible, so visibility alone cannot detect this move"
        );
        assert_eq!(
            state.hovered().map(|handle| handle.target),
            Some(second.target),
            "the hovered handle must follow the pointer"
        );
        assert_ne!(
            first.target, second.target,
            "the test must move between two distinct handles"
        );
    }

    /// TABLE-HANDLE-01: a click on a handle reports the insert it performs, and
    /// that insert changes the source.
    #[test]
    fn table_handle01_a_handle_click_inserts_a_row() {
        let source = "| a | b |\n| - | - |\n| c | d |\n";
        let mut state = TableHandleState::default();
        state.rebuild(&grid_slots(source), &leaves());

        // The body row's handle sits in the left gutter of the third row.
        let group_point = Point {
            x: px(250.0),
            y: px(150.0),
        };
        state.set_pointer(Some(group_point));
        let row_handle = state
            .visible()
            .expect("the table is showing")
            .all()
            .iter()
            .find(|handle| matches!(handle.target, HandleTarget::RowAbove(_)))
            .copied()
            .expect("the body row has a handle");
        let centre = Point {
            x: row_handle.bounds.origin.x + px(7.0),
            y: row_handle.bounds.origin.y + px(7.0),
        };

        let hit = state.hit_at(centre).expect("the click lands on the handle");
        assert_eq!(hit.target, row_handle.target);

        let edit = apply(hit.target, source).expect("the insert is representable");
        let mut session = inkpoint_editor_core::session::EditorSession::new(source);
        session.apply_edit(edit).expect("the edit applies");
        assert_eq!(
            session.source(),
            "| a | b |\n| - | - |\n|   |   |\n| c | d |\n",
            "a blank body row above the one the handle names"
        );
    }

    /// TABLE-HANDLE-01: a click on a column handle inserts a column.
    #[test]
    fn table_handle01_a_handle_click_inserts_a_column() {
        let source = "| a | b |\n| - | - |\n| c | d |\n";
        let mut state = TableHandleState::default();
        state.rebuild(&grid_slots(source), &leaves());
        state.set_pointer(Some(Point {
            x: px(250.0),
            y: px(150.0),
        }));
        let column_handle = state
            .visible()
            .expect("the table is showing")
            .all()
            .iter()
            .find(|handle| matches!(handle.target, HandleTarget::ColumnLeft(_)))
            .copied()
            .expect("the first column has a handle");

        let edit = apply(column_handle.target, source).expect("the insert is representable");
        let mut session = inkpoint_editor_core::session::EditorSession::new(source);
        session.apply_edit(edit).expect("the edit applies");
        // The new cell is empty, so it renders as the two padding spaces between
        // its pipes. Its delimiter cell cannot be empty — an empty delimiter is
        // not a GFM table — so it gets the default `---` marker.
        assert_eq!(
            session.source(),
            "|  | a | b |\n| --- | - | - |\n|  | c | d |\n",
            "a blank column left of the one the handle names"
        );
    }

    /// TABLE-HANDLE-01: a document with no tables has no groups and no handles,
    /// so a plain paragraph never grows a floating button.
    #[test]
    fn table_handle01_a_document_without_tables_has_no_handles() {
        let mut state = TableHandleState::default();
        state.rebuild(&grid_slots("just a paragraph\n"), &[]);
        state.set_pointer(Some(Point {
            x: px(10.0),
            y: px(10.0),
        }));
        assert!(!state.is_visible());
        assert!(state.visible_handles().is_empty());
        assert_eq!(state.hit_at(Point::default()), None);
    }
}
