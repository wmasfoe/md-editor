//! The GPUI view: a laid-out Markdown document that accepts input.
//!
//! gpui-kit renders the blocks and reports geometry; [`inkpoint_editor_typeset`]
//! owns the document, the selection and the edit operations. This view joins
//! them and implements the platform input contract, which is the one piece only
//! the host can supply: the OS asks for text ranges, marked (composing) text and
//! caret bounds in UTF-16, and every offset in this crate is UTF-8 bytes.
//!
//! The conversion is not cosmetic. macOS drives IME through these calls, so an
//! offset that is wrong by one byte in the middle of a CJK character shows up as
//! a caret in the wrong place or a composing region that swallows text.

use std::ops::Range;

use gpui_kit::base::text::editor_host::RenderContext;
use gpui_kit::{
    App, Bounds, Context, EntityInputHandler, FocusHandle, IntoElement, KeyBinding, Pixels, Point,
    Render, SharedString, UTF16Selection, Window, actions, div, prelude::*, px,
};
use inkpoint_editor_typeset::{
    LeafIndex, TypesetDocument, TypesetEditor, TypesetError, byte_offset, caret_at, line_start,
    move_down, move_left, move_right, move_up, utf16_offset,
};

actions!(
    inkpoint_typeset,
    [
        MoveLeft,
        MoveRight,
        MoveUp,
        MoveDown,
        SelectAll,
        InsertNewline,
        DeleteBackward,
        Undo,
        Redo,
    ]
);

/// The body font size a document lays out at.
const BODY_FONT_SIZE: f32 = 17.;

/// A GPUI element that renders and edits Markdown.
pub struct TypesetView {
    editor: TypesetEditor,
    document: TypesetDocument,
    geometry: LeafIndex,
    focus: FocusHandle,
    /// The leaf the caret is in, as reported by the last frame's geometry.
    caret_leaf: Option<u64>,
    /// Composing text range in UTF-8 bytes, while an IME is active.
    marked: Option<Range<usize>>,
    /// Why the last parse failed, when it did.
    ///
    /// Kept rather than swallowed: a document that will not parse still opens
    /// for editing, but the host has to be able to say so instead of showing an
    /// empty page with no explanation.
    parse_error: Option<SharedString>,
}

impl TypesetView {
    /// Opens `source` in a new view.
    pub fn new(window: &mut Window, cx: &mut Context<Self>, source: impl Into<String>) -> Self {
        let editor = TypesetEditor::new(source);
        // A document that will not parse still opens, because the buffer is the
        // user's file and losing it would be worse than showing it unrendered.
        //
        // There is no previous tree to keep on the first open, so the fallback
        // shows the raw source as one code block: the user sees their text
        // instead of a blank page, which is the same intent as the degradation
        // mermaid and math use. `reparse` keeps the previous tree instead, since
        // by then one exists.
        let (document, parse_error) = match TypesetDocument::parse(editor.source()) {
            Ok(document) => (document, None),
            Err(error) => (Self::source_fallback(editor.source()), Some(error)),
        };
        let focus = cx.focus_handle();
        focus.focus(window, cx);
        Self {
            editor,
            document,
            geometry: LeafIndex::default(),
            focus,
            caret_leaf: None,
            marked: None,
            parse_error,
        }
    }

    /// The Markdown source.
    pub fn markdown(&self) -> &str {
        self.editor.source()
    }

    /// A revision counter that changes on every edit.
    pub fn revision(&self) -> u64 {
        self.editor.revision()
    }

    /// Why the last parse failed, when it did.
    ///
    /// `None` once the source parses again.
    pub fn parse_error(&self) -> Option<&SharedString> {
        self.parse_error.as_ref()
    }

    /// Whether an IME is composing, in which case the host must not save.
    pub fn composing(&self) -> bool {
        self.marked.is_some()
    }

    /// Replaces the document from disk.
    pub fn replace_markdown(&mut self, source: impl Into<String>, cx: &mut Context<Self>) {
        self.editor.replace_source(source);
        self.reparse();
        cx.notify();
    }

    /// Sets whether the view rejects edits.
    pub fn set_readonly(&mut self, readonly: bool, cx: &mut Context<Self>) {
        self.editor.set_readonly(readonly);
        cx.notify();
    }

    /// Moves the caret to `offset`, clamped to the source.
    pub fn set_caret(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.editor.set_caret(offset);
        cx.notify();
    }

    /// Focuses the view.
    pub fn focus(&self, window: &mut Window, cx: &mut Context<Self>) {
        self.focus.focus(window, cx);
    }

    /// Renders the raw source as a single fenced block.
    ///
    /// Used when Markdown cannot be structured: showing the text beats a blank
    /// page, and it is what the mermaid and math paths do when they fail.
    fn source_fallback(source: &str) -> TypesetDocument {
        let body = source.replace("```", "'''");
        let fenced = format!("```text\n{body}\n```\n");
        TypesetDocument::parse(fenced)
            .or_else(|_| TypesetDocument::parse(""))
            .expect("an empty document parses")
    }

    /// Re-parses after the source changed.
    fn reparse(&mut self) {
        match TypesetDocument::parse(self.editor.source()) {
            Ok(document) => {
                self.document = document;
                self.parse_error = None;
            }
            Err(error) => {
                // Keep the previous tree: an edit that the parser rejects should
                // not blank the page under the caret.
                self.parse_error = Some(error);
            }
        }
    }

    /// Applies an edit, then re-parses and notifies.
    fn apply(&mut self, edit: Result<(), TypesetError>, cx: &mut Context<Self>) {
        if edit.is_ok() {
            self.reparse();
            cx.notify();
        }
    }

    /// Inserts `text` at the caret.
    fn insert(&mut self, text: &str, cx: &mut Context<Self>) {
        let result = self.editor.insert(text);
        self.apply(result, cx);
    }

    /// Deletes the selection, or one character backwards when collapsed.
    fn delete_backward(&mut self, cx: &mut Context<Self>) {
        let result = self.editor.delete_backward();
        self.apply(result, cx);
    }

    /// Moves the caret one line up, crossing into the previous leaf at the top.
    fn caret_up(&mut self, cx: &mut Context<Self>) {
        self.move_vertical(true, cx);
    }

    /// Moves the caret one visual line down, crossing into the next leaf at the
    /// bottom of this one.
    fn caret_down(&mut self, cx: &mut Context<Self>) {
        self.move_vertical(false, cx);
    }

    /// One vertical step, staying inside the leaf or crossing into a neighbour.
    ///
    /// Leaf geometry counts bytes from the leaf's own start; a caret is a
    /// document-wide offset. Every geometry call therefore works in leaf-local
    /// space and the result is shifted back by the leaf's span before it reaches
    /// the editor.
    fn move_vertical(&mut self, up: bool, cx: &mut Context<Self>) {
        let Some(key) = self.caret_leaf else {
            return;
        };
        let Some(leaf) = self.geometry.get(key) else {
            return;
        };
        let Some(span) = self.document.span_of(key) else {
            return;
        };
        let local = self.editor.selection().head().saturating_sub(span.start);
        let caret = gpui_kit::base::text::editor_host::Caret::new(local.min(leaf.len()));

        // Stay inside this leaf when it has another visual line.
        let inside = if up {
            move_up(leaf, caret)
        } else {
            move_down(leaf, caret)
        };
        if let Some(moved) = inside {
            self.editor
                .set_caret(span.start + moved.index.min(leaf.len()));
            cx.notify();
            return;
        }

        // Otherwise cross into the nearest laid-out neighbour. Which leaf that is
        // is document topology, so the document answers it; the geometry below
        // only decides where inside that leaf the caret lands.
        let laid_out: Vec<u64> = self.geometry.entries().map(|(key, _)| key).collect();
        let Some((neighbour_key, neighbour_span)) =
            self.document.vertical_neighbour(key, up, &laid_out)
        else {
            return;
        };
        let Some(neighbour) = self.geometry.get(neighbour_key) else {
            return;
        };
        // Enter at the edge we came from: the end of the previous leaf when
        // moving up, the start of the next when moving down. `position_for_index`
        // already returns the caret's own line, so the offset is used as-is
        // rather than nudged into the middle of a line — nudging would land on
        // the line below and be clamped back, which happens to work but says
        // nothing about intent.
        let edge = if up { neighbour.len() } else { 0 };
        let position = neighbour.position_for_index(edge);
        let target = neighbour.caret_for_position(position);
        // `render` resolves the caret's leaf from the document after every edit,
        // so this does not assign `caret_leaf`: doing so would suggest the field
        // is authoritative when the next frame overwrites it.
        self.editor
            .set_caret(neighbour_span.start + target.index.min(neighbour.len()));
        cx.notify();
    }

    /// Reverts the last edit.
    fn undo(&mut self, cx: &mut Context<Self>) {
        if self.editor.undo() {
            self.reparse();
            cx.notify();
        }
    }

    /// Reapplies the last undone edit.
    fn redo(&mut self, cx: &mut Context<Self>) {
        if self.editor.redo() {
            self.reparse();
            cx.notify();
        }
    }

    /// Whether there is an edit to undo.
    pub fn can_undo(&self) -> bool {
        self.editor.can_undo()
    }

    /// Whether there is an undone edit to redo.
    pub fn can_redo(&self) -> bool {
        self.editor.can_redo()
    }

    /// Selects the whole document.
    fn select_all(&mut self, cx: &mut Context<Self>) {
        let len = self.editor.source().len();
        self.editor.set_selection(0, len);
        cx.notify();
    }

    /// Moves the caret left, extending the selection when `shift` is held.
    fn do_move_left(&mut self, shift: bool, cx: &mut Context<Self>) {
        let head = self.editor.selection().head();
        let caret = gpui_kit::base::text::editor_host::Caret::new(head);
        let moved = move_left(self.editor.source(), caret).index;
        let anchor = if shift {
            self.editor.selection().anchor()
        } else {
            moved
        };
        self.editor.set_selection(anchor, moved);
        cx.notify();
    }

    /// Moves the caret right, extending the selection when `shift` is held.
    fn do_move_right(&mut self, shift: bool, cx: &mut Context<Self>) {
        let head = self.editor.selection().head();
        let caret = gpui_kit::base::text::editor_host::Caret::new(head);
        let moved = move_right(self.editor.source(), caret).index;
        let anchor = if shift {
            self.editor.selection().anchor()
        } else {
            moved
        };
        self.editor.set_selection(anchor, moved);
        cx.notify();
    }

    /// Binds the movement keys.
    pub fn bind_keys(cx: &mut App) {
        cx.bind_keys([
            KeyBinding::new("left", MoveLeft, None),
            KeyBinding::new("right", MoveRight, None),
            KeyBinding::new("up", MoveUp, None),
            KeyBinding::new("down", MoveDown, None),
            KeyBinding::new("enter", InsertNewline, None),
            KeyBinding::new("backspace", DeleteBackward, None),
            KeyBinding::new("cmd-z", Undo, None),
            KeyBinding::new("cmd-shift-z", Redo, None),
            KeyBinding::new("cmd-a", SelectAll, None),
        ]);
    }
}

impl EntityInputHandler for TypesetView {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        adjusted_range: &mut Option<Range<usize>>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<String> {
        let source = self.editor.source();
        let start = byte_offset(source, range.start);
        let end = byte_offset(source, range.end);
        adjusted_range.replace(utf16_offset(source, start)..utf16_offset(source, end));
        source.get(start..end).map(str::to_string)
    }

    fn selected_text_range(
        &mut self,
        _ignore_disabled_input: bool,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        let source = self.editor.source();
        let selection = self.editor.selection();
        let range = selection.range();
        Some(UTF16Selection {
            range: utf16_offset(source, range.start)..utf16_offset(source, range.end),
            reversed: selection.is_reversed(),
        })
    }

    fn marked_text_range(
        &self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Range<usize>> {
        let source = self.editor.source();
        self.marked
            .as_ref()
            .map(|range| utf16_offset(source, range.start)..utf16_offset(source, range.end))
    }

    fn unmark_text(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        self.marked = None;
        cx.notify();
    }

    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let source = self.editor.source().to_string();
        let target = match range {
            Some(range) => byte_offset(&source, range.start)..byte_offset(&source, range.end),
            None => self.editor.selection().range(),
        };
        self.editor.set_selection(target.start, target.end);
        let result = self.editor.insert(text);
        self.apply(result, cx);
        self.marked = None;
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        new_text: &str,
        new_selected_range: Option<Range<usize>>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let source = self.editor.source().to_string();
        let target = match range {
            Some(range) => byte_offset(&source, range.start)..byte_offset(&source, range.end),
            None => self.editor.selection().range(),
        };
        self.editor.set_selection(target.start, target.end);
        let start = target.start;
        let result = self.editor.insert(new_text);
        let inserted = result.is_ok();
        self.apply(result, cx);
        // The composing region covers the text just inserted. Only mark it when
        // the insert actually landed: a read-only document would otherwise stay
        // "composing" forever, blocking every save and AI suggestion that waits
        // for composition to finish.
        if inserted {
            self.marked = Some(start..start + new_text.len());
        } else {
            self.marked = None;
        }
        if let Some(selected) = new_selected_range {
            let base = self.editor.source();
            let from = byte_offset(base, selected.start + utf16_offset(base, start));
            let to = byte_offset(base, selected.end + utf16_offset(base, start));
            self.editor.set_selection(from, to);
        }
        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        _element_bounds: Bounds<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let source = self.editor.source();
        let offset = byte_offset(source, range.start);
        let key = self.caret_leaf?;
        let leaf = self.geometry.get(key)?;
        // The range arrives as a document-wide offset; leaf geometry counts from
        // the leaf's own start.
        let span = self.document.span_of(key)?;
        let local = offset.saturating_sub(span.start);
        let position = leaf.position_for_index(local.min(leaf.len()));
        let height = leaf.caret_height();
        Some(Bounds {
            origin: position,
            size: gpui_kit::size(px(2.), height),
        })
    }

    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        let caret = caret_at(&self.geometry, point)?;
        let key = self.caret_leaf?;
        // `caret.index` counts bytes from the leaf's start; the platform wants a
        // document-wide UTF-16 offset.
        let span = self.document.span_of(key)?;
        let document_offset = span.start + caret.index;
        let source = self.editor.source();
        Some(utf16_offset(source, document_offset))
    }

    fn set_selected_text_range(
        &mut self,
        range: Range<usize>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let source = self.editor.source().to_string();
        let start = byte_offset(&source, range.start);
        let end = byte_offset(&source, range.end);
        self.editor.set_selection(start, end);
        cx.notify();
    }

    fn text_length_utf16(
        &mut self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        Some(self.editor.source().encode_utf16().count())
    }
}

impl Render for TypesetView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Build the listeners before rendering: the rendered element borrows
        // `cx` mutably, so every `cx.listener` call has to happen first.
        let on_left = cx.listener(|this, _: &MoveLeft, window, cx| {
            this.do_move_left(window.modifiers().shift, cx);
        });
        let on_right = cx.listener(|this, _: &MoveRight, window, cx| {
            this.do_move_right(window.modifiers().shift, cx);
        });
        let on_up = cx.listener(|this, _: &MoveUp, _, cx| this.caret_up(cx));
        let on_down = cx.listener(|this, _: &MoveDown, _, cx| this.caret_down(cx));
        let on_select_all = cx.listener(|this, _: &SelectAll, _, cx| this.select_all(cx));
        let on_newline = cx.listener(|this, _: &InsertNewline, _, cx| this.insert("\n", cx));
        let on_backspace = cx.listener(|this, _: &DeleteBackward, _, cx| this.delete_backward(cx));
        let on_undo = cx.listener(|this, _: &Undo, _, cx| this.undo(cx));
        let on_redo = cx.listener(|this, _: &Redo, _, cx| this.redo(cx));

        let context = RenderContext::from_app(cx);
        let (element, geometry) = self
            .document
            .render(px(BODY_FONT_SIZE), context, window, cx);
        // Resolve the caret's leaf from the document's source spans, not from
        // the leaf lengths: a caret offset is document-wide, while a leaf only
        // knows its own length, so comparing the two picks the wrong block as
        // soon as the document has more than one.
        let offset = self.editor.selection().head();
        self.caret_leaf = self
            .document
            .leaf_at(offset)
            .filter(|key| geometry.get(*key).is_some());
        self.geometry = geometry;
        div()
            .id("typeset-view")
            .track_focus(&self.focus)
            .key_context("TypesetView")
            .size_full()
            .on_action(on_left)
            .on_action(on_right)
            .on_action(on_up)
            .on_action(on_down)
            .on_action(on_select_all)
            .on_action(on_newline)
            .on_action(on_backspace)
            .on_action(on_undo)
            .on_action(on_redo)
            .child(element)
    }
}

impl TypesetView {
    /// The selection as byte offsets, for the host's snapshot protocol.
    pub fn selected_range(&self) -> Range<usize> {
        self.editor.selection().range()
    }

    /// The leaf key the caret is in, when the last frame laid it out.
    pub fn caret_leaf(&self) -> Option<u64> {
        self.caret_leaf
    }
}

/// What a paste target remembers, so an async image insert can verify the
/// document has not moved on before it lands.
#[derive(Clone, Debug)]
pub struct PasteTarget {
    /// The revision the paste was taken against.
    pub revision: u64,
    /// The selection at paste time.
    pub selection: Range<usize>,
}

impl TypesetView {
    /// The revision and selection an async insert must still match.
    pub fn paste_target(&self) -> PasteTarget {
        PasteTarget {
            revision: self.editor.revision(),
            selection: self.editor.selection().range(),
        }
    }

    /// Inserts `text` only when the document and selection still match.
    ///
    /// An AI reply or an image write takes time; by the time it lands the user
    /// may have typed. Refusing is the safe answer: the caller reports that the
    /// insert was dropped rather than pasting into the wrong place.
    pub fn insert_if_unchanged(
        &mut self,
        expected_revision: u64,
        expected_range: Range<usize>,
        text: &str,
        cx: &mut Context<Self>,
    ) -> Result<u64, &'static str> {
        if self.editor.is_readonly() {
            return Err("The editor is read-only.");
        }
        if self.editor.revision() != expected_revision
            || self.editor.selection().range() != expected_range
        {
            return Err("The document or selection changed while the insert was pending.");
        }
        if self.marked.is_some() {
            return Err("Finish the current text composition before inserting.");
        }
        // A guard passed but the insert can still fail at the source level, and
        // reporting success then would tell the host a suggestion landed when it
        // did not.
        if let Err(error) = self.editor.insert(text) {
            return Err(match error {
                TypesetError::ReadOnly => "The editor is read-only.",
                TypesetError::Source(_) => "The insert was rejected by the document.",
            });
        }
        self.reparse();
        cx.notify();
        Ok(self.editor.revision())
    }

    /// Inserts an image reference only if the paste target still matches.
    ///
    /// The path check keeps a host bug from writing `](javascript:…)` into the
    /// document: only relative `./assets/` paths are accepted.
    pub fn insert_image_if_unchanged(
        &mut self,
        target: &PasteTarget,
        reference: &str,
        cx: &mut Context<Self>,
    ) -> Result<(), &'static str> {
        if !reference.starts_with("./assets/")
            || !reference.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'/' | b'_' | b'-')
            })
        {
            return Err("The image path is not a safe relative assets path.");
        }
        let markdown = format!("![image]({reference})");
        self.insert_if_unchanged(target.revision, target.selection.clone(), &markdown, cx)?;
        Ok(())
    }

    /// Whether the view has an uncommitted edit.
    ///
    /// This view commits every edit immediately, so the answer is always
    /// `false`. It exists so the host's save path does not have to special-case
    /// the editor implementation.
    pub fn has_pending_rich_edit(&self) -> bool {
        false
    }
}

impl TypesetView {
    /// The current view mode.
    pub fn source_mode(&self) -> bool {
        false
    }

    /// Moves the caret to the start of `line`, counting from one.
    pub fn seek_line(&mut self, line: usize, cx: &mut Context<Self>) {
        self.editor
            .set_caret(line_start(self.editor.source(), line));
        cx.notify();
    }

    /// Runs a host command.
    ///
    /// The commands that only existed because the WebView had a source and a
    /// split preview collapse into no-ops here: this view always shows the
    /// rendered document with the source editable in place.
    pub fn execute_command(
        &mut self,
        command: inkpoint_editor_typeset::EditorCommand,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match command {
            inkpoint_editor_typeset::EditorCommand::ToggleBold => {
                let _ = self.editor.wrap_selection("**", "**");
            }
            inkpoint_editor_typeset::EditorCommand::ToggleItalic => {
                let _ = self.editor.wrap_selection("*", "*");
            }
            inkpoint_editor_typeset::EditorCommand::ToggleInlineCode => {
                let _ = self.editor.wrap_selection("`", "`");
            }
            inkpoint_editor_typeset::EditorCommand::ToggleStrikethrough => {
                let _ = self.editor.wrap_selection("~~", "~~");
            }
            inkpoint_editor_typeset::EditorCommand::ToggleQuote => {
                let _ = self.editor.toggle_line_prefix("> ");
            }
            inkpoint_editor_typeset::EditorCommand::ToggleBulletList => {
                let _ = self.editor.toggle_line_prefix("- ");
            }
            inkpoint_editor_typeset::EditorCommand::ToggleOrderedList => {
                let _ = self.editor.toggle_line_prefix("1. ");
            }
            inkpoint_editor_typeset::EditorCommand::ToggleTaskList => {
                let _ = self.editor.toggle_line_prefix("- [ ] ");
            }
            inkpoint_editor_typeset::EditorCommand::Heading(level) => {
                let _ = self.editor.set_heading(level);
            }
        }
        self.reparse();
        cx.notify();
    }
}
