//! The editable surface: document state, caret and selection, and the
//! operations that change the Markdown.
//!
//! gpui-kit renders the document and reports geometry. This module owns what
//! the renderer deliberately leaves to the host: which byte range is selected,
//! where the caret sits, and how a command rewrites the source.
//!
//! Offsets here are UTF-8 byte offsets into the Markdown source, matching both
//! [`inkpoint_editor_core`] and the leaf geometry gpui-kit reports.

use std::ops::Range;

use gpui_kit::base::text::editor_host::Caret;
use inkpoint_editor_core::{BlockKind, EditError, MarkdownDocument, SourceBlock, SourceEdit};

use crate::LeafIndex;

/// Why an edit did not apply.
///
/// The source-level failures come from [`inkpoint_editor_core`]; a read-only
/// document is this crate's own rule, so it stays here rather than widening the
/// core contract.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TypesetError {
    /// The document rejects edits.
    ReadOnly,
    /// The edit could not be applied to the source.
    Source(EditError),
}

impl From<EditError> for TypesetError {
    fn from(error: EditError) -> Self {
        Self::Source(error)
    }
}

impl std::fmt::Display for TypesetError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ReadOnly => formatter.write_str("The document is read-only."),
            Self::Source(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for TypesetError {}

/// A selection in source byte offsets, anchored so it can be extended.
///
/// `anchor` is where the selection started; `head` is the moving end. They are
/// equal for a bare caret, and `anchor > head` is a backwards selection.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Selection {
    anchor: usize,
    head: usize,
}

impl Selection {
    /// A collapsed selection at `offset`.
    pub fn caret(offset: usize) -> Self {
        Self {
            anchor: offset,
            head: offset,
        }
    }

    /// A selection from `anchor` to `head`.
    pub fn new(anchor: usize, head: usize) -> Self {
        Self { anchor, head }
    }

    /// Where the selection started.
    pub fn anchor(&self) -> usize {
        self.anchor
    }

    /// The moving end of the selection.
    pub fn head(&self) -> usize {
        self.head
    }

    /// The selected range, normalized to `start..end`.
    pub fn range(&self) -> Range<usize> {
        if self.anchor <= self.head {
            self.anchor..self.head
        } else {
            self.head..self.anchor
        }
    }

    /// Whether nothing is selected.
    pub fn is_collapsed(&self) -> bool {
        self.anchor == self.head
    }

    /// Whether the selection runs backwards.
    pub fn is_reversed(&self) -> bool {
        self.anchor > self.head
    }
}

/// A formatting command a host menu or shortcut can invoke.
///
/// These are the operations a Markdown editor exposes on its toolbar. Keeping
/// them here rather than in the view means the menu, the shortcuts and any
/// future surface all name the same set.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EditorCommand {
    /// Wrap the selection in `**`.
    ToggleBold,
    /// Wrap the selection in `*`.
    ToggleItalic,
    /// Wrap the selection in backticks.
    ToggleInlineCode,
    /// Wrap the selection in `~~`.
    ToggleStrikethrough,
    /// Toggle a `> ` prefix on every selected line.
    ToggleQuote,
    /// Toggle a `- ` prefix on every selected line.
    ToggleBulletList,
    /// Toggle a `1. ` prefix on every selected line.
    ToggleOrderedList,
    /// Toggle a `- [ ] ` prefix on every selected line.
    ToggleTaskList,
    /// Set every selected line to a heading of this level (1-6).
    Heading(u8),
}

/// An editable Markdown document with a caret and selection.
pub struct TypesetEditor {
    document: MarkdownDocument,
    selection: Selection,
    revision: u64,
    readonly: bool,
}

impl TypesetEditor {
    /// Opens `source` with a caret at the start.
    pub fn new(source: impl Into<String>) -> Self {
        Self {
            document: MarkdownDocument::new(source),
            selection: Selection::caret(0),
            revision: 0,
            readonly: false,
        }
    }

    /// The current Markdown source.
    pub fn source(&self) -> &str {
        self.document.source()
    }

    /// A revision counter that changes on every applied edit.
    ///
    /// Hosts use it to detect that an async result (an AI suggestion, an image
    /// insert) no longer matches the document it was computed against.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// The current selection.
    pub fn selection(&self) -> &Selection {
        &self.selection
    }

    /// Whether the document rejects edits.
    pub fn is_readonly(&self) -> bool {
        self.readonly
    }

    /// Sets whether the document rejects edits.
    pub fn set_readonly(&mut self, readonly: bool) {
        self.readonly = readonly;
    }

    /// Replaces the whole document, keeping the caret inside the new source.
    ///
    /// Used when a file is opened or reloaded from disk. The caret is clamped
    /// rather than preserved by meaning, because the two documents share no
    /// offsets.
    pub fn replace_source(&mut self, source: impl Into<String>) {
        self.document = MarkdownDocument::new(source);
        let len = self.document.source().len();
        self.selection = Selection::caret(self.selection.head().min(len));
        self.revision = self.revision.wrapping_add(1);
    }

    /// Moves the caret to `offset`, clamped to the source length.
    pub fn set_caret(&mut self, offset: usize) {
        let offset = offset.min(self.document.source().len());
        self.selection = Selection::caret(offset);
    }

    /// Places a caret from a click, given the leaf geometry of the last frame.
    ///
    /// `key` is the leaf the click landed in, which the host gets from
    /// [`LeafIndex::caret_for_point`]. Returns `false` when the geometry has no
    /// leaf for `key`, which means the last frame did not lay that block out.
    pub fn place_caret(&mut self, index: &LeafIndex, key: u64, caret: Caret) -> bool {
        let Some(leaf) = index.get(key) else {
            return false;
        };
        // The caret index is a byte offset into the leaf's own text; clamping
        // keeps a stale caret from pointing past a shortened leaf.
        let offset = caret.index.min(leaf.len());
        self.set_caret(offset);
        true
    }

    /// Sets the selection, clamped to the source length.
    pub fn set_selection(&mut self, anchor: usize, head: usize) {
        let len = self.document.source().len();
        self.selection = Selection::new(anchor.min(len), head.min(len));
    }

    /// Inserts `text` at the caret, replacing the selection.
    pub fn insert(&mut self, text: &str) -> Result<(), TypesetError> {
        if self.readonly {
            return Err(TypesetError::ReadOnly);
        }
        let range = self.selection.range();
        let caret = range.start + text.len();
        self.apply(SourceEdit {
            range,
            replacement: text.to_string(),
            selection_after: caret..caret,
        })
    }

    /// Sets the heading level of every line the selection touches.
    pub fn set_heading(&mut self, level: u8) -> Result<(), TypesetError> {
        if self.readonly {
            return Err(TypesetError::ReadOnly);
        }
        let selection = self.selection.range();
        let edit = self.document.set_heading(selection, level)?;
        self.apply(edit)
    }

    /// Wraps the selection in `prefix` and `suffix`, e.g. `**` for bold.
    pub fn wrap_selection(&mut self, prefix: &str, suffix: &str) -> Result<(), TypesetError> {
        if self.readonly {
            return Err(TypesetError::ReadOnly);
        }
        let selection = self.selection.range();
        let edit = self.document.wrap_selection(selection, prefix, suffix)?;
        self.apply(edit)
    }

    /// Toggles a line prefix such as `> ` or `- ` on every selected line.
    pub fn toggle_line_prefix(&mut self, prefix: &str) -> Result<(), TypesetError> {
        if self.readonly {
            return Err(TypesetError::ReadOnly);
        }
        let selection = self.selection.range();
        let edit = self.document.toggle_line_prefix(selection, prefix)?;
        self.apply(edit)
    }

    /// Replaces the text of the table cell that contains `offset`.
    ///
    /// A table cell is its own editable region: its `content_range` excludes the
    /// surrounding pipes and padding, so writing into it leaves the table's
    /// shape untouched. Returns `None` when `offset` is not inside a cell.
    pub fn set_table_cell(
        &mut self,
        offset: usize,
        text: &str,
    ) -> Option<Result<(), TypesetError>> {
        if self.readonly {
            return Some(Err(TypesetError::ReadOnly));
        }
        let cell = self.cell_at(offset)?;
        let range = cell.content_range.clone();
        let caret = range.start + text.len();
        Some(self.apply(SourceEdit {
            range,
            replacement: text.to_string(),
            selection_after: caret..caret,
        }))
    }

    /// The table cell whose content contains `offset`, if any.
    pub fn cell_at(&self, offset: usize) -> Option<SourceBlock> {
        let blocks = self.document.blocks().ok()?;
        fn walk(blocks: &[SourceBlock], offset: usize) -> Option<SourceBlock> {
            for block in blocks {
                if matches!(block.kind, BlockKind::TableCell)
                    && block.content_range.contains(&offset)
                {
                    return Some(block.clone());
                }
                if let Some(found) = walk(&block.children, offset) {
                    return Some(found);
                }
            }
            None
        }
        walk(&blocks, offset)
    }

    /// Applies `edit` and moves the caret to the edit's own selection.
    fn apply(&mut self, edit: SourceEdit) -> Result<(), TypesetError> {
        let selection_after = edit.selection_after.clone();
        self.document = self.document.apply(&edit)?;
        self.selection = Selection::new(selection_after.start, selection_after.end);
        self.revision = self.revision.wrapping_add(1);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_caret_selection_is_collapsed_and_forward() {
        let selection = Selection::caret(4);
        assert!(selection.is_collapsed());
        assert!(!selection.is_reversed());
        assert_eq!(selection.range(), 4..4);
    }

    #[test]
    fn a_backwards_selection_normalizes_its_range() {
        let selection = Selection::new(9, 3);
        assert!(selection.is_reversed());
        assert_eq!(selection.range(), 3..9);
    }

    #[test]
    fn inserting_moves_the_caret_past_the_inserted_text() {
        let mut editor = TypesetEditor::new("ab");
        editor.set_caret(1);
        editor.insert("X").expect("insert should apply");
        assert_eq!(editor.source(), "aXb");
        assert_eq!(editor.selection().head(), 2);
        assert_eq!(editor.revision(), 1);
    }

    #[test]
    fn inserting_replaces_the_selection() {
        let mut editor = TypesetEditor::new("hello world");
        editor.set_selection(6, 11);
        editor.insert("there").expect("insert should apply");
        assert_eq!(editor.source(), "hello there");
    }

    #[test]
    fn a_readonly_document_rejects_edits() {
        let mut editor = TypesetEditor::new("abc");
        editor.set_readonly(true);
        assert!(editor.insert("x").is_err());
        assert_eq!(editor.source(), "abc");
        assert_eq!(editor.revision(), 0);
    }

    #[test]
    fn setting_a_heading_rewrites_the_line_and_reports_a_revision() {
        let mut editor = TypesetEditor::new("Title\n");
        editor.set_caret(0);
        editor.set_heading(2).expect("heading should apply");
        assert_eq!(editor.source(), "## Title\n");
        assert_eq!(editor.revision(), 1);
    }

    #[test]
    fn wrapping_a_selection_keeps_the_inner_text_selected() {
        let mut editor = TypesetEditor::new("word");
        editor.set_selection(0, 4);
        editor
            .wrap_selection("**", "**")
            .expect("wrap should apply");
        assert_eq!(editor.source(), "**word**");
        assert_eq!(editor.selection().range(), 2..6);
    }

    #[test]
    fn a_table_cell_is_edited_without_disturbing_its_pipes() {
        let mut editor = TypesetEditor::new("| a | b |\n| --- | --- |\n| c | d |\n");
        // Offset 2 is inside the first header cell's content.
        editor
            .set_table_cell(2, "alpha")
            .expect("the offset is inside a cell")
            .expect("the edit should apply");
        assert_eq!(editor.source(), "| alpha | b |\n| --- | --- |\n| c | d |\n");
    }

    #[test]
    fn an_offset_outside_a_table_reports_no_cell() {
        let editor = TypesetEditor::new("Just a paragraph.\n");
        assert!(editor.cell_at(3).is_none());
    }

    #[test]
    fn a_task_list_toggle_writes_a_checkbox_not_a_bullet() {
        let mut editor = TypesetEditor::new("item\n");
        editor.set_caret(0);
        editor
            .toggle_line_prefix("- [ ] ")
            .expect("the prefix should apply");
        assert_eq!(editor.source(), "- [ ] item\n");
    }

    #[test]
    fn replacing_the_source_clamps_the_caret() {
        let mut editor = TypesetEditor::new("a much longer document");
        editor.set_caret(20);
        editor.replace_source("short");
        assert_eq!(editor.source(), "short");
        assert_eq!(editor.selection().head(), 5);
    }
}
