use gpui_kit::{Context, SharedString};
use inkpoint_editor_typeset::{DiagramRenderer, TypesetDocument};

use super::TypesetView;

/// Builds the rendered block tree used by either editing mode.
pub(super) fn parse_document(
    source: &str,
    source_mode: bool,
    diagrams: &DiagramRenderer,
) -> (TypesetDocument, Option<SharedString>) {
    if source_mode {
        return (TypesetDocument::plain_source(source), None);
    }

    match TypesetDocument::parse_for_editing(source, Some(diagrams)) {
        Ok(document) => (document, None),
        Err(error) => (TypesetDocument::plain_source(source), Some(error)),
    }
}

impl TypesetView {
    /// Whether this view displays raw Markdown source.
    pub fn source_mode(&self) -> bool {
        self.source_mode
    }

    /// Switches between rendered Markdown and literal source in the same session.
    pub fn set_source_mode(&mut self, source_mode: bool, cx: &mut Context<Self>) {
        if self.source_mode == source_mode || self.composing() {
            return;
        }
        self.source_mode = source_mode;
        self.document_revision = None;
        self.reparse();
        let offset = self.editor.selection().head();
        if let Some(block_index) = self.block_index_for_offset(offset) {
            self.native_layout.reveal_after_layout(block_index);
            cx.notify();
            return;
        }
        self.scroll_offset_into_view(offset);
        cx.notify();
    }

    /// Flips the view's presentation while keeping the source and selection intact.
    pub fn toggle_source_mode(&mut self, cx: &mut Context<Self>) {
        self.set_source_mode(!self.source_mode, cx);
    }
}
