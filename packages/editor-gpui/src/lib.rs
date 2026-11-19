//! GPUI editor components shared by the native desktop app and the WebAssembly
//! Playground.
//!
//! The editing engine lives in `editor-typeset`; this crate is the GPUI layer
//! that renders it and answers the platform's text-input contract.

mod commands;
mod typeset_view;

pub use commands::{BlockFormat, HostCommand, InlineFormat};
pub use typeset_view::{PasteTarget, TypesetView};
