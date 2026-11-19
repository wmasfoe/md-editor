//! Math formula rendering, with a source fallback.
//!
//! A formula is a fenced block tagged `math`, or inline text between `$`
//! delimiters. Rendering turns the LaTeX source into an SVG, which the shared
//! [`crate::svg`] channel rasterizes.
//!
//! Like diagrams, formulas are best-effort: a formula that fails to parse must
//! never block editing, so the caller shows the source instead.
//!
//! The font is the embedded STIX Two Math face. Loading it is not free — it
//! parses an OpenType MATH table — so a long-lived [`MathRenderer`] keeps it
//! across renders rather than reloading per formula.

use std::sync::Arc;

use gpui_kit::{AssetSource, ImageSource, SvgSize};
use latex_rust::render::svg::{SvgOptions, latex_to_svg};
use latex_rust::{Dim, MathFont};

use crate::svg::{SvgError, SvgImageChannel};

/// The language tag that marks a fenced block as a formula.
pub const MATH_LANGUAGE: &str = "math";

/// The outcome of rendering one formula.
pub enum Formula {
    /// The formula rendered to an image.
    Rendered(ImageSource),
    /// The formula could not render; show the source instead.
    Source {
        /// The LaTeX source, unchanged.
        source: String,
        /// Why rendering did not produce an image.
        reason: FormulaError,
    },
}

/// Why a formula fell back to its source.
#[derive(Clone, Debug)]
pub enum FormulaError {
    /// The font could not be loaded, which is a build or asset problem.
    Font(String),
    /// The LaTeX could not be laid out or drawn.
    Latex(String),
    /// The SVG could not be turned into an image.
    Svg(SvgError),
}

impl std::fmt::Display for FormulaError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Font(message) => {
                write!(formatter, "The math font could not be loaded: {message}")
            }
            Self::Latex(message) => write!(formatter, "The formula could not be drawn: {message}"),
            Self::Svg(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for FormulaError {}

/// Whether a fenced code block's language names a formula.
pub fn is_math_fence(language: Option<&str>) -> bool {
    language.is_some_and(|value| value.trim().eq_ignore_ascii_case(MATH_LANGUAGE))
}

/// Renders LaTeX formulas through one shared font and SVG channel.
pub struct MathRenderer {
    font: Result<MathFont, String>,
    channel: SvgImageChannel,
}

impl MathRenderer {
    /// Creates a renderer with the embedded STIX Two Math face.
    ///
    /// A font failure is recorded rather than raised: the renderer still
    /// exists so every formula reports its own fallback, instead of the whole
    /// document failing to open.
    pub fn new(asset_source: Arc<dyn AssetSource>) -> Self {
        let font = MathFont::stix_two_math().map_err(|error| error.to_string());
        Self {
            font,
            channel: SvgImageChannel::new(asset_source),
        }
    }

    /// Renders `latex`, falling back to the source when it cannot be drawn.
    ///
    /// `display` selects display style, which centers and enlarges the formula;
    /// inline formulas pass `false`.
    pub fn render(&self, latex: &str, display: bool, size: impl Into<SvgSize>) -> Formula {
        let font = match &self.font {
            Ok(font) => font,
            Err(error) => {
                return Formula::Source {
                    source: latex.to_string(),
                    reason: FormulaError::Font(error.clone()),
                };
            }
        };
        let options = SvgOptions {
            display,
            ..SvgOptions::default()
        };
        let svg = match latex_to_svg(latex, font, &options) {
            Ok(svg) => svg,
            Err(error) => {
                return Formula::Source {
                    source: latex.to_string(),
                    reason: FormulaError::Latex(error.to_string()),
                };
            }
        };
        match self.channel.image(&svg, size) {
            Ok(image) => Formula::Rendered(image),
            Err(error) => Formula::Source {
                source: latex.to_string(),
                reason: FormulaError::Svg(error),
            },
        }
    }
}

/// The default em size in points for a rendered formula.
///
/// It matches the renderer's own default; a document that scales formula text
/// overrides it through [`SvgSize`] rather than here.
pub fn default_font_size() -> Dim {
    Dim::from_i64(12)
}

/// Renders `latex`, reporting only whether it worked.
pub fn try_render_formula(
    asset_source: Arc<dyn AssetSource>,
    latex: &str,
    display: bool,
    size: impl Into<SvgSize>,
) -> Option<ImageSource> {
    let renderer = MathRenderer::new(asset_source);
    match renderer.render(latex, display, size) {
        Formula::Rendered(image) => Some(image),
        Formula::Source { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_math_fence_is_recognized_case_and_space_insensitively() {
        assert!(is_math_fence(Some("math")));
        assert!(is_math_fence(Some(" Math ")));
        assert!(!is_math_fence(Some("latex")));
        assert!(!is_math_fence(None));
    }

    #[test]
    fn a_simple_formula_renders_to_an_image() {
        let renderer = MathRenderer::new(Arc::new(()));
        let formula = renderer.render(r"\frac{a}{b}", false, SvgSize::ScaleFactor(1.0));
        assert!(
            matches!(formula, Formula::Rendered(_)),
            "a fraction should render"
        );
    }

    #[test]
    fn an_unsupported_construct_falls_back_to_the_source() {
        let renderer = MathRenderer::new(Arc::new(()));
        let source = r"\thisIsNotACommand{x}";
        let formula = renderer.render(source, false, SvgSize::ScaleFactor(1.0));
        match formula {
            Formula::Source {
                source: kept,
                reason,
            } => {
                assert_eq!(kept, source, "the fallback must keep the source verbatim");
                assert!(
                    matches!(reason, FormulaError::Latex(_)),
                    "the reason should name the LaTeX failure"
                );
            }
            Formula::Rendered(_) => panic!("an unknown command must not render"),
        }
    }
}
