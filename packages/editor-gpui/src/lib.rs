//! Native GPUI editor components for the desktop app.
//!
//! The view connects the source editing session to GPUI layout and the
//! platform's text-input contract.

mod commands;
mod image_source;
mod native_layout;
mod typeset_view;

pub use commands::{
    AlignmentChoice, BlockFormat, HostCommand, InlineFormat, TableCommand, format_shortcuts,
};
pub use image_source::local_image_path;
pub use typeset_view::{
    Copy, Cut, ImagePaste, LinkAction, LinkActivated, Paste, PasteTarget, ToggleSourceMode,
    TypesetTypography, TypesetView,
};
