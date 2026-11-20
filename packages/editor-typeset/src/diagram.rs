//! Drawing `mermaid` and `math` fences as images.
//!
//! A diagram or formula is authored as a fenced code block, so the Markdown stays
//! plain and portable. Rendering swaps that block's *rendering* for a picture
//! while the fence stays in the buffer: the user edits the source, the picture
//! follows.
//!
//! When rendering fails the block is left exactly as parsed — the code block the
//! user typed. That is the degradation the product asks for: show the source,
//! never a blank gap, never an error that blocks editing.
//!
//! The picture travels as a PNG `data:` URL because the block tree can only hold
//! an image by URI, and its decoder cannot read SVG. Encoding is therefore part
//! of the cost of showing a diagram, and it happens once per render.

use std::sync::Arc;

use gpui_kit::base::text::editor_host::{BlockNode, ImageNode, InlineNode, Paragraph};
use gpui_kit::{AssetSource, SharedString, SharedUri, SvgSize};

use crate::math::{Formula, MathRenderer, is_math_fence};
use crate::mermaid::{Diagram, is_mermaid_fence, render_diagram};
use crate::svg::{SvgImageChannel, to_png_data_url};

/// Renders `mermaid` and `math` fences into images for a document.
///
/// One instance serves a whole document. The SVG channel owns a font database
/// and the math renderer owns a parsed STIX face, so building them per block
/// would reload fonts for every diagram.
pub struct DiagramRenderer {
    channel: SvgImageChannel,
    math: MathRenderer,
}

impl DiagramRenderer {
    /// Creates a renderer that resolves embedded SVG assets through `assets`.
    pub fn new(assets: Arc<dyn AssetSource>) -> Self {
        Self {
            channel: SvgImageChannel::new(assets.clone()),
            math: MathRenderer::new(assets),
        }
    }

    /// Replaces `mermaid` and `math` code blocks with pictures of their contents.
    ///
    /// Blocks that are not diagram fences, and fences whose rendering failed,
    /// pass through unchanged so they render as the source the user typed.
    pub fn replace_diagrams(
        &self,
        blocks: Vec<BlockNode>,
        size: impl Into<SvgSize> + Copy,
    ) -> Vec<BlockNode> {
        let size = size.into();
        blocks
            .into_iter()
            .map(|block| self.replace_one(block, size))
            .collect()
    }

    fn replace_one(&self, block: BlockNode, size: SvgSize) -> BlockNode {
        let BlockNode::CodeBlock(code) = &block else {
            return block;
        };
        let language = code.lang();
        let language = language.as_deref();
        if !is_mermaid_fence(language) && !is_math_fence(language) {
            return block;
        }
        let source = code.code().to_string();
        let image = if is_mermaid_fence(language) {
            match render_diagram(&self.channel, &source, size) {
                Diagram::Rendered(image) => Some(image),
                Diagram::Source { .. } => None,
            }
        } else {
            // A fenced formula is display style: it stands on its own line.
            match self.math.render(&source, true, size) {
                Formula::Rendered(image) => Some(image),
                Formula::Source { .. } => None,
            }
        };
        let Some(image) = image else {
            // Rendering failed: keep the code block so the source stays visible.
            return block;
        };
        let gpui_kit::ImageSource::Render(rendered) = image else {
            return block;
        };
        let Ok(url) = to_png_data_url(&rendered) else {
            return block;
        };
        BlockNode::Paragraph(image_paragraph(url))
    }
}

/// A paragraph holding nothing but an image.
fn image_paragraph(url: String) -> Paragraph {
    let mut paragraph = Paragraph::default();
    // `ImageNode` has private fields, so it is built through `Default` and the
    // public ones are assigned: a struct literal cannot name the rest.
    let mut image = ImageNode::default();
    image.url = SharedUri::from(url);
    image.alt = Some(SharedString::from("Rendered diagram"));
    paragraph.push(InlineNode::image(image));
    paragraph
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::base::text::editor_host::parse_markdown;

    fn renderer() -> DiagramRenderer {
        DiagramRenderer::new(Arc::new(()))
    }

    fn blocks(source: &str) -> Vec<BlockNode> {
        parse_markdown(source, Default::default()).expect("markdown parses")
    }

    fn image_url(block: &BlockNode) -> Option<String> {
        let BlockNode::Paragraph(paragraph) = block else {
            return None;
        };
        paragraph
            .children()
            .iter()
            .find_map(|node| node.as_image().map(|image| image.url.to_string()))
    }

    #[test]
    fn a_mermaid_fence_becomes_a_png_data_url() {
        let document = renderer().replace_diagrams(
            blocks("```mermaid\nflowchart LR\nA-->B\n```\n"),
            SvgSize::ScaleFactor(1.0),
        );
        let url = image_url(&document[0]).expect("the fence became an image");
        assert!(
            url.starts_with("data:image/png;base64,"),
            "the block tree can only hold an image by URI: {url}"
        );
    }

    #[test]
    fn a_math_fence_becomes_a_png_data_url() {
        let document = renderer().replace_diagrams(
            blocks("```math\n\\frac{a}{b}\n```\n"),
            SvgSize::ScaleFactor(1.0),
        );
        let url = image_url(&document[0]).expect("the formula became an image");
        assert!(url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn an_ordinary_code_block_is_left_alone() {
        let document = renderer().replace_diagrams(
            blocks("```rust\nfn main() {}\n```\n"),
            SvgSize::ScaleFactor(1.0),
        );
        assert!(
            matches!(document[0], BlockNode::CodeBlock(_)),
            "only diagram fences are replaced"
        );
    }

    #[test]
    fn a_fence_that_fails_to_render_keeps_its_source() {
        // Not a valid diagram, so it must stay a code block rather than vanish.
        let document = renderer().replace_diagrams(
            blocks("```mermaid\nnot a diagram\n```\n"),
            SvgSize::ScaleFactor(1.0),
        );
        assert!(
            matches!(document[0], BlockNode::CodeBlock(_)),
            "a failed render degrades to the source the user typed"
        );
    }
}
