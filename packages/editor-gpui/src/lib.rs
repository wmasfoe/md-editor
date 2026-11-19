//! GPUI editor components shared by native desktop and the WebAssembly playground.

mod view;

pub use view::{BlockFormat, EditorCommand, EditorView, InlineFormat, PasteContext, PasteHandler};
