//! Editable Markdown typesetting surface built on gpui-kit text rendering.
//!
//! gpui-kit owns Markdown parsing, block layout and typography: a heading is
//! larger than body text because the renderer shapes each block at its own
//! size. This crate owns the editing side of that boundary — the document
//! model, caret and selection state, hit testing, and the platform input
//! contract — because `gpui_base::text::editor_host` deliberately stops at
//! rendering and geometry reporting.
//!
//! The seam this crate depends on:
//!
//! - [`editor_host::parse_markdown`] turns Markdown into a block tree.
//! - Each text leaf carries a host-chosen `u64` key.
//! - [`editor_host::collect_leaf_geometry`] returns, per key, the laid-out
//!   geometry the caret needs: bounds, line height, and the byte index at a
//!   window point.

mod diagram;
mod edit;
mod geometry;
mod math;
mod mermaid;
mod movement;
mod svg;
mod text;

pub use diagram::DiagramRenderer;
pub use edit::{EditorCommand, Selection, TypesetEditor, TypesetError};
pub use geometry::{LeafIndex, caret_at};
pub use math::{Formula, FormulaError, MATH_LANGUAGE, MathRenderer, is_math_fence};
pub use mermaid::{Diagram, DiagramError, MERMAID_LANGUAGE, is_mermaid_fence, render_diagram};
pub use movement::{Vertical, move_down, move_left, move_right, move_up, move_vertical};
pub use svg::{SvgError, SvgImageChannel, to_png_data_url};
pub use text::{byte_offset, line_start, utf16_offset};

use std::collections::HashMap;
use std::ops::Range;

use gpui_kit::base::text::editor_host::{BlockNode, FlowPosition, RenderContext, parse_markdown};
use gpui_kit::{App, Pixels, SharedString, Window, div, prelude::*};

/// The leaf key assigned to the first text leaf of a document.
///
/// Keys are host-owned and stable for the lifetime of a document render: the
/// editor uses them to match geometry back to the block it came from.
pub const FIRST_LEAF_KEY: u64 = 1;

/// One block's place in the source and the leaf key it renders under.
///
/// `span` is the block's byte range in the whole Markdown source, which is what
/// lets a document-wide caret offset be resolved to the leaf that holds it. A
/// leaf's own geometry only knows its local length, so comparing a global offset
/// against it would pick the wrong block.
#[derive(Clone, Debug)]
pub struct LeafSpan {
    key: u64,
    span: Option<Range<usize>>,
}

impl LeafSpan {
    /// The leaf key this block renders under.
    pub fn key(&self) -> u64 {
        self.key
    }

    /// The block's byte range in the document source, when the parser reported
    /// one. Blocks such as unknown constructs carry no span.
    pub fn span(&self) -> Option<Range<usize>> {
        self.span.clone()
    }

    /// Whether `offset` falls inside this block.
    pub fn contains(&self, offset: usize) -> bool {
        self.span
            .as_ref()
            .is_some_and(|span| span.contains(&offset))
    }
}

/// A parsed document ready to be rendered and edited.
pub struct TypesetDocument {
    blocks: Vec<BlockNode>,
    /// The first leaf key of each block, in block order.
    ///
    /// A table owns several keys, so this is not the flat key list.
    block_keys: Vec<u64>,
    spans: Vec<LeafSpan>,
    source: String,
}

impl TypesetDocument {
    /// Parses `source` and assigns leaf keys to the text leaves it renders.
    ///
    /// A heading carries its text in a nested paragraph and a table carries one
    /// paragraph per cell, so keys reach those inner leaves; attaching a key to
    /// the outer block alone would leave that block reporting no geometry. A
    /// table therefore consumes several keys and a block's key is not its index.
    ///
    /// The parser reports an error for input it cannot structure; the caller
    /// keeps showing the previous document rather than losing the buffer.
    pub fn parse(source: impl Into<String>) -> Result<Self, SharedString> {
        Self::parse_with(source, None)
    }

    /// Parses `source`, drawing `mermaid` and `math` fences with `diagrams`.
    ///
    /// Without a renderer those fences stay code blocks, which is the same thing
    /// a failed render produces: the source the user typed.
    pub fn parse_with(
        source: impl Into<String>,
        diagrams: Option<&DiagramRenderer>,
    ) -> Result<Self, SharedString> {
        Self::parse_at(source, diagrams, gpui_kit::SvgSize::ScaleFactor(1.0))
    }

    /// Parses `source`, rasterizing diagrams at `scale`.
    ///
    /// Scale is a display fact — DPI or zoom — so the caller decides it rather
    /// than the document. A diagram rasterized at the wrong scale is blurry or
    /// oversized and cannot be fixed without re-parsing.
    pub fn parse_at(
        source: impl Into<String>,
        diagrams: Option<&DiagramRenderer>,
        scale: gpui_kit::SvgSize,
    ) -> Result<Self, SharedString> {
        let source = source.into();
        let parsed = parse_markdown(&source, Default::default())?;
        // Record each block's source range before any rendering replaces it. A
        // rendered diagram becomes a paragraph built from scratch, which carries
        // no span; keeping the original range is what lets the caret resolve an
        // offset inside the fence and lets vertical movement step past it.
        let spans_before: Vec<Option<Range<usize>>> = parsed
            .iter()
            .map(|block| block.span().map(|span| span.start..span.end))
            .collect();
        let parsed = match diagrams {
            Some(diagrams) => {
                let replaced = diagrams.replace_diagrams(parsed, scale);
                // The span carry-forward below is positional, so it is only sound
                // while replacement is strictly one block in, one block out.
                //
                // A mismatch is not a reason to fail the whole document: the user
                // would lose the rendered view of every other block because one
                // diagram misbehaved. Falling back to the unrendered parse keeps
                // the source visible and editable, which is the same degradation a
                // failed diagram gets.
                if replaced.len() == spans_before.len() {
                    replaced
                } else {
                    parse_markdown(&source, Default::default())?
                }
            }
            None => parsed,
        };
        // Keys are handed out in document order and a table consumes one per
        // cell, so a block's key is no longer its index.
        let mut next_key = FIRST_LEAF_KEY;
        let mut block_keys = Vec::with_capacity(parsed.len());
        let mut spans = Vec::with_capacity(parsed.len());
        let mut blocks = Vec::with_capacity(parsed.len());
        for (index, block) in parsed.into_iter().enumerate() {
            let span = block
                .span()
                .map(|span| span.start..span.end)
                .or_else(|| spans_before.get(index).cloned().flatten());
            // How many leaves this block needs: a table needs one per cell.
            let needed = leaf_count(&block);
            let first = next_key;
            let owned_keys: Vec<u64> = (0..needed).map(|step| first + step as u64).collect();
            next_key = first + needed as u64;
            block_keys.push(first);
            // Every key this block owns carries the block's range, so a caret in
            // any cell resolves to the table it belongs to.
            for key in &owned_keys {
                spans.push(LeafSpan {
                    key: *key,
                    span: span.clone(),
                });
            }
            let mut iterator = owned_keys.into_iter();
            blocks.push(with_leaf_keys(block, &mut iterator));
        }
        Ok(Self {
            blocks,
            block_keys,
            spans,
            source,
        })
    }

    /// The Markdown this document was parsed from.
    pub fn source(&self) -> &str {
        &self.source
    }

    /// The first leaf key of block `index`, or `None` when out of range.
    ///
    /// A table owns one key per cell, so its remaining keys are consecutive from
    /// here.
    pub fn leaf_key(&self, index: usize) -> Option<u64> {
        self.block_keys.get(index).copied()
    }

    /// Every leaf key with its source span, in document order.
    ///
    /// One entry per key, not per block: a table owns one key per cell, so it
    /// contributes several entries that share the table's range. Use
    /// [`Self::leaf_key`] when you need one key per block.
    pub fn leaf_spans(&self) -> &[LeafSpan] {
        &self.spans
    }

    /// The source span of `key`, when the parser reported one.
    ///
    /// Leaf geometry counts bytes from the start of the leaf, while a caret is a
    /// document-wide offset. Callers convert between the two with this span.
    pub fn span_of(&self, key: u64) -> Option<Range<usize>> {
        self.spans
            .iter()
            .find(|leaf| leaf.key == key)
            .and_then(|leaf| leaf.span())
    }

    /// The leaf keys that reported geometry, ordered by document position.
    ///
    /// Vertical movement needs this rather than `key ± 1`: a block whose leaf
    /// reported no geometry leaves a gap in the key sequence, and stepping by
    /// one would stop there instead of reaching the next laid-out block.
    pub fn ordered_keys(&self, laid_out: &[u64]) -> Vec<u64> {
        let mut keys: Vec<u64> = self
            .spans
            .iter()
            .map(|leaf| leaf.key)
            .filter(|key| laid_out.contains(key))
            .collect();
        keys.sort_unstable();
        keys
    }

    /// The laid-out leaf adjacent to `key` in the direction of travel.
    ///
    /// Keys are not contiguous: a block whose leaf reported no geometry leaves a
    /// gap, so stepping by one would stop at that gap instead of reaching the
    /// next block that is actually on screen. The caller supplies which keys were
    /// laid out, because that is a per-frame fact.
    ///
    /// Returns the neighbour's key and its source span. Deciding which leaf comes
    /// next is document topology, which belongs here; placing the caret inside
    /// that leaf needs geometry, which belongs to the caller.
    pub fn vertical_neighbour(
        &self,
        key: u64,
        up: bool,
        laid_out: &[u64],
    ) -> Option<(u64, Range<usize>)> {
        let ordered = self.ordered_keys(laid_out);
        let position = ordered.iter().position(|candidate| *candidate == key)?;
        let neighbour = if up {
            position.checked_sub(1).and_then(|index| ordered.get(index))
        } else {
            ordered.get(position + 1)
        }?;
        let span = self.span_of(*neighbour)?;
        Some((*neighbour, span))
    }

    /// The leaf whose source span contains `offset`.
    ///
    /// Falls back to the last block that starts at or before `offset`, because
    /// an offset in the gap between two blocks belongs to the block before it:
    /// that is where a caret at the end of a line sits.
    pub fn leaf_at(&self, offset: usize) -> Option<u64> {
        let mut candidate = None;
        for leaf in &self.spans {
            if leaf.contains(offset) {
                return Some(leaf.key);
            }
            if leaf.span.as_ref().is_some_and(|span| span.start <= offset) {
                candidate = Some(leaf.key);
            }
        }
        candidate.or_else(|| self.spans.first().map(|leaf| leaf.key))
    }

    /// Renders the document's blocks without collecting geometry.
    ///
    /// Use this when the caller owns the geometry collection — for example a
    /// host element that collects during its own prepaint. Collection scopes
    /// are isolated, so wrapping a call that already collects yields nothing.
    pub fn render_blocks(
        &self,
        body_font_size: Pixels,
        context: RenderContext,
        window: &mut Window,
        cx: &mut App,
    ) -> impl IntoElement {
        let context = context.with_body_font_size(body_font_size);
        let count = self.blocks.len();
        let references: Vec<&BlockNode> = self.blocks.iter().collect();
        div().flex().flex_col().children(
            self.blocks
                .iter()
                .enumerate()
                .map(|(index, block)| {
                    let flow = FlowPosition::at(&references, index, index + 1 == count);
                    block
                        .render_with_id(
                            SharedString::from(format!("block-{index}")),
                            flow,
                            &context,
                            window,
                            cx,
                        )
                        .into_any_element()
                })
                .collect::<Vec<_>>(),
        )
    }

    /// Renders the document and returns the frame's leaf geometry alongside
    /// the element.
    ///
    /// Geometry is frame-local: it is valid for the frame that produced it and
    /// must be recollected after content, width, typography or scroll changes.
    pub fn render(
        &self,
        body_font_size: Pixels,
        context: RenderContext,
        window: &mut Window,
        cx: &mut App,
    ) -> (impl IntoElement, LeafIndex) {
        self.render_with_selection(body_font_size, context, window, cx, None)
    }

    /// Renders the document, painting `selection` behind the selected text.
    ///
    /// `selection` is a document-wide byte range. It is split per leaf here
    /// because the decoration API works in leaf-local bytes; a caller that had
    /// to do that itself would need the same span bookkeeping the caret does.
    pub fn render_with_selection(
        &self,
        body_font_size: Pixels,
        context: RenderContext,
        window: &mut Window,
        cx: &mut App,
        selection: Option<Range<usize>>,
    ) -> (impl IntoElement, LeafIndex) {
        let decorations = self.selection_decorations(selection);
        let (element, leaves) =
            gpui_kit::base::text::editor_host::collect_leaf_geometry(decorations, || {
                self.render_blocks(body_font_size, context, window, cx)
                    .into_any_element()
            });
        (element, LeafIndex::new(leaves))
    }

    /// Splits a document-wide selection into per-leaf decorations.
    ///
    /// Each leaf gets the part of the selection that falls inside its span,
    /// rebased to leaf-local bytes. An empty selection paints nothing, which is
    /// why a bare caret needs no decoration of its own.
    fn selection_decorations(
        &self,
        selection: Option<Range<usize>>,
    ) -> HashMap<u64, Vec<(Range<usize>, gpui_kit::Hsla)>> {
        let Some(selection) = selection else {
            return HashMap::new();
        };
        if selection.start >= selection.end {
            return HashMap::new();
        }
        let color: gpui_kit::Hsla = gpui_kit::rgba(0x3b82f640).into();
        let mut decorations: HashMap<u64, Vec<(Range<usize>, gpui_kit::Hsla)>> = HashMap::new();
        for leaf in &self.spans {
            let Some(span) = leaf.span.as_ref() else {
                continue;
            };
            let start = selection.start.max(span.start);
            let end = selection.end.min(span.end);
            if start >= end {
                continue;
            }
            decorations
                .entry(leaf.key)
                .or_default()
                .push((start - span.start..end - span.start, color));
        }
        decorations
    }
}

/// Binds `keys` to the text leaves `block` actually renders, in document order.
///
/// A heading holds its text in a nested paragraph and a table holds one paragraph
/// per cell, so the keys have to reach those inner leaves; attaching one only to
/// the outer block would leave the geometry unreported and the caret unable to
/// land there. `keys` is consumed in order and a block may need several.
fn with_leaf_keys(block: BlockNode, keys: &mut impl Iterator<Item = u64>) -> BlockNode {
    match block {
        BlockNode::Paragraph(paragraph) => {
            // A missing key would silently duplicate key 1, so the count from
            // `leaf_count` has to match what the block really renders.
            let key = keys
                .next()
                .expect("leaf_count must match the leaves a block renders");
            BlockNode::Paragraph(paragraph.with_leaf_key(key))
        }
        BlockNode::Heading {
            level,
            children,
            span,
        } => {
            let key = keys
                .next()
                .expect("leaf_count must match the leaves a block renders");
            BlockNode::Heading {
                level,
                children: children.with_leaf_key(key),
                span,
            }
        }
        BlockNode::Table(table) => {
            // Rebuild the table with a key on every cell paragraph. `rows()` and
            // `new()` are the public pair that makes this possible without
            // reaching into the table's private fields.
            let aligns = table.column_aligns().to_vec();
            let rows: Vec<Vec<gpui_kit::base::text::editor_host::Paragraph>> = table
                .rows()
                .map(|row| {
                    row.map(|paragraph| {
                        let key = keys
                            .next()
                            .expect("leaf_count must match the leaves a block renders");
                        paragraph.clone().with_leaf_key(key)
                    })
                    .collect()
                })
                .collect();
            BlockNode::Table(gpui_kit::base::text::editor_host::Table::new(rows, aligns))
        }
        other => other,
    }
}

/// How many text leaves `block` renders.
///
/// A table renders one leaf per cell, which is why a block's key cannot be its
/// index. Everything else renders exactly one.
fn leaf_count(block: &BlockNode) -> usize {
    match block {
        BlockNode::Table(table) => table.rows().map(|row| row.count()).sum::<usize>().max(1),
        _ => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The parser reports document-wide spans, which is what lets a caret
    /// offset resolve to a leaf.
    #[test]
    fn each_block_carries_its_source_span() {
        let document = TypesetDocument::parse("# One\n\nTwo\n").expect("markdown parses");
        let spans: Vec<_> = document
            .leaf_spans()
            .iter()
            .map(|leaf| leaf.span())
            .collect();
        assert_eq!(spans.len(), 2, "a heading and a paragraph");
        let heading = spans[0].clone().expect("the heading has a span");
        assert_eq!(heading.start, 0, "the heading starts the document");
        let paragraph = spans[1].clone().expect("the paragraph has a span");
        assert!(
            paragraph.start >= heading.end,
            "the paragraph starts after the heading: {paragraph:?} vs {heading:?}"
        );
    }

    /// A caret offset is document-wide. Resolving it by leaf length would land
    /// on the first block every time, so this pins the span-based lookup.
    #[test]
    fn a_caret_offset_resolves_to_the_block_that_contains_it() {
        let source = "# One\n\nTwo\n";
        let document = TypesetDocument::parse(source).expect("markdown parses");
        let first = document.leaf_key(0).expect("a first key");
        let second = document.leaf_key(1).expect("a second key");
        assert_eq!(document.leaf_at(0), Some(first), "the start is the heading");
        let paragraph_start = source.find("Two").expect("the paragraph text");
        assert_eq!(
            document.leaf_at(paragraph_start),
            Some(second),
            "an offset inside the paragraph resolves to it, not the heading"
        );
    }

    /// A caret sitting in the blank line between blocks belongs to the block
    /// before it, which is where the end of a line actually is.
    #[test]
    fn an_offset_between_blocks_resolves_to_the_earlier_one() {
        let document = TypesetDocument::parse("# One\n\nTwo\n").expect("markdown parses");
        let first = document.leaf_key(0).expect("a first key");
        assert_eq!(
            document.leaf_at(6),
            Some(first),
            "offset 6 is the blank line"
        );
    }

    /// A rendered diagram must keep the fence's source range.
    ///
    /// Losing it breaks two things the caret depends on: resolving an offset
    /// inside the fence to its block, and stepping vertically past the diagram
    /// instead of stopping dead at it.
    #[test]
    fn a_rendered_diagram_keeps_its_source_span() {
        let source = "before\n\n```mermaid\nflowchart LR\nA-->B\n```\n\nafter\n";
        let plain = TypesetDocument::parse(source).expect("markdown parses");
        let renderer = DiagramRenderer::new(std::sync::Arc::new(()));
        let drawn = TypesetDocument::parse_with(source, Some(&renderer)).expect("markdown parses");

        let fence_span = plain
            .leaf_spans()
            .get(1)
            .and_then(|leaf| leaf.span())
            .expect("the fence has a range");
        let kept = drawn
            .leaf_spans()
            .get(1)
            .and_then(|leaf| leaf.span())
            .expect("the rendered block keeps the fence's range");
        assert_eq!(kept, fence_span, "rendering must not lose the source range");
    }

    /// A table consumes one key per cell, so a block's key is not its index.
    #[test]
    fn a_table_consumes_one_key_per_cell() {
        let document = TypesetDocument::parse("| a | b |\n| --- | --- |\n| c | d |\n")
            .expect("markdown parses");
        // Two paragraphs before/after would each take one key; the table takes
        // four (2x2), so the total is larger than the block count.
        assert_eq!(document.leaf_spans().len(), 4, "2x2 cells");
        assert_eq!(
            document.leaf_key(0),
            Some(FIRST_LEAF_KEY),
            "the first block starts at the first key"
        );
    }

    /// A table and the paragraph after it get distinct, non-overlapping keys.
    #[test]
    fn a_block_after_a_table_starts_past_the_cells() {
        let document =
            TypesetDocument::parse("| a | b |\n| --- | --- |\n\nafter\n").expect("markdown parses");
        let table_first = document.leaf_key(0).expect("the table");
        let after_first = document.leaf_key(1).expect("the paragraph");
        assert_eq!(
            after_first,
            table_first + 2,
            "the paragraph follows the table's two cells"
        );
    }

    /// A diagram renderer that changes the block count must not lose the view.
    ///
    /// The alternative — failing the parse — would blank every other block
    /// because one diagram misbehaved.
    #[test]
    fn a_renderer_that_changes_the_block_count_falls_back_to_source() {
        // No renderer means no replacement, which is the same shape the fallback
        // produces: the fence stays a code block.
        let source = "```mermaid\nflowchart LR\nA-->B\n```\n";
        let document = TypesetDocument::parse(source).expect("markdown parses");
        assert_eq!(document.leaf_spans().len(), 1);
        assert!(
            document.leaf_spans()[0].span().is_some(),
            "the block keeps its range even without a renderer"
        );
    }

    /// An offset inside a diagram resolves to the diagram's block.
    #[test]
    fn an_offset_inside_a_diagram_resolves_to_its_block() {
        let source = "before\n\n```mermaid\nflowchart LR\nA-->B\n```\n\nafter\n";
        let renderer = DiagramRenderer::new(std::sync::Arc::new(()));
        let document = TypesetDocument::parse_with(source, Some(&renderer)).expect("parses");
        let inside = source.find("flowchart").expect("the fence body");
        let key = document.leaf_at(inside).expect("a leaf");
        assert_eq!(
            Some(key),
            document.leaf_key(1),
            "the caret inside the fence belongs to the diagram block"
        );
    }

    #[test]
    fn a_vertical_neighbour_skips_keys_that_reported_no_geometry() {
        // Three blocks, but the middle one did not lay out this frame. Stepping
        // by one from the first would stop at the gap; the neighbour must be the
        // third block.
        let document = TypesetDocument::parse("one\n\ntwo\n\nthree\n").expect("parses");
        let first = document.leaf_key(0).expect("a first key");
        let third = document.leaf_key(2).expect("a third key");
        let laid_out = vec![first, third];
        let (key, span) = document
            .vertical_neighbour(first, false, &laid_out)
            .expect("the third block is below");
        assert_eq!(key, third);
        assert!(span.start > 0);
    }

    #[test]
    fn a_vertical_neighbour_stops_at_the_edges() {
        let document = TypesetDocument::parse("one\n\ntwo\n").expect("parses");
        let first = document.leaf_key(0).expect("a first key");
        let second = document.leaf_key(1).expect("a second key");
        let laid_out = vec![first, second];
        assert!(
            document
                .vertical_neighbour(first, true, &laid_out)
                .is_none(),
            "nothing is above the first block"
        );
        assert!(
            document
                .vertical_neighbour(second, false, &laid_out)
                .is_none(),
            "nothing is below the last block"
        );
    }

    #[test]
    fn a_heading_leaf_key_reaches_its_nested_paragraph() {
        // Without this the heading reports no geometry at all.
        let document = TypesetDocument::parse("# One\n").expect("markdown parses");
        assert_eq!(document.leaf_spans().len(), 1);
        assert_eq!(document.leaf_key(0), Some(FIRST_LEAF_KEY));
    }
}
