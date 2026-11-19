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

mod edit;
mod geometry;
mod math;
mod mermaid;
mod movement;
mod svg;
mod text;

pub use edit::{EditorCommand, Selection, TypesetEditor, TypesetError};
pub use geometry::{LeafIndex, caret_at};
pub use math::{
    Formula, FormulaError, MATH_LANGUAGE, MathRenderer, default_font_size, is_math_fence,
    try_render_formula,
};
pub use mermaid::{
    Diagram, DiagramError, MERMAID_LANGUAGE, is_mermaid_fence, render_diagram, try_render_diagram,
};
pub use movement::{Vertical, move_down, move_left, move_right, move_up, move_vertical};
pub use svg::{SvgError, SvgImageChannel, try_svg_to_image};
pub use text::{byte_offset, line_start, utf16_offset};

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
    keys: Vec<u64>,
    spans: Vec<LeafSpan>,
    source: String,
}

impl TypesetDocument {
    /// Parses `source` and assigns one leaf key per rendered block.
    ///
    /// The key is bound to the block's text leaf at parse time, because a
    /// heading carries its text in a nested paragraph: attaching the key to the
    /// outer block alone would leave the heading reporting no geometry.
    ///
    /// The parser reports an error for input it cannot structure; the caller
    /// keeps showing the previous document rather than losing the buffer.
    pub fn parse(source: impl Into<String>) -> Result<Self, SharedString> {
        let source = source.into();
        let parsed = parse_markdown(&source, Default::default())?;
        let mut keys = Vec::with_capacity(parsed.len());
        let mut spans = Vec::with_capacity(parsed.len());
        let mut blocks = Vec::with_capacity(parsed.len());
        for (index, block) in parsed.into_iter().enumerate() {
            let key = FIRST_LEAF_KEY + index as u64;
            let span = block.span().map(|span| span.start..span.end);
            keys.push(key);
            spans.push(LeafSpan { key, span });
            blocks.push(with_leaf_key(block, key));
        }
        Ok(Self {
            blocks,
            keys,
            spans,
            source,
        })
    }

    /// The Markdown this document was parsed from.
    pub fn source(&self) -> &str {
        &self.source
    }

    /// The block count, which is also the number of leaf keys in use.
    pub fn block_count(&self) -> usize {
        self.blocks.len()
    }

    /// The leaf key for `index`, or `None` when out of range.
    pub fn leaf_key(&self, index: usize) -> Option<u64> {
        self.keys.get(index).copied()
    }

    /// Every block's key and source span, in document order.
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
        let (element, leaves) =
            gpui_kit::base::text::editor_host::collect_leaf_geometry(Default::default(), || {
                self.render_blocks(body_font_size, context, window, cx)
                    .into_any_element()
            });
        (element, LeafIndex::new(leaves))
    }
}

/// Binds `key` to the text leaf `block` actually renders.
///
/// A heading and a table cell hold their text in a nested paragraph, so the key
/// has to reach that inner leaf; attaching it only to the outer block would
/// leave the geometry unreported.
fn with_leaf_key(block: BlockNode, key: u64) -> BlockNode {
    match block {
        BlockNode::Paragraph(paragraph) => BlockNode::Paragraph(paragraph.with_leaf_key(key)),
        BlockNode::Heading {
            level,
            children,
            span,
        } => BlockNode::Heading {
            level,
            children: children.with_leaf_key(key),
            span,
        },
        other => other,
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
        assert_eq!(document.block_count(), 1);
        assert_eq!(document.leaf_key(0), Some(FIRST_LEAF_KEY));
    }
}
