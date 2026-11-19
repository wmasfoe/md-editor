//! GPUI editor components shared by native desktop and the WebAssembly playground.

mod typeset_view;
mod view;

pub use typeset_view::{PasteTarget, TypesetView};
pub use view::{BlockFormat, EditorView, HostCommand, InlineFormat, PasteContext, PasteHandler};
