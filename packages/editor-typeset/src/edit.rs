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

use crate::movement::{move_left, move_right};
use inkpoint_editor_core::{BlockKind, EditError, MarkdownDocument, SourceBlock, SourceEdit};

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

/// One undoable step: the whole source before the edit, plus the selection.
///
/// Storing the full source per step is simpler and safer than inverting each
/// edit, and a Markdown buffer is small enough that the cost does not matter
/// against the risk of an inverse that disagrees with the forward edit.
#[derive(Clone, Debug)]
struct Snapshot {
    source: String,
    anchor: usize,
    head: usize,
}

/// A bounded undo/redo stack of whole-source snapshots.
///
/// Deliberately simple: a Markdown buffer is small, and restoring a snapshot
/// cannot disagree with the edit that produced it the way an inverse operation
/// can. The bound keeps memory flat over a long session.
#[derive(Debug)]
struct History {
    undos: Vec<Snapshot>,
    redos: Vec<Snapshot>,
    limit: usize,
    /// Where the step on top of the stack ended, so a typing burst only joins
    /// when the next character continues from exactly there.
    ///
    /// Without this, typing "ab", clicking back to the start and typing "X"
    /// would merge into one step whose restore point predates the "ab".
    joined_end: Option<usize>,
    /// Whether an IME composition is in progress.
    ///
    /// A composition rewrites the same region on every keystroke, so its
    /// offsets move backwards and a positional join cannot match. It is its own
    /// state rather than "join anything": without that, composing after an
    /// unrelated edit would merge the two into one undo step.
    composing: bool,
}

impl History {
    fn new(limit: usize) -> Self {
        Self {
            undos: Vec::new(),
            redos: Vec::new(),
            limit,
            joined_end: None,
            composing: false,
        }
    }

    /// Whether a composition is already on top of the stack.
    fn is_composing(&self) -> bool {
        self.composing
    }

    /// Marks that a composition is starting or continuing.
    fn begin_composition(&mut self) {
        self.composing = true;
    }

    /// Ends the composition, so the next edit starts a new step.
    fn end_composition(&mut self) {
        self.composing = false;
    }

    /// Whether a character typed at `at` continues the step on top.
    fn continues_at(&self, at: usize) -> bool {
        self.joined_end == Some(at)
    }

    /// Records `snapshot` and drops the redo branch, which a new edit invalidates.
    ///
    /// `joins_previous` says this edit continues the step already on top rather
    /// than starting a new one. It is a parameter, not stored state: a stored
    /// flag has to be cleared by every caller that does not want to join, and the
    /// first one that forgets silently merges unrelated edits into one undo step.
    fn push(&mut self, snapshot: Snapshot, joins_previous: bool, ends_at: usize) {
        if self.limit == 0 {
            return;
        }
        // Joining keeps the earlier snapshot: the step is "the state before the
        // burst", so only the first push of the burst matters.
        if joins_previous && !self.undos.is_empty() {
            self.redos.clear();
            self.joined_end = Some(ends_at);
            return;
        }
        if self.undos.len() == self.limit {
            self.undos.remove(0);
        }
        self.undos.push(snapshot);
        self.redos.clear();
        self.joined_end = Some(ends_at);
        // Any step that starts fresh also ends a composition: the next keystroke
        // must not join a step it has nothing to do with.
        if !joins_previous {
            self.composing = false;
        }
    }

    fn undo(&mut self, current: Snapshot) -> Option<Snapshot> {
        self.joined_end = None;
        self.composing = false;
        let previous = self.undos.pop()?;
        if self.redos.len() == self.limit {
            self.redos.remove(0);
        }
        self.redos.push(current);
        Some(previous)
    }

    fn redo(&mut self, current: Snapshot) -> Option<Snapshot> {
        self.joined_end = None;
        self.composing = false;
        let next = self.redos.pop()?;
        if self.undos.len() == self.limit {
            self.undos.remove(0);
        }
        self.undos.push(current);
        Some(next)
    }

    /// Drops both stacks, for when the buffer is replaced wholesale.
    fn clear(&mut self) {
        self.undos.clear();
        self.redos.clear();
        self.joined_end = None;
        self.composing = false;
    }

    fn can_undo(&self) -> bool {
        !self.undos.is_empty()
    }

    fn can_redo(&self) -> bool {
        !self.redos.is_empty()
    }
}

/// The most edits one document remembers for undo.
const HISTORY_LIMIT: usize = 200;

/// An editable Markdown document with a caret and selection.
pub struct TypesetEditor {
    document: MarkdownDocument,
    selection: Selection,
    revision: u64,
    readonly: bool,
    history: History,
}

impl TypesetEditor {
    /// Opens `source` with a caret at the start.
    pub fn new(source: impl Into<String>) -> Self {
        Self {
            document: MarkdownDocument::new(source),
            selection: Selection::caret(0),
            revision: 0,
            readonly: false,
            history: History::new(HISTORY_LIMIT),
        }
    }

    /// The current state as an undoable snapshot.
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            source: self.document.source().to_string(),
            anchor: self.selection.anchor(),
            head: self.selection.head(),
        }
    }

    /// Restores `snapshot` and bumps the revision.
    fn restore(&mut self, snapshot: Snapshot) {
        self.document = MarkdownDocument::new(snapshot.source);
        self.selection = Selection::new(snapshot.anchor, snapshot.head);
        self.revision = self.revision.wrapping_add(1);
    }

    /// Whether there is an edit to undo.
    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }

    /// Whether there is an undone edit to redo.
    pub fn can_redo(&self) -> bool {
        self.history.can_redo()
    }

    /// Reverts the last edit, returning whether anything changed.
    pub fn undo(&mut self) -> bool {
        if self.readonly {
            return false;
        }
        let current = self.snapshot();
        let Some(previous) = self.history.undo(current) else {
            return false;
        };
        self.restore(previous);
        true
    }

    /// Reapplies the last undone edit, returning whether anything changed.
    pub fn redo(&mut self) -> bool {
        if self.readonly {
            return false;
        }
        let current = self.snapshot();
        let Some(next) = self.history.redo(current) else {
            return false;
        };
        self.restore(next);
        true
    }

    /// Applies `edit`, recording the pre-edit state only if it lands.
    ///
    /// The snapshot has to describe the state before the edit, so it is taken
    /// first — but committed afterwards. Pushing it up front would leave a
    /// phantom step when the edit is rejected, and `push` also drops the redo
    /// branch, so a failed edit would silently discard the user's redo.
    fn apply_recording(&mut self, edit: SourceEdit) -> Result<(), TypesetError> {
        self.apply_recording_joining(edit, false)
    }

    /// Applies `edit`, optionally continuing the undo step already on top.
    ///
    /// Only consecutive single characters typed at a collapsed caret join: a
    /// paste, a formatting command, a delete or a click that moved the caret all
    /// start their own step, because each is a distinct thing the user did.
    fn apply_recording_joining(
        &mut self,
        edit: SourceEdit,
        joins_previous: bool,
    ) -> Result<(), TypesetError> {
        let at = edit.range.start;
        let ends_at = edit.selection_after.end;
        let before = self.snapshot();
        self.apply(edit)?;
        // A join also requires the edit to start exactly where the previous step
        // ended; otherwise a click that moved the caret would be swallowed.
        let joins = joins_previous && self.history.continues_at(at);
        self.history.push(before, joins, ends_at);
        Ok(())
    }

    /// Applies an edit that joins the current step regardless of position.
    ///
    /// For an IME: every keystroke rewrites the composing region from its start,
    /// so the offset moves backwards and a positional join would never match.
    fn apply_recording_joining_anywhere(&mut self, edit: SourceEdit) -> Result<(), TypesetError> {
        let ends_at = edit.selection_after.end;
        // Join only when a composition is already on top. The first keystroke of
        // a composition starts its own step, so composing after an unrelated edit
        // does not merge the two.
        let joins = self.history.is_composing() && !self.history.undos.is_empty();
        let before = self.snapshot();
        self.apply(edit)?;
        // Mark the composition *after* the push: a fresh push ends any previous
        // composition, and this one has to survive that.
        self.history.push(before, joins, ends_at);
        self.history.begin_composition();
        Ok(())
    }

    /// Ends a composition, so the next keystroke starts a new undo step.
    ///
    /// Called when the platform commits the composition.
    pub fn commit_composition(&mut self) {
        self.history.end_composition();
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
        // The history belongs to the document that was open. Keeping it would
        // let undo restore the previous file's text into this one.
        self.history.clear();
    }

    /// Moves the caret to `offset`, clamped to the source length.
    pub fn set_caret(&mut self, offset: usize) {
        let offset = offset.min(self.document.source().len());
        self.selection = Selection::caret(offset);
    }

    /// Sets the selection, clamped to the source length.
    pub fn set_selection(&mut self, anchor: usize, head: usize) {
        let len = self.document.source().len();
        self.selection = Selection::new(anchor.min(len), head.min(len));
    }

    /// Deletes the selection, or one character before the caret when collapsed.
    ///
    /// This is one operation, not "extend the selection, then insert nothing":
    /// splitting it would record the extended selection as the undo state, so
    /// undo would restore a selection the user never had.
    pub fn delete_backward(&mut self) -> Result<(), TypesetError> {
        if self.readonly {
            return Err(TypesetError::ReadOnly);
        }
        let range = self.selection.range();
        let target = if range.is_empty() {
            let previous = move_left(self.document.source(), Caret::new(range.start)).index;
            previous..range.start
        } else {
            range
        };
        self.apply_recording(SourceEdit {
            range: target.clone(),
            replacement: String::new(),
            selection_after: target.start..target.start,
        })
    }

    /// Deletes the selection, or one character after the caret when collapsed.
    ///
    /// The mirror of `delete_backward`, and one undo step for the same reason.
    pub fn delete_forward(&mut self) -> Result<(), TypesetError> {
        if self.readonly {
            return Err(TypesetError::ReadOnly);
        }
        let range = self.selection.range();
        let target = if range.is_empty() {
            let next = move_right(self.document.source(), Caret::new(range.start)).index;
            range.start..next
        } else {
            range
        };
        self.apply_recording(SourceEdit {
            range: target.clone(),
            replacement: String::new(),
            selection_after: target.start..target.start,
        })
    }

    /// The selected text, or an empty string for a bare caret.
    pub fn selected_text(&self) -> &str {
        let range = self.selection.range();
        self.document.source().get(range).unwrap_or_default()
    }

    /// Removes the selection and returns what was removed.
    ///
    /// One operation, like `delete_backward`: cutting must be one undo step and
    /// must not leave the caret in a state the user never chose.
    pub fn cut_selection(&mut self) -> Result<String, TypesetError> {
        if self.readonly {
            return Err(TypesetError::ReadOnly);
        }
        let range = self.selection.range();
        if range.is_empty() {
            return Ok(String::new());
        }
        let removed = self
            .document
            .source()
            .get(range.clone())
            .unwrap_or_default()
            .to_string();
        self.apply_recording(SourceEdit {
            range: range.clone(),
            replacement: String::new(),
            selection_after: range.start..range.start,
        })?;
        Ok(removed)
    }

    /// Inserts composition text, continuing the current undo step.
    ///
    /// An IME replaces the composing region on every keystroke, so treating each
    /// replacement as its own step makes undo replay composition stages instead
    /// of removing the character the user actually committed.
    pub fn insert_composing(&mut self, text: &str) -> Result<(), TypesetError> {
        if self.readonly {
            return Err(TypesetError::ReadOnly);
        }
        let range = self.selection.range();
        let caret = range.start + text.len();
        let edit = SourceEdit {
            range,
            replacement: text.to_string(),
            selection_after: caret..caret,
        };
        // A composition rewrites the same region each keystroke, so the start
        // moves backwards relative to the previous end. Positional joining would
        // therefore never match; a composition always joins its own step.
        self.apply_recording_joining_anywhere(edit)
    }

    /// Inserts `text` at the caret, replacing the selection.
    pub fn insert(&mut self, text: &str) -> Result<(), TypesetError> {
        if self.readonly {
            return Err(TypesetError::ReadOnly);
        }
        let range = self.selection.range();
        let caret = range.start + text.len();
        // Typing one character at a caret is a burst: consecutive characters
        // join one undo step so Cmd-Z steps back a word rather than a letter.
        // Anything else — a paste, a replacement of a selection, a formatting
        // command — is its own step.
        let typing = range.start == range.end && text.chars().count() == 1;
        let edit = SourceEdit {
            range,
            replacement: text.to_string(),
            selection_after: caret..caret,
        };
        self.apply_recording_joining(edit, typing)
    }

    /// Sets the heading level of every line the selection touches.
    pub fn set_heading(&mut self, level: u8) -> Result<(), TypesetError> {
        if self.readonly {
            return Err(TypesetError::ReadOnly);
        }
        let selection = self.selection.range();
        let edit = self.document.set_heading(selection, level)?;
        self.apply_recording(edit)
    }

    /// Wraps the selection in `prefix` and `suffix`, e.g. `**` for bold.
    pub fn wrap_selection(&mut self, prefix: &str, suffix: &str) -> Result<(), TypesetError> {
        if self.readonly {
            return Err(TypesetError::ReadOnly);
        }
        let selection = self.selection.range();
        let edit = self.document.wrap_selection(selection, prefix, suffix)?;
        self.apply_recording(edit)
    }

    /// Toggles a line prefix such as `> ` or `- ` on every selected line.
    pub fn toggle_line_prefix(&mut self, prefix: &str) -> Result<(), TypesetError> {
        if self.readonly {
            return Err(TypesetError::ReadOnly);
        }
        let selection = self.selection.range();
        let edit = self.document.toggle_line_prefix(selection, prefix)?;
        self.apply_recording(edit)
    }

    /// Replaces the text of the table cell that contains `offset`.
    ///
    /// A table cell is its own editable region: its `content_range` excludes the
    /// surrounding pipes and padding, so writing into it leaves the table's
    /// shape untouched. Returns `None` when `offset` is not inside a cell.
    ///
    /// Typing in a cell goes through plain `insert` with the caret inside it;
    /// this is the programmatic writer, for a host that knows a cell's offset and
    /// wants to set its whole content in one step.
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
        Some(self.apply_recording(SourceEdit {
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
    fn typing_into_a_table_cell_works_without_the_cell_api() {
        // Users edit a table cell by putting the caret in it and typing. That
        // path is plain `insert`, so the dedicated cell writer is not needed for
        // editing to work.
        let mut editor = TypesetEditor::new("| a | b |\n| --- | --- |\n| c | d |\n");
        editor.set_caret(2);
        editor.insert("X").expect("typing applies");
        assert_eq!(editor.source(), "| Xa | b |\n| --- | --- |\n| c | d |\n");
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
    fn delete_backward_removes_one_character_and_undoes_as_one_step() {
        let mut editor = TypesetEditor::new("abc");
        editor.set_caret(3);
        editor.delete_backward().expect("delete applies");
        assert_eq!(editor.source(), "ab");
        assert_eq!(editor.selection().head(), 2);
        // One undo restores the character and the caret that preceded it, with
        // no intermediate "selection extended" state.
        assert!(editor.undo());
        assert_eq!(editor.source(), "abc");
        assert_eq!(
            editor.selection().range(),
            3..3,
            "a collapsed caret, not a selection"
        );
    }

    #[test]
    fn delete_backward_removes_a_selection_in_one_step() {
        let mut editor = TypesetEditor::new("hello world");
        editor.set_selection(5, 11);
        editor.delete_backward().expect("delete applies");
        assert_eq!(editor.source(), "hello");
        assert!(editor.undo());
        assert_eq!(editor.source(), "hello world");
    }

    #[test]
    fn replacing_the_source_clears_the_history() {
        // Undo after a reload would otherwise restore the previous file's text
        // into the newly opened one.
        let mut editor = TypesetEditor::new("first file");
        editor.set_caret(5);
        editor.insert("X").expect("insert applies");
        assert!(editor.can_undo());
        editor.replace_source("second file");
        assert!(
            !editor.can_undo(),
            "a new document must not inherit the old undo history"
        );
        assert!(!editor.redo());
    }

    #[test]
    fn a_rejected_edit_leaves_no_undo_step_and_keeps_redo() {
        let mut editor = TypesetEditor::new("ab");
        editor.set_caret(1);
        editor.insert("X").expect("insert applies");
        assert!(editor.undo());
        assert!(editor.can_redo());
        // A rejected edit must not consume the redo branch or add a step.
        editor.set_readonly(true);
        assert!(editor.insert("Y").is_err());
        assert!(editor.can_redo(), "a failed edit must not drop redo");
        editor.set_readonly(false);
        assert!(editor.redo());
        assert_eq!(editor.source(), "aXb");
    }

    #[test]
    fn undo_restores_the_text_and_the_caret() {
        let mut editor = TypesetEditor::new("ab");
        editor.set_caret(1);
        editor.insert("X").expect("insert applies");
        assert_eq!(editor.source(), "aXb");
        assert!(editor.can_undo());
        assert!(editor.undo());
        assert_eq!(editor.source(), "ab", "undo restores the previous text");
        assert_eq!(editor.selection().head(), 1, "and the caret it had");
    }

    #[test]
    fn redo_reapplies_the_undone_edit() {
        let mut editor = TypesetEditor::new("ab");
        editor.set_caret(1);
        editor.insert("X").expect("insert applies");
        assert!(editor.undo());
        assert!(editor.can_redo());
        assert!(editor.redo());
        assert_eq!(editor.source(), "aXb");
    }

    #[test]
    fn a_new_edit_drops_the_redo_branch() {
        let mut editor = TypesetEditor::new("ab");
        editor.set_caret(1);
        editor.insert("X").expect("insert applies");
        assert!(editor.undo());
        editor.insert("Y").expect("insert applies");
        assert!(!editor.can_redo(), "a fresh edit invalidates redo");
    }

    #[test]
    fn undo_and_redo_report_nothing_when_the_stack_is_empty() {
        let mut editor = TypesetEditor::new("ab");
        assert!(!editor.can_undo());
        assert!(!editor.undo());
        assert!(!editor.can_redo());
        assert!(!editor.redo());
    }

    #[test]
    fn a_readonly_document_refuses_undo() {
        let mut editor = TypesetEditor::new("ab");
        editor.set_caret(1);
        editor.insert("X").expect("insert applies");
        editor.set_readonly(true);
        assert!(!editor.undo(), "read-only means no history movement either");
        assert_eq!(editor.source(), "aXb");
    }

    #[test]
    fn a_burst_of_typing_undoes_as_one_step() {
        // Consecutive single characters are one thing the user did, so one undo
        // must take back the whole burst rather than one letter of it.
        let mut editor = TypesetEditor::new("");
        editor.set_caret(0);
        editor.insert("a").expect("insert applies");
        editor.insert("b").expect("insert applies");
        editor.insert("c").expect("insert applies");
        assert_eq!(editor.source(), "abc");
        assert!(editor.undo());
        assert_eq!(editor.source(), "", "one undo takes back the whole burst");
        assert!(editor.redo());
        assert_eq!(editor.source(), "abc");
    }

    #[test]
    fn a_paste_is_its_own_undo_step() {
        // Multi-character input is not typing: it must not join the burst.
        let mut editor = TypesetEditor::new("");
        editor.set_caret(0);
        editor.insert("a").expect("insert applies");
        editor.insert("pasted").expect("insert applies");
        assert_eq!(editor.source(), "apasted");
        assert!(editor.undo());
        assert_eq!(editor.source(), "a", "undo takes back only the paste");
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

#[cfg(test)]
mod undo_sequence_tests {
    use super::*;

    /// Typing, then a formatting command, then undo must restore the typed text.
    ///
    /// A stored "keep joining" flag used to make the bold command join the
    /// typing burst, so one undo took the text away instead of the bold.
    #[test]
    fn a_formatting_command_after_typing_is_its_own_undo_step() {
        let mut editor = TypesetEditor::new("");
        editor.set_caret(0);
        editor.insert("a").expect("typing applies");
        editor.set_selection(0, 1);
        editor.wrap_selection("**", "**").expect("bold applies");
        assert_eq!(editor.source(), "**a**");
        assert!(editor.undo(), "undo takes back the bold");
        assert_eq!(editor.source(), "a", "the typed text survives");
    }

    /// A click that moves the caret ends the burst.
    #[test]
    fn typing_after_a_caret_move_starts_a_new_step() {
        let mut editor = TypesetEditor::new("");
        editor.set_caret(0);
        editor.insert("a").expect("typing applies");
        editor.insert("b").expect("typing applies");
        assert_eq!(editor.source(), "ab");
        editor.set_caret(0);
        editor.insert("X").expect("typing applies");
        assert_eq!(editor.source(), "Xab");
        assert!(editor.undo());
        assert_eq!(editor.source(), "ab", "undo takes back only the X");
    }

    /// Backspace is its own step even right after typing.
    #[test]
    fn backspace_after_typing_is_its_own_undo_step() {
        let mut editor = TypesetEditor::new("");
        editor.set_caret(0);
        editor.insert("a").expect("typing applies");
        editor.delete_backward().expect("delete applies");
        assert_eq!(editor.source(), "");
        assert!(editor.undo(), "undo brings the character back");
        assert_eq!(editor.source(), "a", "and only the delete is undone");
    }

    /// A line-prefix command after typing is its own step.
    #[test]
    fn a_prefix_command_after_typing_is_its_own_undo_step() {
        let mut editor = TypesetEditor::new("");
        editor.set_caret(0);
        editor.insert("y").expect("typing applies");
        editor.toggle_line_prefix("> ").expect("quote applies");
        assert_eq!(editor.source(), "> y");
        assert!(editor.undo());
        assert_eq!(editor.source(), "y", "the typed text survives");
    }

    /// A table-cell write after typing is its own step.
    #[test]
    fn a_table_cell_write_after_typing_is_its_own_undo_step() {
        let mut editor = TypesetEditor::new("Z\n\n| a | b |\n| --- | --- |\n");
        editor.set_caret(1);
        // Find a cell offset rather than assuming one: the parser's ranges depend
        // on how it slices pipes and padding.
        let offset = (0..editor.source().len())
            .find(|offset| editor.cell_at(*offset).is_some())
            .expect("a table cell exists");
        let cell = editor.cell_at(offset).expect("the first cell");
        editor
            .set_table_cell(cell.content_range.start, "cell")
            .expect("the offset is inside a cell")
            .expect("the write applies");
        assert!(editor.undo(), "undo takes back the cell write");
        assert!(
            editor.source().contains("| a | b |"),
            "and leaves the cell as it was: {:?}",
            editor.source()
        );
    }

    /// Forward delete removes the character after the caret, in one step.
    #[test]
    fn delete_forward_removes_the_next_character() {
        let mut editor = TypesetEditor::new("abc");
        editor.set_caret(1);
        editor.delete_forward().expect("delete applies");
        assert_eq!(editor.source(), "ac");
        assert!(editor.undo());
        assert_eq!(editor.source(), "abc");
    }

    /// Composition keystrokes join one undo step.
    ///
    /// The view sets the selection to the composing region and calls
    /// `insert_composing`; that selection change is part of the composition, not
    /// an unrelated edit, so the step still joins.
    #[test]
    fn composition_keystrokes_undo_as_one_step() {
        let mut editor = TypesetEditor::new("");
        editor.set_caret(0);
        editor.insert_composing("z").expect("applies");
        editor.set_selection(0, 1);
        editor.insert_composing("zh").expect("applies");
        editor.set_selection(0, 2);
        editor.insert_composing("zhong").expect("applies");
        assert_eq!(editor.source(), "zhong");
        assert!(editor.undo());
        assert_eq!(
            editor.source(),
            "",
            "one undo removes the composed character, not a stage of it"
        );
    }

    /// Composing after an unrelated edit must not merge the two.
    ///
    /// A composition rewrites the same region each keystroke, so it joins its own
    /// step — but joining "whatever is on top" would make one undo erase the
    /// earlier, unrelated edit as well.
    #[test]
    fn composition_after_an_unrelated_edit_is_its_own_step() {
        let mut editor = TypesetEditor::new("");
        editor.set_caret(0);
        editor.insert("a").expect("typing applies");
        editor.insert("b").expect("typing applies");
        editor.insert("c").expect("typing applies");
        assert_eq!(editor.source(), "abc");
        // Move elsewhere and compose a character.
        editor.set_caret(0);
        editor.insert_composing("中").expect("composition applies");
        assert_eq!(editor.source(), "中abc");
        assert!(editor.undo());
        assert_eq!(
            editor.source(),
            "abc",
            "one undo removes the composition only, not the earlier typing"
        );
    }

    /// Consecutive characters at one place still merge.
    #[test]
    fn consecutive_characters_still_merge_into_one_step() {
        let mut editor = TypesetEditor::new("");
        editor.set_caret(0);
        for character in ["a", "b", "c"] {
            editor.insert(character).expect("typing applies");
        }
        assert_eq!(editor.source(), "abc");
        assert!(editor.undo());
        assert_eq!(editor.source(), "", "one undo takes back the burst");
    }
}
