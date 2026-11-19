//! The shared channel from generated SVG to a paintable image.
//!
//! Mermaid diagrams and math formulas both end up as an SVG string. Rather than
//! each one teaching itself how to get from there to something GPUI can draw,
//! they share this module: parse once, rasterize at the size the layout asks
//! for, and hand back an [`ImageSource`].
//!
//! GPUI already depends on `resvg` internally, so this reuses that instead of
//! adding a second SVG stack. The parse result is worth keeping when the same
//! diagram is rasterized at several scales, because parsing resolves fonts and
//! converts text to paths.

use std::sync::Arc;

use gpui_kit::{AssetSource, ImageSource, ParsedSvg, SvgRenderer, SvgSize};

/// Why an SVG could not become an image.
#[derive(Clone, Debug)]
pub enum SvgError {
    /// The SVG source could not be parsed.
    Parse(String),
    /// The parsed SVG could not be rasterized at the requested size.
    Render(String),
}

impl std::fmt::Display for SvgError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Parse(message) => write!(formatter, "The SVG could not be parsed: {message}"),
            Self::Render(message) => {
                write!(formatter, "The SVG could not be rendered: {message}")
            }
        }
    }
}

impl std::error::Error for SvgError {}

/// Turns generated SVG into images GPUI can draw.
///
/// One renderer serves every diagram and formula in a window: it owns the font
/// database and parse options, so creating one per block would reload system
/// fonts each time.
pub struct SvgImageChannel {
    renderer: SvgRenderer,
}

impl SvgImageChannel {
    /// Creates a channel that resolves embedded assets through `asset_source`.
    pub fn new(asset_source: Arc<dyn AssetSource>) -> Self {
        Self {
            renderer: SvgRenderer::new(asset_source),
        }
    }

    /// Parses `svg` without rasterizing it.
    ///
    /// Callers that rasterize the same source at several sizes should hold the
    /// result and pass it to [`Self::image_from_parsed`] instead of re-parsing.
    pub fn parse(&self, svg: &str) -> Result<ParsedSvg, SvgError> {
        self.renderer
            .parse_svg(svg.as_bytes())
            .map_err(|error| SvgError::Parse(error.to_string()))
    }

    /// Rasterizes an already parsed SVG at `size`.
    pub fn image_from_parsed(
        &self,
        parsed: &ParsedSvg,
        size: impl Into<SvgSize>,
    ) -> Result<ImageSource, SvgError> {
        self.renderer
            .render_parsed(parsed, size)
            .map(ImageSource::Render)
            .map_err(|error| SvgError::Render(error.to_string()))
    }

    /// Parses and rasterizes `svg` in one step.
    ///
    /// This is the convenience path for a one-off render; prefer
    /// [`Self::parse`] plus [`Self::image_from_parsed`] when the same diagram
    /// is drawn at multiple scales.
    pub fn image(&self, svg: &str, size: impl Into<SvgSize>) -> Result<ImageSource, SvgError> {
        let parsed = self.parse(svg)?;
        self.image_from_parsed(&parsed, size)
    }
}

/// Rasterizes `svg`, reporting `None` instead of an error.
///
/// Rendering a diagram or formula must never block editing, so the fallback
/// path — show the source instead — only needs to know whether it worked.
pub fn try_svg_to_image(
    asset_source: Arc<dyn AssetSource>,
    svg: &str,
    size: impl Into<SvgSize>,
) -> Option<ImageSource> {
    SvgImageChannel::new(asset_source).image(svg, size).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::RenderImage;

    /// The smallest SVG that still exercises parse and rasterize.
    const SQUARE: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="black"/></svg>"#;

    /// The pixel size of a rendered image, used to check that rasterizing
    /// produced something non-empty.
    fn image_size(image: &RenderImage) -> (u32, u32) {
        let size = image.size(0);
        (size.width.0.max(0) as u32, size.height.0.max(0) as u32)
    }

    #[test]
    fn a_well_formed_svg_parses_and_rasterizes() {
        let channel = SvgImageChannel::new(Arc::new(()));
        let parsed = channel.parse(SQUARE).expect("the square should parse");
        let image = channel
            .image_from_parsed(&parsed, SvgSize::ScaleFactor(1.0))
            .expect("the parsed square should rasterize");
        let ImageSource::Render(render) = image else {
            panic!("the channel returns a rendered image");
        };
        let (width, height) = image_size(&render);
        assert!(width > 0 && height > 0, "the image must have a size");
    }

    #[test]
    fn malformed_svg_reports_a_parse_error() {
        let channel = SvgImageChannel::new(Arc::new(()));
        let error = channel.parse("not an svg");
        assert!(
            matches!(error, Err(SvgError::Parse(_))),
            "garbage must report a parse error"
        );
    }

    #[test]
    fn the_fallback_path_reports_none_instead_of_failing() {
        assert!(try_svg_to_image(Arc::new(()), "not an svg", SvgSize::ScaleFactor(1.0)).is_none());
    }
}
