//! Native GPUI editor components for the desktop app.
//!
//! The view connects the source editing session to GPUI layout and the
//! platform's text-input contract.

mod commands;
mod native_layout;
mod typeset_view;

pub use commands::{BlockFormat, HostCommand, InlineFormat, format_shortcuts};
pub use typeset_view::{
    Copy, Cut, ImagePaste, Paste, PasteTarget, ToggleSourceMode, TypesetTypography, TypesetView,
};
