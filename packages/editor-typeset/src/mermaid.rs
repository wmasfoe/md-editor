//! Mermaid diagram rendering, with a source fallback.
//!
//! A diagram is a fenced code block whose language is `mermaid`. Rendering it
//! turns the fence body into an SVG, which the shared [`crate::svg`] channel
//! rasterizes.
//!
//! Rendering is best-effort by design: a diagram that fails to parse or draw
//! must never block editing, so the caller falls back to showing the source.
//! That is why the public entry point returns a [`Diagram`] describing which of
//! the two happened, rather than an error the caller has to translate.

use gpui_kit::{ImageSource, SvgSize};

use crate::svg::{SvgError, SvgImageChannel};

/// The outcome of rendering one diagram block.
pub enum Diagram {
    /// The diagram rendered to an image.
    Rendered(ImageSource),
    /// The diagram could not render; show the source instead.
    Source {
        /// The fence body, unchanged.
        source: String,
        /// Why rendering did not produce an image.
        reason: DiagramError,
    },
}

/// Why a diagram fell back to its source.
#[derive(Clone, Debug)]
pub enum DiagramError {
    /// The Mermaid source could not be turned into an SVG.
    Mermaid(String),
    /// The SVG could not be turned into an image.
    Svg(SvgError),
}

impl std::fmt::Display for DiagramError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Mermaid(message) => {
                write!(formatter, "The diagram could not be drawn: {message}")
            }
            Self::Svg(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for DiagramError {}

/// The language tag that marks a fenced block as a diagram.
pub const MERMAID_LANGUAGE: &str = "mermaid";

/// Whether a fenced code block's language names a Mermaid diagram.
///
/// Mermaid is also written as `mermaid` with surrounding whitespace in some
/// documents, so the comparison trims and ignores case.
pub fn is_mermaid_fence(language: Option<&str>) -> bool {
    language.is_some_and(|value| value.trim().eq_ignore_ascii_case(MERMAID_LANGUAGE))
}

/// Renders `source` as a Mermaid diagram, falling back to the source itself.
///
/// The fallback is not an error path the caller must handle separately: both
/// outcomes are returned as a [`Diagram`], because showing the source is a
/// legitimate result, not a failure.
pub fn render_diagram(
    channel: &SvgImageChannel,
    source: &str,
    size: impl Into<SvgSize>,
) -> Diagram {
    let svg = match mermaid_rs_renderer::render(source) {
        Ok(svg) => svg,
        Err(error) => {
            return Diagram::Source {
                source: source.to_string(),
                reason: DiagramError::Mermaid(error.to_string()),
            };
        }
    };
    match channel.image(&svg, size) {
        Ok(image) => Diagram::Rendered(image),
        Err(error) => Diagram::Source {
            source: source.to_string(),
            reason: DiagramError::Svg(error),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn a_mermaid_fence_is_recognized_case_and_space_insensitively() {
        assert!(is_mermaid_fence(Some("mermaid")));
        assert!(is_mermaid_fence(Some(" Mermaid ")));
        assert!(!is_mermaid_fence(Some("rust")));
        assert!(!is_mermaid_fence(None));
    }

    #[test]
    fn a_flowchart_renders_to_an_image() {
        let channel = SvgImageChannel::new(Arc::new(()));
        let diagram = render_diagram(&channel, "flowchart LR\nA-->B\n", SvgSize::ScaleFactor(1.0));
        assert!(
            matches!(diagram, Diagram::Rendered(_)),
            "a simple flowchart should render"
        );
    }

    #[test]
    fn malformed_mermaid_falls_back_to_the_source() {
        let channel = SvgImageChannel::new(Arc::new(()));
        let source = "this is not a diagram";
        let diagram = render_diagram(&channel, source, SvgSize::ScaleFactor(1.0));
        match diagram {
            Diagram::Source {
                source: kept,
                reason,
            } => {
                assert_eq!(kept, source, "the fallback must keep the source verbatim");
                assert!(
                    matches!(reason, DiagramError::Mermaid(_)),
                    "the reason should name the Mermaid failure"
                );
            }
            Diagram::Rendered(_) => panic!("garbage must not render as a diagram"),
        }
    }
}
