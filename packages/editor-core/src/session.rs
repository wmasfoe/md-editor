//! The editable surface: document state, caret and selection, and the
//! operations that change the Markdown.
//!
//! gpui-kit renders the document and reports geometry. This module owns what
//! the renderer deliberately leaves to the host: which byte range is selected,
//! where the caret sits, and how a command rewrites the source.
//!
//! Offsets here are UTF-8 byte offsets into the Markdown source, matching both
//! [`inkpoint_editor_core`] and the leaf geometry gpui-kit reports.

use std::borrow::Cow;
use std::ops::Range;

use unicode_segmentation::{GraphemeCursor, UnicodeSegmentation};

pub fn previous_grapheme(source: &str, offset: usize) -> usize {
    let offset = normalize_offset(source, offset, false);
    source[..offset]
        .grapheme_indices(true)
        .next_back()
        .map_or(0, |(i, _)| i)
}

pub fn next_grapheme(source: &str, offset: usize) -> usize {
    let offset = normalize_offset(source, offset, true);
    source[offset..]
        .graphemes(true)
        .next()
        .map_or(source.len(), |g| offset + g.len())
}

fn word_left(source: &str, offset: usize) -> usize {
    let offset = normalize_offset(source, offset, false);
    let mut chars: Vec<_> = source[..offset].char_indices().collect();
    while let Some((_, ch)) = chars.last() {
        if ch.is_whitespace() && *ch != '\n' {
            chars.pop();
        } else {
            break;
        }
    }
    let class = chars.last().map(|(_, ch)| word_class(*ch));
    while chars
        .last()
        .is_some_and(|(_, ch)| Some(word_class(*ch)) == class)
    {
        chars.pop();
    }
    chars.last().map_or(0, |(i, ch)| i + ch.len_utf8())
}

fn word_right(source: &str, offset: usize) -> usize {
    let offset = normalize_offset(source, offset, true);
    let mut iter = source[offset..].char_indices().peekable();
    while let Some((i, ch)) = iter.peek().copied() {
        if ch.is_whitespace() {
            iter.next();
            if ch == '\n' {
                return offset + i + 1;
            }
        } else {
            break;
        }
    }
    let Some((_, first)) = iter.peek().copied() else {
        return source.len();
    };
    let class = word_class(first);
    while iter.peek().is_some_and(|(_, ch)| word_class(*ch) == class) {
        iter.next();
    }
    iter.peek().map_or(source.len(), |(i, _)| offset + *i)
}

fn word_class(ch: char) -> u8 {
    if ch.is_whitespace() {
        0
    } else if ch.is_alphanumeric() || ch == '_' {
        1
    } else {
        2
    }
}

/// Move an offset to a safe grapheme boundary. `forward` selects the trailing
/// boundary when the offset falls inside a cluster.
pub fn normalize_offset(source: &str, offset: usize, forward: bool) -> usize {
    let offset = offset.min(source.len());
    let boundary = if forward {
        source.ceil_char_boundary(offset)
    } else {
        source.floor_char_boundary(offset)
    };
    let mut cursor = GraphemeCursor::new(boundary, source.len(), true);
    if cursor.is_boundary(source, 0) == Ok(true) {
        return boundary;
    }
    // The entire source is available to the cursor, so any contextual lookup
    // stays in this chunk even for clusters made of several Unicode scalars.
    if forward {
        cursor
            .next_boundary(source, 0)
            .ok()
            .flatten()
            .unwrap_or(source.len())
    } else {
        cursor.prev_boundary(source, 0).ok().flatten().unwrap_or(0)
    }
}
use crate::{EditError, MarkdownDocument, SourceEdit};

/// Why an edit did not apply.
///
/// The source-level failures come from [`inkpoint_editor_core`]; a read-only
/// document is this crate's own rule, so it stays here rather than widening the
/// core contract.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionError {
    /// The document rejects edits.
    ReadOnly,
    /// The edit could not be applied to the source.
    Source(EditError),
    /// A cached match range no longer holds the bytes it was found at.
    ///
    /// Separate from `Source(InvalidRange)` because it is not a caller bug: the
    /// document legitimately changed since the match was found, and the right
    /// response is to re-run the search rather than report a malformed edit.
    StaleMatch,
}

/// A renderer-independent user editing intent.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EditorIntent {
    Insert(String),
    DeleteBackward,
    DeleteForward,
    Replace { range: Range<usize>, text: String },
}

/// The committed source change caused by a dispatched intent.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EditorDelta {
    pub replaced: Range<usize>,
    pub inserted: String,
    pub selection: Range<usize>,
    pub revision: u64,
}

impl From<EditError> for SessionError {
    fn from(error: EditError) -> Self {
        Self::Source(error)
    }
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ReadOnly => formatter.write_str("The document is read-only."),
            Self::Source(error) => error.fmt(formatter),
            Self::StaleMatch => formatter
                .write_str("The document changed since this match was found; search again."),
        }
    }
}

impl std::error::Error for SessionError {}

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

/// An undo record stores only the changed slice and selection state.
#[derive(Clone, Debug)]
struct HistoryStep {
    range: Range<usize>,
    removed: String,
    inserted: String,
    before_anchor: usize,
    before_head: usize,
    after_anchor: usize,
    after_head: usize,
}

#[derive(Debug)]
struct History {
    undos: Vec<HistoryStep>,
    redos: Vec<HistoryStep>,
    limit: usize,
    joined_end: Option<usize>,
}

impl History {
    fn new(limit: usize) -> Self {
        Self {
            undos: Vec::new(),
            redos: Vec::new(),
            limit,
            joined_end: None,
        }
    }
    fn continues_at(&self, at: usize) -> bool {
        self.joined_end == Some(at)
    }
    fn push(&mut self, step: HistoryStep, joins_previous: bool, allows_join: bool, ends_at: usize) {
        if self.limit == 0 {
            return;
        }
        if joins_previous && let Some(previous) = self.undos.last_mut() {
            previous.inserted.push_str(&step.inserted);
            previous.after_anchor = step.after_anchor;
            previous.after_head = step.after_head;
        } else {
            if self.undos.len() == self.limit {
                self.undos.remove(0);
            }
            self.undos.push(step);
        }
        self.redos.clear();
        self.joined_end = allows_join.then_some(ends_at);
    }
    fn undo(&mut self) -> Option<HistoryStep> {
        self.joined_end = None;
        let step = self.undos.pop()?;
        if self.redos.len() == self.limit {
            self.redos.remove(0);
        }
        self.redos.push(step.clone());
        Some(step)
    }
    fn redo(&mut self) -> Option<HistoryStep> {
        self.joined_end = None;
        let step = self.redos.pop()?;
        if self.undos.len() == self.limit {
            self.undos.remove(0);
        }
        self.undos.push(step.clone());
        Some(step)
    }
    fn clear(&mut self) {
        self.undos.clear();
        self.redos.clear();
        self.joined_end = None;
    }
    fn can_undo(&self) -> bool {
        !self.undos.is_empty()
    }
    fn can_redo(&self) -> bool {
        !self.redos.is_empty()
    }
    fn update_last_selection(&mut self, anchor: usize, head: usize) {
        if let Some(step) = self.undos.last_mut() {
            step.after_anchor = anchor;
            step.after_head = head;
        }
    }
}

/// Maximum number of changed slices retained for undo and redo.
const HISTORY_LIMIT: usize = 200;

/// An editable Markdown document with a caret and selection.
pub struct EditorSession {
    document: MarkdownDocument,
    selection: Selection,
    revision: u64,
    readonly: bool,
    history: History,
    composition: Option<Composition>,
    parsed_blocks: Option<Vec<crate::SourceBlock>>,
}

#[derive(Clone, Debug)]
struct Composition {
    range: Range<usize>,
    text: String,
    selected: Range<usize>,
}

impl EditorSession {
    /// Opens `source` with a caret at the start.
    pub fn new(source: impl Into<String>) -> Self {
        Self {
            document: MarkdownDocument::new(source),
            selection: Selection::caret(0),
            revision: 0,
            readonly: false,
            history: History::new(HISTORY_LIMIT),
            composition: None,
            parsed_blocks: None,
        }
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
        let Some(step) = self.history.undo() else {
            return false;
        };
        let start = step.range.start;
        let selection_after =
            step.before_anchor.min(step.before_head)..step.before_anchor.max(step.before_head);
        if self
            .apply(SourceEdit {
                range: start..start + step.inserted.len(),
                replacement: step.removed,
                selection_after,
            })
            .is_err()
        {
            return false;
        }
        self.selection = Selection::new(step.before_anchor, step.before_head);
        true
    }

    /// Reapplies the last undone edit, returning whether anything changed.
    pub fn redo(&mut self) -> bool {
        if self.readonly {
            return false;
        }
        let Some(step) = self.history.redo() else {
            return false;
        };
        let start = step.range.start;
        let selection_after =
            step.after_anchor.min(step.after_head)..step.after_anchor.max(step.after_head);
        if self
            .apply(SourceEdit {
                range: start..start + step.removed.len(),
                replacement: step.inserted,
                selection_after,
            })
            .is_err()
        {
            return false;
        }
        self.selection = Selection::new(step.after_anchor, step.after_head);
        true
    }

    /// Applies `edit`, recording its inverse only if it lands. Recording after
    /// validation avoids phantom undo steps and preserves redo on failure.
    fn apply_recording(&mut self, edit: SourceEdit) -> Result<(), SessionError> {
        self.apply_recording_joining(edit, false)
    }

    /// Applies an edit. Single-character typing starts a burst that consecutive
    /// insertions at its end can continue, including when the first character
    /// replaced a selection.
    fn apply_recording_joining(
        &mut self,
        edit: SourceEdit,
        typing: bool,
    ) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let at = edit.range.start;
        let ends_at = edit.selection_after.end;
        let before = HistoryStep {
            range: edit.range.clone(),
            removed: self
                .source()
                .get(edit.range.clone())
                .ok_or(SessionError::Source(crate::EditError::InvalidRange))?
                .to_string(),
            inserted: edit.replacement.clone(),
            before_anchor: self.selection.anchor(),
            before_head: self.selection.head(),
            after_anchor: edit.selection_after.start,
            after_head: edit.selection_after.end,
        };
        let joins = typing && edit.range.is_empty() && self.history.continues_at(at);
        self.apply(edit)?;
        self.history.push(before, joins, typing, ends_at);
        self.history
            .update_last_selection(self.selection.anchor(), self.selection.head());
        Ok(())
    }

    /// Starts platform preedit over a committed source range.
    pub fn begin_composition(&mut self, range: Range<usize>) {
        if self.readonly {
            return;
        }
        let source = self.source();
        let start = normalize_offset(source, range.start, false);
        let end = normalize_offset(source, range.end, true).max(start);
        self.composition = Some(Composition {
            range: start..end,
            text: String::new(),
            selected: 0..0,
        });
    }

    /// Updates uncommitted preedit text and its local selection.
    pub fn update_composition(&mut self, text: &str, selected: Range<usize>) {
        if self.composition.is_none() {
            self.begin_composition(self.selection.range());
        }
        if let Some(composition) = &mut self.composition {
            composition.text.clear();
            composition.text.push_str(text);
            composition.selected = normalize_offset(text, selected.start, false)
                ..normalize_offset(text, selected.end, true);
        }
    }

    /// Source with preedit substituted for display; committed source is unchanged.
    pub fn display_source(&self) -> Cow<'_, str> {
        let Some(composition) = &self.composition else {
            return Cow::Borrowed(self.source());
        };
        let mut display = String::with_capacity(self.source().len() + composition.text.len());
        display.push_str(&self.source()[..composition.range.start]);
        display.push_str(&composition.text);
        display.push_str(&self.source()[composition.range.end..]);
        Cow::Owned(display)
    }

    pub fn display_selection(&self) -> Range<usize> {
        self.composition.as_ref().map_or_else(
            || self.selection.range(),
            |c| c.range.start + c.selected.start..c.range.start + c.selected.end,
        )
    }

    pub fn set_composition_selection(&mut self, selected: Range<usize>) {
        if let Some(composition) = &mut self.composition {
            composition.selected = normalize_offset(&composition.text, selected.start, false)
                ..normalize_offset(&composition.text, selected.end, true);
        }
    }

    pub fn composition_target(&self) -> Option<Range<usize>> {
        self.composition.as_ref().map(|c| c.range.clone())
    }

    pub fn marked_range(&self) -> Option<Range<usize>> {
        self.composition
            .as_ref()
            .map(|c| c.range.start..c.range.start + c.text.len())
    }

    /// Commits preedit as one undoable source replacement.
    pub fn commit_composition(&mut self) {
        let Some(composition) = self.composition.take() else {
            return;
        };
        if self.readonly {
            return;
        }
        let start = composition.range.start;
        let selected = composition.selected;
        let _ = self.apply_recording(SourceEdit {
            range: composition.range,
            replacement: composition.text,
            selection_after: start + selected.start..start + selected.end,
        });
        self.set_selection(start + selected.start, start + selected.end);
    }

    pub fn commit_composition_with(&mut self, text: &str) {
        self.update_composition(text, text.len()..text.len());
        self.commit_composition();
    }

    pub fn cancel_composition(&mut self) {
        self.composition = None;
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
        self.selection = Selection::caret(normalize_offset(
            self.document.source(),
            self.selection.head().min(len),
            false,
        ));
        self.composition = None;
        self.parsed_blocks = None;
        self.revision = self.revision.wrapping_add(1);
        // The history belongs to the document that was open. Keeping it would
        // let undo restore the previous file's text into this one.
        self.history.clear();
    }

    /// Moves the caret to `offset`, clamped to the source length.
    pub fn set_caret(&mut self, offset: usize) {
        self.set_selection(offset, offset);
    }

    /// Sets the selection, clamped to the source length.
    pub fn set_selection(&mut self, anchor: usize, head: usize) {
        let source = self.document.source();
        let selection = Selection::new(
            normalize_offset(source, anchor, false),
            normalize_offset(source, head, false),
        );
        if selection != self.selection {
            self.selection = selection;
            self.history.joined_end = None;
        }
    }

    /// Applies an editing intent and reports the committed source delta.
    pub fn dispatch(&mut self, intent: EditorIntent) -> Result<Option<EditorDelta>, SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let (range, replacement, typing) = match intent {
            EditorIntent::Insert(text) => {
                let range = self.selection.range();
                if let Some(text) = self.with_trailing_paragraph_break(&range, &text) {
                    (range, text, false)
                } else {
                    let typing = text.graphemes(true).count() == 1;
                    (
                        range.clone(),
                        self.normalize_table_cell_text(&range, &text),
                        typing,
                    )
                }
            }
            EditorIntent::DeleteBackward => {
                let range = self.selection.range();
                let target = if range.is_empty() {
                    previous_grapheme(self.source(), range.start)..range.start
                } else {
                    range
                };
                (target, String::new(), false)
            }
            EditorIntent::DeleteForward => {
                let range = self.selection.range();
                let target = if range.is_empty() {
                    range.start..next_grapheme(self.source(), range.start)
                } else {
                    range
                };
                (target, String::new(), false)
            }
            EditorIntent::Replace { range, text } => (range, text, false),
        };
        if range.is_empty() && replacement.is_empty() {
            return Ok(None);
        }
        let replaced = range.clone();
        let inserted = replacement.clone();
        let caret = range.start + replacement.len();
        self.apply_recording_joining(
            SourceEdit {
                range,
                replacement,
                selection_after: caret..caret,
            },
            typing,
        )?;
        Ok(Some(EditorDelta {
            replaced,
            inserted,
            selection: caret..caret,
            revision: self.revision,
        }))
    }

    /// Deletes the selection, or one character before the caret when collapsed.
    ///
    /// This is one operation, not "extend the selection, then insert nothing":
    /// splitting it would record the extended selection as the undo state, so
    /// undo would restore a selection the user never had.
    pub fn delete_backward(&mut self) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let range = self.selection.range();
        if range.is_empty() {
            let pos = range.start;
            let source = self.document.source();
            // The byte before a fenced code body's first character is the
            // opening fence's newline, which is syntax, not text. Deleting it
            // merges the code into the info string (` ```jsconst n = 1; `) and
            // silently destroys the block. Refusing keeps the fence intact and
            // leaves the caret where the user put it.
            if crate::fence::at_code_body_start(source, pos) {
                return Ok(());
            }
            // Check for task checkbox deletion: `- [ ] ` -> `- `
            if source[..pos].ends_with("- [ ] ") || source[..pos].ends_with("- [x] ") {
                return self.apply_recording(SourceEdit {
                    range: pos - 4..pos,
                    replacement: String::new(),
                    selection_after: pos - 4..pos - 4,
                });
            }
            // Smart Backspace between paired delimiters
            let pairs = [
                ("**", "**"),
                ("~~", "~~"),
                ("==", "=="),
                ("`", "`"),
                ("*", "*"),
                ("_", "_"),
                ("(", ")"),
                ("[", "]"),
                ("{", "}"),
                ("\"", "\""),
                ("'", "'"),
                ("<", ">"),
            ];
            for (open, close) in pairs {
                if source[..pos].ends_with(open) && source[pos..].starts_with(close) {
                    let start = pos - open.len();
                    let end = pos + close.len();
                    return self.apply_recording(SourceEdit {
                        range: start..end,
                        replacement: String::new(),
                        selection_after: start..start,
                    });
                }
            }
        }
        let target = if range.is_empty() {
            let previous = previous_grapheme(self.document.source(), range.start);
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

    /// Deletes backward by one word or deletes the current selection.
    pub fn delete_word_backward(&mut self) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let range = self.selection.range();
        let target = if range.is_empty() {
            let previous = word_left(self.document.source(), range.start);
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

    /// Deletes forward by one word or deletes the current selection.
    pub fn delete_word_forward(&mut self) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let range = self.selection.range();
        let target = if range.is_empty() {
            let next = word_right(self.document.source(), range.start);
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

    /// Deletes from caret back to start of current line or deletes the current selection.
    pub fn delete_to_line_start(&mut self) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let range = self.selection.range();
        let target = if range.is_empty() {
            let source = self.document.source();
            let start = source[..range.start].rfind('\n').map_or(0, |i| i + 1);
            start..range.start
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
    pub fn delete_forward(&mut self) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let range = self.selection.range();
        let target = if range.is_empty() {
            let next = next_grapheme(self.document.source(), range.start);
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

    /// Navigates the table cell containing the current selection.
    pub fn navigate_table(
        &mut self,
        backward: bool,
    ) -> Option<crate::table_navigation::TableNavigation> {
        // Cached per committed revision. `apply` invalidates this after a source change.
        if self.parsed_blocks.is_none() {
            self.parsed_blocks = self.document.blocks().ok();
        }
        let blocks = self.parsed_blocks.as_ref()?;
        crate::table_navigation::navigate_table_in_blocks(
            self.source(),
            blocks,
            self.selection.range(),
            backward,
        )
    }

    /// Removes the selection and returns what was removed.
    ///
    /// One operation, like `delete_backward`: cutting must be one undo step and
    /// must not leave the caret in a state the user never chose.
    pub fn cut_selection(&mut self) -> Result<String, SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
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
    pub fn insert_composing(&mut self, text: &str) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        self.begin_composition(self.selection.range());
        self.update_composition(text, text.len()..text.len());
        self.commit_composition();
        Ok(())
    }

    /// Inserts `text` at the caret, replacing the selection.
    pub fn insert(&mut self, text: &str) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let range = self.selection.range();
        // Input below a document-final table must start a paragraph, not extend
        // the last cell. Checked before cell normalisation: once the break is
        // there the text is outside the table and must not be folded as if it
        // were inside a cell.
        if let Some(text) = self.with_trailing_paragraph_break(&range, text) {
            return self.insert_at_selection(text);
        }
        let text = self.normalize_table_cell_text(&range, text);
        self.insert_at_selection(text)
    }

    /// Prepends the paragraph break when the caret sits below a final table.
    ///
    /// Returns `None` when the caret is not in that position, so the caller keeps
    /// its ordinary path. One combined edit means one undo step for the whole
    /// action, not a stray empty paragraph the user has to clean up separately.
    fn with_trailing_paragraph_break(
        &mut self,
        range: &Range<usize>,
        text: &str,
    ) -> Option<String> {
        if !range.is_empty() {
            return None;
        }
        let edit = crate::table_navigation::trailing_paragraph_break(self.source(), range.start)?;
        Some(format!("{}{text}", edit.replacement))
    }

    /// Replaces the selection with literal source text, including table syntax.
    pub fn insert_source_text(&mut self, text: &str) -> Result<(), SessionError> {
        self.insert_at_selection(text.to_owned())
    }

    fn insert_at_selection(&mut self, text: String) -> Result<(), SessionError> {
        let range = self.selection.range();
        let caret = range.start + text.len();
        let typing = text.graphemes(true).count() == 1;
        let edit = SourceEdit {
            range,
            replacement: text,
            selection_after: caret..caret,
        };
        self.apply_recording_joining(edit, typing)
    }

    /// Normalises text pasted or typed into a table cell.
    ///
    /// Two things must not reach the source verbatim, because both would break
    /// the row's structure instead of editing the cell:
    ///
    /// * `|` ends a column, so it is escaped as `\|`.
    /// * A real newline ends a row, so it is folded to a space. The audit's
    ///   repro pasted `first\nsecond` into a header cell and got `first` as a
    ///   paragraph above the table plus `second` as the new first column.
    ///
    /// Newline folding only applies when the text actually contains one. Doing
    /// it unconditionally would also trim ordinary typing, so a pasted single
    /// space or a trailing space while typing would silently vanish.
    fn normalize_table_cell_text(&mut self, range: &Range<usize>, text: &str) -> String {
        let has_pipe = text.contains('|');
        let has_newline = text.contains(['\n', '\r']);
        if !has_pipe && !has_newline {
            return text.to_owned();
        }
        if !self.selection_is_inside_table_cell(range) {
            return text.to_owned();
        }
        // Newlines fold first: an escaped pipe inside a line stays escaped.
        let folded = if has_newline {
            text.replace("\r\n", " ").replace(['\r', '\n'], " ")
        } else {
            text.to_owned()
        };
        let mut escaped = String::with_capacity(folded.len() + folded.matches('|').count());
        let mut preceding_slashes = 0usize;
        for ch in folded.chars() {
            if ch == '|' && preceding_slashes.is_multiple_of(2) {
                escaped.push('\\');
            }
            escaped.push(ch);
            if ch == '\\' {
                preceding_slashes += 1;
            } else {
                preceding_slashes = 0;
            }
        }
        // A folded multi-line paste is a block of text, not a prefix of one, so
        // surrounding whitespace is meaningless. Typing keeps its whitespace.
        if has_newline {
            escaped.trim().to_owned()
        } else {
            escaped
        }
    }

    /// Whether `range` lies inside a table cell's content.
    fn selection_is_inside_table_cell(&mut self, range: &Range<usize>) -> bool {
        if self.parsed_blocks.is_none() {
            self.parsed_blocks = self.document.blocks().ok();
        }
        self.parsed_blocks.as_ref().is_some_and(|blocks| {
            fn find(blocks: &[crate::SourceBlock], range: &Range<usize>) -> bool {
                blocks.iter().any(|block| {
                    (block.kind == crate::BlockKind::TableCell
                        && range.start >= block.content_range.start
                        && range.end <= block.content_range.end)
                        || find(&block.children, range)
                })
            }
            find(blocks, range)
        })
    }

    /// Inserts a newline, continuing or exiting a parsed list item or blockquote when appropriate,
    /// or navigating / appending table rows when inside a table cell.
    pub fn insert_newline(&mut self) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        if self.selection.is_collapsed() {
            let head = self.selection.head();
            if let Some(edit) = crate::table_navigation::exit_table(self.source(), head) {
                return self.apply_recording(edit);
            }
            if let Some(target) =
                crate::table_navigation::navigate_table_vertical(self.source(), head, true)
            {
                match target {
                    crate::table_navigation::TableNavigation::Select(range) => {
                        self.set_selection(range.start, range.end);
                        return Ok(());
                    }
                    crate::table_navigation::TableNavigation::AppendRow {
                        offset,
                        text,
                        caret,
                    } => {
                        self.apply_recording(SourceEdit {
                            range: offset..offset,
                            replacement: text,
                            selection_after: caret..caret,
                        })?;
                        return Ok(());
                    }
                }
            }
            if self.selection_in_block(|kind| matches!(kind, crate::BlockKind::Code { .. })) {
                let source = self.source();
                let line_start = source[..head].rfind('\n').map_or(0, |index| index + 1);
                let indent_len = source[line_start..]
                    .bytes()
                    .take_while(|byte| matches!(byte, b' ' | b'\t'))
                    .count();
                let indent = &source[line_start..line_start + indent_len];
                return self
                    .replace_selection_with_break(format!("{}{indent}", self.line_ending()));
            }
            if let Some(edit) = crate::list_newline::list_newline(&self.document, head) {
                return self.apply_recording(edit);
            }
            if let Some(edit) =
                crate::list_newline::blockquote_newline(&self.document, head, self.line_ending())
            {
                return self.apply_recording(edit);
            }
        } else if self.selection_in_block(|kind| {
            matches!(
                kind,
                crate::BlockKind::ListItem { .. }
                    | crate::BlockKind::Blockquote
                    | crate::BlockKind::Code { .. }
                    | crate::BlockKind::TableCell
            )
        }) {
            return self.insert_source_newline();
        }
        let ending = self.line_ending();
        let count = if self.break_at_empty_line() { 1 } else { 2 };
        self.replace_selection_with_break(ending.repeat(count))
    }

    /// Inserts a Markdown hard line break without continuing a structural prefix.
    pub fn insert_soft_break(&mut self) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let head = self.selection.head();
        if let Some(edit) = crate::table_navigation::soft_break_in_table(self.source(), head) {
            return self.apply_recording(edit);
        }
        if self.break_at_empty_line()
            || self.selection_in_block(|kind| matches!(kind, crate::BlockKind::Code { .. }))
        {
            return self.insert_source_newline();
        }
        self.replace_selection_with_break(format!("  {}", self.line_ending()))
    }

    /// Inserts one literal line ending in source mode.
    pub fn insert_source_newline(&mut self) -> Result<(), SessionError> {
        self.replace_selection_with_break(self.line_ending().to_owned())
    }

    fn selection_in_block(&mut self, matches_kind: impl Fn(&crate::BlockKind) -> bool) -> bool {
        fn contains_selection(
            blocks: &[crate::SourceBlock],
            range: &Range<usize>,
            matches_kind: &impl Fn(&crate::BlockKind) -> bool,
        ) -> bool {
            blocks.iter().any(|block| {
                block.range.contains(&range.start)
                    && range.end <= block.range.end
                    && (matches_kind(&block.kind)
                        || contains_selection(&block.children, range, matches_kind))
            })
        }

        if self.parsed_blocks.is_none() {
            self.parsed_blocks = self.document.blocks().ok();
        }
        self.parsed_blocks.as_ref().is_some_and(|blocks| {
            contains_selection(blocks, &self.selection.range(), &matches_kind)
        })
    }

    fn line_ending(&self) -> &'static str {
        let source = self.source();
        let range = self.selection.range();
        let newline = source[range.end..]
            .find('\n')
            .map(|index| range.end + index)
            .or_else(|| source[..range.start].rfind('\n'));
        if newline.is_some_and(|index| source[..index].ends_with('\r')) {
            "\r\n"
        } else {
            "\n"
        }
    }

    fn break_at_empty_line(&self) -> bool {
        let source = self.source();
        let range = self.selection.range();
        let before = source[..range.start]
            .rsplit('\n')
            .next()
            .unwrap_or_default();
        let after = source[range.end..].split('\n').next().unwrap_or_default();
        before.trim().is_empty() && after.trim().is_empty()
    }

    fn replace_selection_with_break(&mut self, replacement: String) -> Result<(), SessionError> {
        let range = self.selection.range();
        let caret = range.start + replacement.len();
        self.apply_recording(SourceEdit {
            range,
            replacement,
            selection_after: caret..caret,
        })
    }

    /// Sets the heading level of every line the selection touches.
    pub fn set_heading(&mut self, level: u8) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let selection = self.selection.range();
        let edit = self.document.set_heading(selection, level)?;
        self.apply_recording(edit)
    }

    /// Wraps the selection in `prefix` and `suffix`, e.g. `**` for bold.
    pub fn wrap_selection(&mut self, prefix: &str, suffix: &str) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let selection = self.selection.range();
        let edit = self.document.wrap_selection(selection, prefix, suffix)?;
        self.apply_recording(edit)
    }

    /// Toggles an inline format as one undoable edit, retaining selection direction.
    pub fn toggle_inline_mark(&mut self, format: crate::InlineFormat) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let reversed = self.selection.anchor() > self.selection.head();
        let edit = self
            .document
            .toggle_inline_mark(self.selection.range(), format)?;
        self.apply_recording(edit)?;
        if reversed {
            let range = self.selection.range();
            self.selection = Selection::new(range.end, range.start);
            self.history
                .update_last_selection(self.selection.anchor(), self.selection.head());
        }
        Ok(())
    }

    /// Applies `edit` and records it in history.
    pub fn apply_edit(&mut self, edit: SourceEdit) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        self.apply_recording(edit)
    }

    /// Toggles a line prefix such as `> ` or `- ` on every selected line.
    pub fn toggle_line_prefix(&mut self, prefix: &str) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let selection = self.selection.range();
        let edit = self.document.toggle_line_prefix(selection, prefix)?;
        self.apply_recording(edit)
    }

    /// Replaces a single match range and records it in undo history.
    ///
    /// This is the unguarded form: it trusts `range` to still spell the match.
    /// Callers that cached the range earlier — a find panel does — must use
    /// [`replace_match_guarded`](Self::replace_match_guarded) instead, because
    /// the document may have changed under the cached range.
    pub fn replace_match(
        &mut self,
        range: Range<usize>,
        replacement: &str,
    ) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let edit = crate::replace_single_match(self.source(), range, replacement)
            .ok_or(SessionError::Source(crate::EditError::InvalidRange))?;
        self.apply_recording(edit)
    }

    /// Replaces a match only if the bytes at `range` are still `expected`.
    ///
    /// A cached match range goes stale the moment the user edits before it. The
    /// audit's repro cached `4..7` for `cat`, typed `X` at the document start,
    /// then replaced: the unguarded path wrote over bytes that now spelled
    /// `cat` shifted by one, producing `XoneDOGt two`.
    ///
    /// Refusing is the safe answer. The caller re-runs the search and retries, so
    /// the body is never damaged by a stale range.
    pub fn replace_match_guarded(
        &mut self,
        range: Range<usize>,
        expected: &str,
        replacement: &str,
    ) -> Result<(), SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        if self.source().get(range.clone()) != Some(expected) {
            return Err(SessionError::StaleMatch);
        }
        let edit = crate::replace_single_match(self.source(), range, replacement)
            .ok_or(SessionError::Source(crate::EditError::InvalidRange))?;
        self.apply_recording(edit)
    }

    /// Replaces all matches with `replacement` in one undoable step.
    pub fn replace_all(
        &mut self,
        query: &str,
        replacement: &str,
        options: &crate::FindOptions,
    ) -> Result<usize, SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        let matches = crate::find_matches(self.source(), query, options);
        if matches.is_empty() {
            return Ok(0);
        }
        let count = matches.len();
        let edit = crate::replace_all_matches(self.source(), &matches, replacement)
            .ok_or(SessionError::Source(crate::EditError::InvalidRange))?;
        self.apply_recording(edit)?;
        Ok(count)
    }

    /// Wraps non-empty selections or handles smart auto-pairing / skip-over when typing brackets.
    pub fn try_wrap_pair(&mut self, text: &str) -> Result<bool, SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        if self.selection.is_collapsed() {
            let head = self.selection.head();
            // Skip-over closing brackets
            if matches!(text, ")" | "]" | "}") {
                if self.source().get(head..head + text.len()) == Some(text) {
                    self.set_caret(head + text.len());
                    return Ok(true);
                }
                return Ok(false);
            }
            // Auto-closing brackets
            let pair = match text {
                "(" => Some(("(", ")")),
                "[" => Some(("[", "]")),
                "{" => Some(("{", "}")),
                _ => None,
            };
            if let Some((open, close)) = pair {
                let rest = self.source().get(head..).unwrap_or("");
                let should_pair = rest.is_empty()
                    || rest.starts_with(|c: char| c.is_whitespace() || c.is_ascii_punctuation());
                if should_pair {
                    self.apply_recording(SourceEdit {
                        range: head..head,
                        replacement: format!("{open}{close}"),
                        selection_after: head + open.len()..head + open.len(),
                    })?;
                    return Ok(true);
                }
            }
            return Ok(false);
        }
        let (prefix, suffix) = match text {
            "*" => ("*", "*"),
            "_" => ("_", "_"),
            "`" => ("`", "`"),
            "~" => ("~~", "~~"),
            "[" => ("[", "]"),
            "(" => ("(", ")"),
            "\"" => ("\"", "\""),
            "'" => ("'", "'"),
            "{" => ("{", "}"),
            "<" => ("<", ">"),
            _ => return Ok(false),
        };
        self.wrap_selection(prefix, suffix)?;
        Ok(true)
    }

    /// Pastes `url` as a Markdown link `[selected](url)` if a non-empty selection exists.
    pub fn paste_smart_link(&mut self, url: &str) -> Result<bool, SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        if self.selection.is_collapsed() || !crate::is_valid_url(url) {
            return Ok(false);
        }
        let selected = self.selected_text().to_string();
        let markdown_link = format!("[{selected}]({})", url.trim());
        let range = self.selection.range();
        let end = range.start + markdown_link.len();
        self.apply_recording(SourceEdit {
            range,
            replacement: markdown_link,
            selection_after: end..end,
        })?;
        Ok(true)
    }

    /// Indents or outdents the selected lines.
    ///
    /// With a collapsed caret this indents the *line*, not the caret position.
    /// The historical contract is a two-space line indent with the caret kept on
    /// the same text, which is what a prose writer expects from Tab; inserting a
    /// literal tab at the caret (the audited behaviour) changes the meaning of
    /// the line instead of its nesting.
    ///
    /// A list item is indented through the list rules first, so nested-list
    /// semantics keep priority over the plain two-space indent.
    pub fn indent_selection(&mut self, forward: bool) -> Result<bool, SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        if self.selection.is_collapsed() {
            if self.indent_list(forward)? {
                return Ok(true);
            }
            return self.indent_current_line(forward);
        }
        let range = self.selection.range();
        let source = self.source();
        let start = source[..range.start].rfind('\n').map_or(0, |i| i + 1);
        let end = source[range.end..]
            .find('\n')
            .map_or(source.len(), |i| range.end + i);
        let slice = &source[start..end];
        let mut replacement = String::new();
        let mut lines = slice.split('\n').peekable();
        while let Some(line) = lines.next() {
            if forward {
                replacement.push_str("  ");
                replacement.push_str(line);
            } else {
                let spaces = line.bytes().take_while(|&b| b == b' ').take(2).count();
                replacement.push_str(&line[spaces..]);
            }
            if lines.peek().is_some() {
                replacement.push('\n');
            }
        }
        let new_end = start + replacement.len();
        self.apply_recording(SourceEdit {
            range: start..end,
            replacement,
            selection_after: start..new_end,
        })?;
        Ok(true)
    }

    /// Adds two leading spaces to the caret's line, or removes up to two.
    ///
    /// Keeps the caret on the same character by shifting it with the edit, which
    /// is the whole point of a line indent: the user is still typing where they
    /// were, one nesting level deeper.
    fn indent_current_line(&mut self, forward: bool) -> Result<bool, SessionError> {
        let source = self.source();
        let head = self.selection.head();
        let Some(before) = source.get(..head) else {
            return Ok(false);
        };
        let line_start = before.rfind('\n').map_or(0, |index| index + 1);

        if forward {
            let edit = SourceEdit {
                range: line_start..line_start,
                replacement: "  ".to_owned(),
                selection_after: head + 2..head + 2,
            };
            self.apply_recording(edit)?;
            return Ok(true);
        }

        // Outdent removes at most two spaces that are actually there.
        let spaces = source[line_start..]
            .bytes()
            .take_while(|byte| *byte == b' ')
            .take(2)
            .count();
        if spaces == 0 {
            return Ok(false);
        }
        let removed = spaces.min(head.saturating_sub(line_start));
        let edit = SourceEdit {
            range: line_start..line_start + spaces,
            replacement: String::new(),
            selection_after: head.saturating_sub(removed)..head.saturating_sub(removed),
        };
        self.apply_recording(edit)?;
        Ok(true)
    }

    /// Checks if the current line touches a Markdown list item.
    pub fn is_in_list(&self) -> bool {
        let source = self.source();
        let caret = self.selection.head();
        if !source.is_char_boundary(caret) {
            return false;
        }
        let before = match source.get(..caret) {
            Some(b) => b,
            None => return false,
        };
        let start = before.rfind('\n').map_or(0, |i| i + 1);
        let end = source[caret..]
            .find('\n')
            .map_or(source.len(), |i| caret + i);
        let line = &source[start..end];
        let indent = line
            .bytes()
            .take_while(|b| matches!(b, b' ' | b'\t'))
            .count();
        let rest = &line[indent..];
        if rest.starts_with(['-', '+', '*']) {
            return rest
                .as_bytes()
                .get(1)
                .is_some_and(|&b| b == b' ' || b == b'\t');
        }
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        if digits > 0 && digits <= 9 && matches!(rest.as_bytes().get(digits), Some(b'.' | b')')) {
            return rest
                .as_bytes()
                .get(digits + 1)
                .is_some_and(|&b| b == b' ' || b == b'\t');
        }
        false
    }

    /// Indents or outdents a list item under cursor.
    pub fn indent_list(&mut self, forward: bool) -> Result<bool, SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        if let Some(edit) =
            crate::list_newline::indent_list(&self.document, self.selection.head(), forward)
        {
            self.apply_recording(edit)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Outdents the current line by removing up to 2 spaces of indentation, or outdents a list.
    pub fn outdent_current(&mut self) -> Result<bool, SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        if let Ok(true) = self.indent_list(false) {
            return Ok(true);
        }
        let source = self.source();
        let head = self.selection.head();
        let before = match source.get(..head) {
            Some(b) => b,
            None => return Ok(false),
        };
        let start = before.rfind('\n').map_or(0, |i| i + 1);
        let line = &source[start..];
        let spaces = line.bytes().take_while(|&b| b == b' ').take(2).count();
        if spaces > 0 {
            self.apply_recording(SourceEdit {
                range: start..start + spaces,
                replacement: String::new(),
                selection_after: (head.saturating_sub(spaces))..(head.saturating_sub(spaces)),
            })?;
            return Ok(true);
        }
        Ok(false)
    }

    /// Toggles a task checkbox `[ ]` <-> `[x]` at or near `offset`.
    pub fn toggle_task_checkbox(&mut self, offset: usize) -> Result<bool, SessionError> {
        if self.readonly {
            return Err(SessionError::ReadOnly);
        }
        if let Some(edit) = crate::list_newline::toggle_task_checkbox(&self.document, offset) {
            self.apply_recording(edit)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Applies `edit` and moves the caret to the edit's own selection.
    fn apply(&mut self, edit: SourceEdit) -> Result<(), SessionError> {
        let selection_after = edit.selection_after.clone();
        self.document = self.document.apply(&edit)?;
        self.selection = Selection::new(
            normalize_offset(self.document.source(), selection_after.start, false),
            normalize_offset(self.document.source(), selection_after.end, false),
        );
        self.revision = self.revision.wrapping_add(1);
        self.parsed_blocks = None;
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
        let mut editor = EditorSession::new("ab");
        editor.set_caret(1);
        editor.insert("X").expect("insert should apply");
        assert_eq!(editor.source(), "aXb");
        assert_eq!(editor.selection().head(), 2);
        assert_eq!(editor.revision(), 1);
    }

    #[test]
    fn inserting_replaces_the_selection() {
        let mut editor = EditorSession::new("hello world");
        editor.set_selection(6, 11);
        editor.insert("there").expect("insert should apply");
        assert_eq!(editor.source(), "hello there");
    }

    #[test]
    fn a_readonly_document_rejects_edits() {
        let mut editor = EditorSession::new("abc");
        editor.set_readonly(true);
        assert!(editor.insert("x").is_err());
        assert_eq!(editor.source(), "abc");
        assert_eq!(editor.revision(), 0);
    }

    #[test]
    fn setting_a_heading_rewrites_the_line_and_reports_a_revision() {
        let mut editor = EditorSession::new("Title\n");
        editor.set_caret(0);
        editor.set_heading(2).expect("heading should apply");
        assert_eq!(editor.source(), "## Title\n");
        assert_eq!(editor.revision(), 1);
    }

    #[test]
    fn wrapping_a_selection_keeps_the_inner_text_selected() {
        let mut editor = EditorSession::new("word");
        editor.set_selection(0, 4);
        editor
            .wrap_selection("**", "**")
            .expect("wrap should apply");
        assert_eq!(editor.source(), "**word**");
        assert_eq!(editor.selection().range(), 2..6);
    }

    #[test]
    fn typing_into_a_table_cell_edits_only_that_cell() {
        // Editing a cell is plain typing with the caret inside it; the pipes and
        // the other cells are untouched.
        let mut editor = EditorSession::new("| a | b |\n| --- | --- |\n| c | d |\n");
        editor.set_caret(2);
        editor.insert("X").expect("typing applies");
        assert_eq!(editor.source(), "| Xa | b |\n| --- | --- |\n| c | d |\n");
    }

    #[test]
    fn inserting_pipe_escapes_only_the_target_table_cell_and_undoes_once() {
        let mut editor = EditorSession::new("| a | b |\n| --- | --- |\n| x | y |\n");
        let at = editor.source().find('x').unwrap() + 1;
        editor.set_caret(at);
        editor.insert("| pasted").unwrap();
        assert_eq!(
            editor.source(),
            "| a | b |\n| --- | --- |\n| x\\| pasted | y |\n"
        );
        assert!(editor.undo());
        assert_eq!(editor.source(), "| a | b |\n| --- | --- |\n| x | y |\n");
    }

    #[test]
    fn return_in_fenced_code_preserves_line_indentation() {
        let mut editor = EditorSession::new("```rust\n    let value = 1;\n```");
        let at = editor.source().find("value").unwrap();
        editor.set_caret(at);
        editor.insert_newline().unwrap();
        assert_eq!(editor.source(), "```rust\n    let \n    value = 1;\n```");
        assert!(editor.undo());
        assert_eq!(editor.source(), "```rust\n    let value = 1;\n```");
    }

    #[test]
    fn return_in_an_empty_table_cell_exits_the_table() {
        let mut editor = EditorSession::new("| a |\n| --- |\n|   |\n");
        let at = editor.source().find("|   |").unwrap() + 2;
        editor.set_caret(at);
        editor.insert_newline().unwrap();
        assert!(editor.source().ends_with("|   |\n\n\n"));
        assert!(editor.undo());
        assert_eq!(editor.source(), "| a |\n| --- |\n|   |\n");
    }

    #[test]
    fn a_task_list_toggle_writes_a_checkbox_not_a_bullet() {
        let mut editor = EditorSession::new("item\n");
        editor.set_caret(0);
        editor
            .toggle_line_prefix("- [ ] ")
            .expect("the prefix should apply");
        assert_eq!(editor.source(), "- [ ] item\n");
    }

    #[test]
    fn delete_backward_removes_one_character_and_undoes_as_one_step() {
        let mut editor = EditorSession::new("abc");
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
    fn caret_normalization_and_backspace_respect_extended_graphemes() {
        let source = "a👩‍👩‍👧‍👦e\u{301}b";
        let family_start = 1;
        let family_end = family_start + "👩‍👩‍👧‍👦".len();
        assert_eq!(
            normalize_offset(source, family_start + 2, false),
            family_start
        );
        assert_eq!(normalize_offset(source, family_start + 2, true), family_end);
        let mut editor = EditorSession::new(source);
        editor.set_caret(family_end);
        editor.delete_backward().unwrap();
        assert_eq!(editor.source(), "ae\u{301}b");
        editor.set_caret(editor.source().find('b').unwrap());
        editor.delete_backward().unwrap();
        assert_eq!(editor.source(), "ab");
    }

    #[test]
    fn try_wrap_pair_wraps_selection_and_undoes() {
        let mut editor = EditorSession::new("selected text");
        editor.set_selection(0, "selected text".len());
        assert!(editor.try_wrap_pair("[").unwrap());
        assert_eq!(editor.source(), "[selected text]");
        assert!(editor.undo());
        assert_eq!(editor.source(), "selected text");
    }

    #[test]
    fn replace_all_undoes_in_one_step() {
        let mut editor = EditorSession::new("apple pie with apple juice");
        let count = editor
            .replace_all("apple", "orange", &crate::FindOptions::default())
            .unwrap();
        assert_eq!(count, 2);
        assert_eq!(editor.source(), "orange pie with orange juice");
        assert!(editor.undo());
        assert_eq!(editor.source(), "apple pie with apple juice");
    }

    #[test]
    fn delete_backward_removes_a_selection_in_one_step() {
        let mut editor = EditorSession::new("hello world");
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
        let mut editor = EditorSession::new("first file");
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
        let mut editor = EditorSession::new("ab");
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
    fn inline_format_preserves_reverse_selection_and_undo() {
        let mut editor = EditorSession::new("中文");
        editor.set_selection("中文".len(), 0);
        editor
            .toggle_inline_mark(crate::InlineFormat::Bold)
            .unwrap();
        assert_eq!(editor.source(), "**中文**");
        assert_eq!(
            (editor.selection().anchor(), editor.selection().head()),
            (8, 2)
        );
        editor
            .toggle_inline_mark(crate::InlineFormat::Bold)
            .unwrap();
        assert_eq!(editor.source(), "中文");
        assert_eq!(
            (editor.selection().anchor(), editor.selection().head()),
            (6, 0)
        );
        assert!(editor.undo());
        assert_eq!(editor.source(), "**中文**");
        assert_eq!(
            (editor.selection().anchor(), editor.selection().head()),
            (8, 2)
        );
    }

    #[test]
    fn undo_restores_the_text_and_the_caret() {
        let mut editor = EditorSession::new("ab");
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
        let mut editor = EditorSession::new("ab");
        editor.set_caret(1);
        editor.insert("X").expect("insert applies");
        assert!(editor.undo());
        assert!(editor.can_redo());
        assert!(editor.redo());
        assert_eq!(editor.source(), "aXb");
    }

    #[test]
    fn a_new_edit_drops_the_redo_branch() {
        let mut editor = EditorSession::new("ab");
        editor.set_caret(1);
        editor.insert("X").expect("insert applies");
        assert!(editor.undo());
        editor.insert("Y").expect("insert applies");
        assert!(!editor.can_redo(), "a fresh edit invalidates redo");
    }

    #[test]
    fn undo_and_redo_report_nothing_when_the_stack_is_empty() {
        let mut editor = EditorSession::new("ab");
        assert!(!editor.can_undo());
        assert!(!editor.undo());
        assert!(!editor.can_redo());
        assert!(!editor.redo());
    }

    #[test]
    fn a_readonly_document_refuses_undo() {
        let mut editor = EditorSession::new("ab");
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
        let mut editor = EditorSession::new("");
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
        let mut editor = EditorSession::new("");
        editor.set_caret(0);
        editor.insert("a").expect("insert applies");
        editor.insert("pasted").expect("insert applies");
        assert_eq!(editor.source(), "apasted");
        assert!(editor.undo());
        assert_eq!(editor.source(), "a", "undo takes back only the paste");
    }

    #[test]
    fn replacing_the_source_clamps_the_caret() {
        let mut editor = EditorSession::new("a much longer document");
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
        let mut editor = EditorSession::new("");
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
        let mut editor = EditorSession::new("");
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
        let mut editor = EditorSession::new("");
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
        let mut editor = EditorSession::new("");
        editor.set_caret(0);
        editor.insert("y").expect("typing applies");
        editor.toggle_line_prefix("> ").expect("quote applies");
        assert_eq!(editor.source(), "> y");
        assert!(editor.undo());
        assert_eq!(editor.source(), "y", "the typed text survives");
    }

    /// A table-cell write after typing is its own step.
    #[test]
    fn a_table_edit_after_typing_is_its_own_undo_step() {
        let mut editor = EditorSession::new("Z\n\n| a | b |\n| --- | --- |\n");
        editor.set_caret(1);
        // Typing inside a cell is an ordinary edit, so it starts its own step.
        editor.insert("cell").expect("typing applies");
        assert!(editor.undo(), "undo takes back the cell typing");
        assert!(
            editor.source().contains("| a | b |"),
            "and leaves the cell as it was: {:?}",
            editor.source()
        );
    }

    /// Forward delete removes the character after the caret, in one step.
    #[test]
    fn delete_forward_removes_the_next_character() {
        let mut editor = EditorSession::new("abc");
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
        let mut editor = EditorSession::new("");
        editor.begin_composition(0..0);
        editor.update_composition("z", 1..1);
        editor.update_composition("zh", 2..2);
        editor.update_composition("zhong", 5..5);
        assert_eq!(editor.source(), "");
        assert_eq!(editor.display_source(), "zhong");
        editor.commit_composition();
        assert_eq!(editor.source(), "zhong");
        assert!(editor.undo());
        assert_eq!(editor.source(), "");
    }

    #[test]
    fn committed_ime_text_and_following_typing_undo_separately() {
        let mut editor = EditorSession::new("");
        editor.begin_composition(0..0);
        editor.update_composition("中", 3..3);
        editor.commit_composition();
        editor.insert("!").unwrap();
        assert_eq!(editor.source(), "中!");
        assert!(editor.undo());
        assert_eq!(editor.source(), "中");
        assert!(editor.undo());
        assert_eq!(editor.source(), "");
    }

    #[test]
    fn composition_after_an_unrelated_edit_is_its_own_step() {
        let mut editor = EditorSession::new("");
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
        let mut editor = EditorSession::new("");
        editor.set_caret(0);
        for character in ["a", "b", "c"] {
            editor.insert(character).expect("typing applies");
        }
        assert_eq!(editor.source(), "abc");
        assert!(editor.undo());
        assert_eq!(editor.source(), "", "one undo takes back the burst");
    }
}
