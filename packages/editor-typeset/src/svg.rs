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

use gpui_kit::{AssetSource, ImageSource, ParsedSvg, RenderImage, SvgRenderer, SvgSize};
use image as image_crate;
use image_crate::ImageEncoder as _;

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

/// Encodes a rendered image as a PNG data URL.
///
/// The block tree can only hold an image by URI, and its decoder cannot read
/// SVG, so the only way a rendered diagram reaches the document is as PNG bytes
/// inside a `data:` URL. Encoding happens once per render, and the same
/// document re-rendered at the same size produces the same bytes.
pub fn to_png_data_url(image: &RenderImage) -> Result<String, SvgError> {
    let size = image.size(0);
    let width = size.width.0.max(0) as u32;
    let height = size.height.0.max(0) as u32;
    if width == 0 || height == 0 {
        return Err(SvgError::Render("the image has no pixels".into()));
    }
    let Some(bytes) = image.as_bytes(0) else {
        return Err(SvgError::Render("the image has no frame".into()));
    };
    // The renderer hands back BGRA in platform byte order; the encoder wants
    // plain RGBA.
    let mut rgba = bytes.to_vec();
    for pixel in rgba.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
    }
    let mut png = Vec::new();
    let encoder = image_crate::codecs::png::PngEncoder::new(&mut png);
    encoder
        .write_image(&rgba, width, height, image_crate::ExtendedColorType::Rgba8)
        .map_err(|error| SvgError::Render(error.to_string()))?;
    Ok(format!("data:image/png;base64,{}", base64_encode(&png)))
}

/// Standard base64, which a `data:` URL requires.
///
/// Hand-rolled because this crate otherwise has no need for a base64
/// dependency, and the alphabet is fixed by RFC 4648.
fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[(triple >> 18) as usize & 0x3f] as char);
        out.push(ALPHABET[(triple >> 12) as usize & 0x3f] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(triple >> 6) as usize & 0x3f] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[triple as usize & 0x3f] as char
        } else {
            '='
        });
    }
    out
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
