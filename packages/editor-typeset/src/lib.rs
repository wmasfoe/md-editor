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

pub use edit::{EditorCommand, Selection, TypesetEditor, TypesetError};
pub use geometry::{LeafIndex, caret_at, index_at};
pub use math::{
    Formula, FormulaError, MATH_LANGUAGE, MathRenderer, default_font_size, is_math_fence,
    try_render_formula,
};
pub use mermaid::{
    Diagram, DiagramError, MERMAID_LANGUAGE, is_mermaid_fence, render_diagram, try_render_diagram,
};
pub use movement::{Vertical, move_down, move_left, move_right, move_up, move_vertical};
pub use svg::{SvgError, SvgImageChannel, image_size, svg_to_image, try_svg_to_image};

use gpui_kit::base::text::editor_host::{BlockNode, FlowPosition, RenderContext, parse_markdown};
use gpui_kit::{App, Pixels, SharedString, Window, div, prelude::*};

/// The leaf key assigned to the first text leaf of a document.
///
/// Keys are host-owned and stable for the lifetime of a document render: the
/// editor uses them to match geometry back to the block it came from.
pub const FIRST_LEAF_KEY: u64 = 1;

/// A parsed document ready to be rendered and edited.
pub struct TypesetDocument {
    blocks: Vec<BlockNode>,
    keys: Vec<u64>,
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
        let mut blocks = Vec::with_capacity(parsed.len());
        for (index, block) in parsed.into_iter().enumerate() {
            let key = FIRST_LEAF_KEY + index as u64;
            keys.push(key);
            blocks.push(with_leaf_key(block, key));
        }
        Ok(Self {
            blocks,
            keys,
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
