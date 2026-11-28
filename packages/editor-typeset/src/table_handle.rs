//! Where the table row and column handles sit, and which one a pointer hits.
//!
//! A handle is not part of the table's own layout: it floats in the gutter to
//! the left of a row and above a column, so it cannot disturb the text. That
//! makes placement a pure function of the cells' rectangles, which is why this
//! module owns it: the caller supplies the laid-out rectangles it already has,
//! and gets back both the rectangles to draw and the hit test to route a click.
//!
//! Keeping it here rather than in the GPUI view means the geometry is testable
//! with synthetic rectangles — no window, no fonts, no frame.

use std::ops::Range;

use gpui_kit::{Bounds, Pixels, Point, px, size};
use inkpoint_editor_core::table_edit::{TableCell, TableCellSlot};

/// A cell address paired with the rectangle it was laid out in.
///
/// The rectangle is in the same coordinate space the caller hit-tested in, so
/// the resulting handles need no further transformation.
#[derive(Clone, Copy, Debug)]
pub struct PlacedCell {
    /// The cell's address in the table.
    pub cell: TableCell,
    /// The cell's laid-out rectangle.
    pub bounds: Bounds<Pixels>,
}

/// A handle the pointer can hit, with the rectangle it occupies.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TableHandle {
    /// What clicking this handle inserts relative to.
    pub target: HandleTarget,
    /// Where to draw it and what the hit test covers.
    pub bounds: Bounds<Pixels>,
}

/// What a handle click means.
///
/// Only insertion is offered: delete and alignment are destructive or
/// structural choices that belong in the table menu, where the target is named
/// in words instead of implied by a small floating button.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HandleTarget {
    /// Insert a body row above the row of this cell.
    RowAbove(TableCell),
    /// Insert a column to the left of this cell's column.
    ColumnLeft(TableCell),
}

/// The handles for one table, in a stable order.
#[derive(Clone, Debug, Default)]
pub struct TableHandles {
    handles: Vec<TableHandle>,
    /// The table's own rectangle, which anchors the reveal region.
    anchor: Bounds<Pixels>,
}

impl TableHandles {
    /// Every handle, in draw order.
    pub fn all(&self) -> &[TableHandle] {
        &self.handles
    }

    /// Whether there is nothing to draw.
    pub fn is_empty(&self) -> bool {
        self.handles.is_empty()
    }

    /// The handle containing `point`, when the pointer is over one.
    ///
    /// Row handles are checked before column handles: they overlap in the
    /// table's top-left corner, and inserting a row is the more frequent
    /// intent there.
    pub fn hit(&self, point: Point<Pixels>) -> Option<TableHandle> {
        self.handles
            .iter()
            .find(|handle| handle.bounds.contains(&point))
            .copied()
    }

    /// Whether these handles should be showing for a pointer at `point`.
    ///
    /// The reveal region is the table plus the gutters the handles live in, so
    /// moving the pointer onto a handle does not hide it before the click
    /// lands. Handles are hidden otherwise: they are an affordance, not part of
    /// the document, and drawing them permanently would clutter every table.
    pub fn shows_for(&self, point: Point<Pixels>) -> bool {
        if self.handles.is_empty() {
            return false;
        }
        let margin = px(HANDLE_GAP + HANDLE_SIZE);
        let region = Bounds {
            origin: Point {
                x: self.anchor.origin.x - margin,
                y: self.anchor.origin.y - margin,
            },
            size: size(
                self.anchor.size.width + margin * 2.,
                self.anchor.size.height + margin * 2.,
            ),
        };
        region.contains(&point)
    }

    /// The handle whose target equals `target`, for tests and for repainting a
    /// hovered handle after the pointer leaves the gutter.
    pub fn find(&self, target: HandleTarget) -> Option<TableHandle> {
        self.handles
            .iter()
            .find(|handle| handle.target == target)
            .copied()
    }
}

/// Pairs each cell slot with the rectangle of the leaf that renders it.
///
/// A slot is the cell's raw byte range, padding included; a leaf span is the
/// trimmed content range the projection registered. The leaf that renders a
/// cell is therefore the one whose span sits inside that cell's slot. Cells
/// without a laid-out leaf are dropped: they are scrolled out of view or could
/// not be mapped, and a handle drawn from a guessed rectangle would float
/// beside the wrong row.
pub fn placed_cells(
    slots: &[TableCellSlot],
    leaves: &[(Range<usize>, Bounds<Pixels>)],
) -> Vec<PlacedCell> {
    let mut placed = Vec::with_capacity(slots.len());
    for slot in slots {
        let leaf = leaves
            .iter()
            .find(|(span, _)| span.start >= slot.range.start && span.end <= slot.range.end);
        if let Some((_, bounds)) = leaf {
            placed.push(PlacedCell {
                cell: slot.cell,
                bounds: *bounds,
            });
        }
    }
    placed
}

/// The size of a handle's clickable square.
pub const HANDLE_SIZE: f32 = 14.0;
/// The gap between a handle and the table edge it floats beside.
pub const HANDLE_GAP: f32 = 4.0;

/// Builds the handles for one table from its placed cells.
///
/// Row handles exist only for content rows. The header and delimiter are table
/// structure: a handle there would offer "insert above", which is exactly what
/// the first body row's handle already does, so it would be a second button for
/// one edit.
///
/// Column handles exist for every column, because inserting a column left of
/// the first column is a distinct, useful edit.
pub fn table_handles(cells: &[PlacedCell]) -> TableHandles {
    let Some(first) = cells.first() else {
        return TableHandles::default();
    };
    let rows = first.cell.rows;
    let columns = first.cell.columns;
    if rows == 0 || columns == 0 {
        return TableHandles::default();
    }

    // The table's left edge and top edge anchor the two gutters. Cells can be
    // ragged, so these come from the cells that exist rather than from a
    // computed grid.
    let left = cells
        .iter()
        .map(|cell| cell.bounds.origin.x)
        .fold(first.bounds.origin.x, Pixels::min);
    let top = cells
        .iter()
        .map(|cell| cell.bounds.origin.y)
        .fold(first.bounds.origin.y, Pixels::min);

    let side = px(HANDLE_SIZE);
    let gap = px(HANDLE_GAP);
    let mut handles = Vec::with_capacity(rows.saturating_sub(2) + columns);

    // Row handles: one per content row, in the left gutter, vertically centred
    // on the row's own line box.
    for row in 2..rows {
        let row_cells: Vec<_> = cells.iter().filter(|cell| cell.cell.row == row).collect();
        let Some(sample) = row_cells.first() else {
            continue;
        };
        let bounds = row_bounds(&row_cells);
        handles.push(TableHandle {
            target: HandleTarget::RowAbove(sample.cell),
            bounds: Bounds {
                origin: Point {
                    x: left - gap - side,
                    y: bounds.origin.y + (bounds.size.height - side) / 2.,
                },
                size: size(side, side),
            },
        });
    }

    // Column handles: one per column, in the top gutter, horizontally centred
    // on the column's span.
    for column in 0..columns {
        let column_cells: Vec<_> = cells
            .iter()
            .filter(|cell| cell.cell.column == column)
            .collect();
        let Some(sample) = column_cells.first() else {
            continue;
        };
        let bounds = column_bounds(&column_cells);
        handles.push(TableHandle {
            target: HandleTarget::ColumnLeft(sample.cell),
            bounds: Bounds {
                origin: Point {
                    x: bounds.origin.x + (bounds.size.width - side) / 2.,
                    y: top - gap - side,
                },
                size: size(side, side),
            },
        });
    }

    let anchor = union(cells.iter().map(|cell| cell.bounds));
    TableHandles { handles, anchor }
}

/// The union of one row's cell rectangles.
fn row_bounds(cells: &[&PlacedCell]) -> Bounds<Pixels> {
    union(cells.iter().map(|cell| cell.bounds))
}

/// The union of one column's cell rectangles.
fn column_bounds(cells: &[&PlacedCell]) -> Bounds<Pixels> {
    union(cells.iter().map(|cell| cell.bounds))
}

fn union(mut bounds: impl Iterator<Item = Bounds<Pixels>>) -> Bounds<Pixels> {
    let Some(first) = bounds.next() else {
        return Bounds::default();
    };
    bounds.fold(first, |acc, next| acc.union(&next))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 3x2 table laid out as a grid: column width 100, row height 20, with the
    /// table's top-left corner at (200, 100).
    fn grid() -> Vec<PlacedCell> {
        let mut cells = Vec::new();
        for row in 0..3 {
            for column in 0..2 {
                cells.push(PlacedCell {
                    cell: TableCell {
                        row,
                        column,
                        rows: 3,
                        columns: 2,
                        offset: 0,
                    },
                    bounds: Bounds {
                        origin: Point {
                            x: px(200.0 + column as f32 * 100.0),
                            y: px(100.0 + row as f32 * 20.0),
                        },
                        size: size(px(100.0), px(20.0)),
                    },
                });
            }
        }
        cells
    }

    /// TABLE-HANDLE-01: content rows get one handle each, in the left gutter,
    /// vertically centred on their own line. Header and delimiter get none.
    #[test]
    fn table_handle01_content_rows_get_a_left_gutter_handle() {
        let handles = table_handles(&grid());
        let row_handles: Vec<_> = handles
            .all()
            .iter()
            .filter(|handle| matches!(handle.target, HandleTarget::RowAbove(_)))
            .collect();
        assert_eq!(
            row_handles.len(),
            1,
            "only row 2 is content in a 3-row table"
        );
        let handle = row_handles[0];
        let HandleTarget::RowAbove(cell) = handle.target else {
            unreachable!("filtered above");
        };
        assert_eq!(cell.row, 2);
        // Left of the table edge (200) by gap (4) + size (14).
        assert_eq!(handle.bounds.origin.x, px(200.0 - 4.0 - 14.0));
        // Centred on row 2's line box, which spans y 140..160.
        assert_eq!(handle.bounds.origin.y, px(140.0 + (20.0 - 14.0) / 2.));
        assert_eq!(handle.bounds.size.width, px(14.0));
        assert_eq!(handle.bounds.size.height, px(14.0));
    }

    /// TABLE-HANDLE-01: every column gets a handle in the top gutter, centred
    /// on that column's own horizontal span.
    #[test]
    fn table_handle01_every_column_gets_a_top_gutter_handle() {
        let handles = table_handles(&grid());
        let column_handles: Vec<_> = handles
            .all()
            .iter()
            .filter(|handle| matches!(handle.target, HandleTarget::ColumnLeft(_)))
            .collect();
        assert_eq!(column_handles.len(), 2);
        for (index, handle) in column_handles.iter().enumerate() {
            let HandleTarget::ColumnLeft(cell) = handle.target else {
                unreachable!("filtered above");
            };
            assert_eq!(cell.column, index);
            // Centred within the column's 100pt span.
            assert_eq!(
                handle.bounds.origin.x,
                px(200.0 + index as f32 * 100.0 + (100.0 - 14.0) / 2.)
            );
            // Above the table's top edge (100) by gap (4) + size (14).
            assert_eq!(handle.bounds.origin.y, px(100.0 - 4.0 - 14.0));
        }
    }

    /// TABLE-HANDLE-01: a point on a handle reports that handle; a point on the
    /// text reports none, so a click in the document still places a caret.
    #[test]
    fn table_handle01_a_click_hits_a_handle_only_inside_its_rectangle() {
        let handles = table_handles(&grid());
        let row = handles
            .find(HandleTarget::RowAbove(TableCell {
                row: 2,
                column: 0,
                rows: 3,
                columns: 2,
                offset: 0,
            }))
            .expect("the body row has a handle");
        let centre = Point {
            x: row.bounds.origin.x + px(7.0),
            y: row.bounds.origin.y + px(7.0),
        };
        assert_eq!(handles.hit(centre), Some(row), "inside the handle");
        assert_eq!(
            handles.hit(Point {
                x: px(250.0),
                y: px(150.0)
            }),
            None,
            "inside the table text, which must place a caret instead"
        );
    }

    /// TABLE-HANDLE-01: a table with no body rows has no row handle, but still
    /// offers column handles, because the header is a real row to insert beside.
    #[test]
    fn table_handle01_a_header_only_table_still_offers_column_handles() {
        let cells: Vec<_> = (0..2)
            .map(|row| PlacedCell {
                cell: TableCell {
                    row,
                    column: 0,
                    rows: 2,
                    columns: 1,
                    offset: 0,
                },
                bounds: Bounds {
                    origin: Point {
                        x: px(0.0),
                        y: px(row as f32 * 20.0),
                    },
                    size: size(px(100.0), px(20.0)),
                },
            })
            .collect();
        let handles = table_handles(&cells);
        assert!(
            handles
                .all()
                .iter()
                .all(|handle| matches!(handle.target, HandleTarget::ColumnLeft(_))),
            "no body rows means no row handles"
        );
        assert_eq!(handles.all().len(), 1, "one column handle");
    }

    /// TABLE-HANDLE-01: a ragged row's handle still lands on that row's line,
    /// even though the row has fewer cells than the header.
    #[test]
    fn table_handle01_a_ragged_row_handle_uses_the_cells_it_has() {
        let cells = vec![
            PlacedCell {
                cell: TableCell {
                    row: 0,
                    column: 0,
                    rows: 3,
                    columns: 2,
                    offset: 0,
                },
                bounds: Bounds {
                    origin: Point {
                        x: px(0.0),
                        y: px(0.0),
                    },
                    size: size(px(100.0), px(20.0)),
                },
            },
            PlacedCell {
                cell: TableCell {
                    row: 2,
                    column: 0,
                    rows: 3,
                    columns: 2,
                    offset: 0,
                },
                bounds: Bounds {
                    origin: Point {
                        x: px(0.0),
                        y: px(40.0),
                    },
                    size: size(px(100.0), px(20.0)),
                },
            },
        ];
        let handles = table_handles(&cells);
        let row = handles
            .find(HandleTarget::RowAbove(TableCell {
                row: 2,
                column: 0,
                rows: 3,
                columns: 2,
                offset: 0,
            }))
            .expect("the ragged row still has a handle");
        assert_eq!(row.bounds.origin.y, px(40.0 + (20.0 - 14.0) / 2.));
    }

    /// TABLE-HANDLE-01: handles show near the table and hide away from it, and
    /// moving onto a handle keeps it showing so the click can land.
    #[test]
    fn table_handle01_handles_reveal_near_the_table_only() {
        let handles = table_handles(&grid());
        let row = handles
            .find(HandleTarget::RowAbove(TableCell {
                row: 2,
                column: 0,
                rows: 3,
                columns: 2,
                offset: 0,
            }))
            .expect("the body row has a handle");
        let centre = Point {
            x: row.bounds.origin.x + px(7.0),
            y: row.bounds.origin.y + px(7.0),
        };
        assert!(handles.shows_for(centre), "the pointer is on a handle");
        assert!(
            handles.shows_for(Point {
                x: px(250.0),
                y: px(150.0)
            }),
            "the pointer is inside the table"
        );
        assert!(
            !handles.shows_for(Point {
                x: px(250.0),
                y: px(400.0)
            }),
            "far below the table"
        );
    }

    /// TABLE-HANDLE-01: no cells means no handles, not a panic.
    #[test]
    fn table_handle01_an_empty_table_has_no_handles() {
        let handles = table_handles(&[]);
        assert!(handles.is_empty());
        assert_eq!(handles.hit(Point::default()), None);
    }
}
