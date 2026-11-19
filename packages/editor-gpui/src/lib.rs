//! GPUI editor components shared by native desktop and the WebAssembly playground.

mod view;

pub use view::{BlockFormat, EditorView, InlineFormat, PasteContext, PasteHandler};
