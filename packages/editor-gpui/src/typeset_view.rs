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
    AnyElement, App, Bounds, Context, Element, ElementId, ElementInputHandler, Entity,
    EntityInputHandler, FocusHandle, GlobalElementId, InspectorElementId, IntoElement, KeyBinding,
    LayoutId, Pixels, Point, Render, SharedString, UTF16Selection, Window, actions, div,
    prelude::*, px,
};
use inkpoint_editor_typeset::{
    LeafIndex, TypesetDocument, TypesetEditor, TypesetError, byte_offset, line_start, move_down,
    move_left, move_right, move_up, utf16_offset,
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
        DeleteForward,
        Undo,
        Redo,
        Copy,
        Cut,
        Paste,
        MoveToLineStart,
        MoveToLineEnd,
        MoveToDocumentStart,
        MoveToDocumentEnd,
    ]
);

/// The body font size a document lays out at.
const BODY_FONT_SIZE: f32 = 17.;

/// The key context the editor's bindings are scoped to.
const KEY_CONTEXT: &str = "TypesetView";

/// The keystrokes for the commands whose modifier differs per platform.
///
/// Resolved at runtime from the platform the app is actually running on, not
/// from `cfg!(target_os)`: a WebAssembly build is compiled once and then runs in
/// whatever browser it is served to, so a compile-time choice would bind `cmd-z`
/// for a Linux user. `KeyBinding::new` parses statically and cannot resolve
/// `secondary-`, which is why the spelling is assembled here.
struct CommandKeys {
    select_all: String,
    copy: String,
    cut: String,
    paste: String,
    document_start: String,
    document_end: String,
    undo: String,
    redo: String,
    redo_alt: String,
}

impl CommandKeys {
    /// The keys for `os`.
    fn for_os(os: gpui_kit::OperatingSystem) -> Self {
        let modifier = if os == gpui_kit::OperatingSystem::Mac {
            "cmd"
        } else {
            "ctrl"
        };
        Self {
            select_all: format!("{modifier}-a"),
            copy: format!("{modifier}-c"),
            cut: format!("{modifier}-x"),
            paste: format!("{modifier}-v"),
            document_start: format!("{modifier}-up"),
            document_end: format!("{modifier}-down"),
            undo: format!("{modifier}-z"),
            redo: format!("{modifier}-shift-z"),
            redo_alt: format!("{modifier}-y"),
        }
    }
}

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
    /// Draws `mermaid` and `math` fences. Kept across re-parses because it owns
    /// a font database and a parsed math face.
    diagrams: inkpoint_editor_typeset::DiagramRenderer,
    /// Why the last command was rejected, when it was.
    last_error: Option<String>,
    /// The container's scroll position, so a click can be mapped back from
    /// window coordinates into the document's own space.
    scroll: gpui_kit::ScrollHandle,
    /// Where a mouse drag started, while the button is held.
    drag_anchor: Option<usize>,
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
        let diagrams = inkpoint_editor_typeset::DiagramRenderer::new(cx.asset_source().clone());
        let (document, parse_error) =
            match TypesetDocument::parse_with(editor.source(), Some(&diagrams)) {
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
            diagrams,
            last_error: None,
            scroll: gpui_kit::ScrollHandle::new(),
            drag_anchor: None,
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
        self.last_error = None;
        self.reparse();
        cx.notify();
    }

    /// Sets whether the view rejects edits.
    pub fn set_readonly(&mut self, readonly: bool, cx: &mut Context<Self>) {
        self.editor.set_readonly(readonly);
        self.last_error = None;
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
        // Every successful edit ends with a re-parse, so this is the one place
        // that can clear a stale rejection.
        self.last_error = None;
        match TypesetDocument::parse_with(self.editor.source(), Some(&self.diagrams)) {
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
    ///
    /// A rejected edit is recorded rather than dropped: typing into a read-only
    /// document or past a boundary would otherwise do nothing with no
    /// explanation, which reads as a broken key.
    fn apply(&mut self, edit: Result<(), TypesetError>, cx: &mut Context<Self>) {
        match edit {
            Ok(()) => {
                self.last_error = None;
                self.reparse();
                cx.notify();
            }
            Err(error) => {
                self.last_error = Some(error.to_string());
                cx.notify();
            }
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

    /// Re-anchors the selection at `anchor`, keeping the caret where it moved.
    ///
    /// A vertical move places the caret; extending it means restoring the
    /// anchor the selection had before the move, so the range grows instead of
    /// collapsing.
    fn extend_to(&mut self, anchor: Option<usize>, cx: &mut Context<Self>) {
        if let Some(anchor) = anchor {
            let head = self.editor.selection().head();
            self.editor.set_selection(anchor, head);
            cx.notify();
        }
    }

    /// Moves the caret to the start or end of the line, or of the document.
    ///
    /// `within_line` picks the line around the caret; otherwise the whole
    /// document. `to_end` picks which end.
    fn move_to(&mut self, within_line: bool, to_end: bool, cx: &mut Context<Self>) {
        let source = self.editor.source().to_string();
        let head = self.editor.selection().head();
        let target = if within_line {
            let start = source[..head].rfind('\n').map_or(0, |index| index + 1);
            if to_end {
                source[head..]
                    .find('\n')
                    .map_or(source.len(), |offset| head + offset)
            } else {
                start
            }
        } else if to_end {
            source.len()
        } else {
            0
        };
        self.editor.set_caret(target);
        cx.notify();
    }

    /// Writes the selection to the clipboard.
    fn copy(&mut self, cx: &mut Context<Self>) {
        let text = self.editor.selected_text().to_string();
        if text.is_empty() {
            return;
        }
        cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string(text));
        cx.notify();
    }

    /// Writes the selection to the clipboard and removes it.
    ///
    /// The clipboard is written only after the removal succeeded: writing first
    /// would clobber what the user had copied even when the cut itself was
    /// rejected.
    fn cut(&mut self, cx: &mut Context<Self>) {
        if self.editor.selected_text().is_empty() {
            return;
        }
        match self.editor.cut_selection() {
            Ok(removed) if !removed.is_empty() => {
                cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string(removed));
                self.apply(Ok(()), cx);
            }
            Ok(_) => {}
            Err(error) => self.apply(Err(error), cx),
        }
    }

    /// Inserts the clipboard's text at the caret.
    fn paste(&mut self, cx: &mut Context<Self>) {
        let Some(item) = cx.read_from_clipboard() else {
            return;
        };
        let Some(text) = item.text() else {
            return;
        };
        self.insert(&text, cx);
    }

    /// Reverts the last edit.
    fn undo(&mut self, cx: &mut Context<Self>) {
        if self.editor.is_readonly() {
            self.last_error = Some("The document is read-only.".into());
            cx.notify();
            return;
        }
        if self.editor.undo() {
            self.last_error = None;
            self.reparse();
            cx.notify();
        }
    }

    /// Reapplies the last undone edit.
    fn redo(&mut self, cx: &mut Context<Self>) {
        if self.editor.is_readonly() {
            self.last_error = Some("The document is read-only.".into());
            cx.notify();
            return;
        }
        if self.editor.redo() {
            self.last_error = None;
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
    /// Binds the editor's keys inside the editor's own key context.
    ///
    /// Scoped, not app-global: an unscoped `backspace` or `cmd-a` would claim
    /// those keys everywhere, so a focused settings field or a tree rename would
    /// silently lose them.
    pub fn bind_keys(cx: &mut App) {
        let keys = CommandKeys::for_os(cx.platform_info().os);
        cx.bind_keys([
            KeyBinding::new("left", MoveLeft, Some(KEY_CONTEXT)),
            KeyBinding::new("right", MoveRight, Some(KEY_CONTEXT)),
            KeyBinding::new("up", MoveUp, Some(KEY_CONTEXT)),
            KeyBinding::new("down", MoveDown, Some(KEY_CONTEXT)),
            KeyBinding::new("enter", InsertNewline, Some(KEY_CONTEXT)),
            KeyBinding::new("backspace", DeleteBackward, Some(KEY_CONTEXT)),
            KeyBinding::new("delete", DeleteForward, Some(KEY_CONTEXT)),
            KeyBinding::new("home", MoveToLineStart, Some(KEY_CONTEXT)),
            KeyBinding::new("end", MoveToLineEnd, Some(KEY_CONTEXT)),
            KeyBinding::load(
                &keys.document_start,
                Box::new(MoveToDocumentStart),
                Some(std::rc::Rc::new(
                    gpui_kit::KeyBindingContextPredicate::parse(KEY_CONTEXT)
                        .expect("the editor key context parses"),
                )),
                false,
                None,
                cx,
            )
            .expect("document-start binding"),
            KeyBinding::load(
                &keys.document_end,
                Box::new(MoveToDocumentEnd),
                Some(std::rc::Rc::new(
                    gpui_kit::KeyBindingContextPredicate::parse(KEY_CONTEXT)
                        .expect("the editor key context parses"),
                )),
                false,
                None,
                cx,
            )
            .expect("document-end binding"),
            KeyBinding::load(
                &keys.copy,
                Box::new(Copy),
                Some(std::rc::Rc::new(
                    gpui_kit::KeyBindingContextPredicate::parse(KEY_CONTEXT)
                        .expect("the editor key context parses"),
                )),
                false,
                None,
                cx,
            )
            .expect("copy binding"),
            KeyBinding::load(
                &keys.cut,
                Box::new(Cut),
                Some(std::rc::Rc::new(
                    gpui_kit::KeyBindingContextPredicate::parse(KEY_CONTEXT)
                        .expect("the editor key context parses"),
                )),
                false,
                None,
                cx,
            )
            .expect("cut binding"),
            KeyBinding::load(
                &keys.paste,
                Box::new(Paste),
                Some(std::rc::Rc::new(
                    gpui_kit::KeyBindingContextPredicate::parse(KEY_CONTEXT)
                        .expect("the editor key context parses"),
                )),
                false,
                None,
                cx,
            )
            .expect("paste binding"),
            // Resolved at runtime so the Playground build picks the right
            // modifier for the browser it lands in, not the machine it was
            // compiled on.
            KeyBinding::load(
                &keys.select_all,
                Box::new(SelectAll),
                Some(std::rc::Rc::new(
                    gpui_kit::KeyBindingContextPredicate::parse(KEY_CONTEXT)
                        .expect("the editor key context parses"),
                )),
                false,
                None,
                cx,
            )
            .expect("select-all binding"),
            KeyBinding::load(
                &keys.undo,
                Box::new(Undo),
                Some(std::rc::Rc::new(
                    gpui_kit::KeyBindingContextPredicate::parse(KEY_CONTEXT)
                        .expect("the editor key context parses"),
                )),
                false,
                None,
                cx,
            )
            .expect("undo binding"),
            KeyBinding::load(
                &keys.redo,
                Box::new(Redo),
                Some(std::rc::Rc::new(
                    gpui_kit::KeyBindingContextPredicate::parse(KEY_CONTEXT)
                        .expect("the editor key context parses"),
                )),
                false,
                None,
                cx,
            )
            .expect("redo binding"),
            KeyBinding::load(
                &keys.redo_alt,
                Box::new(Redo),
                Some(std::rc::Rc::new(
                    gpui_kit::KeyBindingContextPredicate::parse(KEY_CONTEXT)
                        .expect("the editor key context parses"),
                )),
                false,
                None,
                cx,
            )
            .expect("alternate redo binding"),
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
        // The composition is committed, so the next keystroke starts a new undo
        // step instead of joining the composed text.
        self.editor.commit_composition();
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
        // Composition replaces the marked region on every keystroke; joining keeps
        // it one undo step so Cmd-Z removes the character, not a stage of it.
        let result = self.editor.insert_composing(new_text);
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
        // Only when the insert landed: the offsets were computed for a document
        // that did not change, so applying them after a rejection would move the
        // caret to a meaningless place.
        if let (true, Some(selected)) = (inserted, new_selected_range) {
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
        // The leaf that owns the range, not the leaf holding the caret: the IME
        // asks for the rectangle of text it is composing.
        let key = self.document.leaf_at(offset)?;
        let leaf = self.geometry.get(key)?;
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
        // The leaf must be the one under the point, not the one holding the
        // caret: clicking into another block while the caret sits here would
        // otherwise report an offset from the wrong block, and an IME composing
        // region would open in the wrong place.
        let (key, caret) = self.geometry.caret_and_key_for_point(point)?;
        let span = self.document.span_of(key)?;
        let document_offset = span.start + caret.index.min(span.len());
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
        // Shift extends the selection vertically, matching what shift+left/right
        // already do horizontally.
        let on_up = cx.listener(|this, _: &MoveUp, window, cx| {
            let shift = window.modifiers().shift;
            let anchor = shift.then(|| this.editor.selection().anchor());
            this.caret_up(cx);
            this.extend_to(anchor, cx);
        });
        let on_down = cx.listener(|this, _: &MoveDown, window, cx| {
            let shift = window.modifiers().shift;
            let anchor = shift.then(|| this.editor.selection().anchor());
            this.caret_down(cx);
            this.extend_to(anchor, cx);
        });
        let on_select_all = cx.listener(|this, _: &SelectAll, _, cx| this.select_all(cx));
        let on_newline = cx.listener(|this, _: &InsertNewline, _, cx| this.insert("\n", cx));
        let on_backspace = cx.listener(|this, _: &DeleteBackward, _, cx| this.delete_backward(cx));
        let on_delete = cx.listener(|this, _: &DeleteForward, _, cx| {
            let result = this.editor.delete_forward();
            this.apply(result, cx);
        });
        let on_undo = cx.listener(|this, _: &Undo, _, cx| this.undo(cx));
        let on_redo = cx.listener(|this, _: &Redo, _, cx| this.redo(cx));
        let on_copy = cx.listener(|this, _: &Copy, _, cx| this.copy(cx));
        let on_cut = cx.listener(|this, _: &Cut, _, cx| this.cut(cx));
        let on_paste = cx.listener(|this, _: &Paste, _, cx| this.paste(cx));
        let on_line_start =
            cx.listener(|this, _: &MoveToLineStart, _, cx| this.move_to(true, false, cx));
        let on_line_end =
            cx.listener(|this, _: &MoveToLineEnd, _, cx| this.move_to(true, true, cx));
        let on_doc_start =
            cx.listener(|this, _: &MoveToDocumentStart, _, cx| this.move_to(false, false, cx));
        let on_doc_end =
            cx.listener(|this, _: &MoveToDocumentEnd, _, cx| this.move_to(false, true, cx));

        let context = RenderContext::from_app(cx);
        // Pass the selection through so the selected text is visibly highlighted:
        // without it, cmd-a and shift-arrow change state the user cannot see.
        let selection = self.editor.selection().range();
        let (element, decorations) = self.document.render_with_selection(
            px(BODY_FONT_SIZE),
            context,
            window,
            cx,
            Some(selection),
        );
        // The document scrolls: without this a document taller than the window
        // has no way to reach its lower half.
        let scrollable = div()
            .id("typeset-scroll")
            .size_full()
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .child(element);
        // The action handlers live on this wrapper: `InputSurface` is a plain
        // element and only registers input, it does not dispatch actions.
        let surface = div()
            .id("typeset-view")
            .track_focus(&self.focus)
            .key_context(KEY_CONTEXT)
            .size_full()
            .on_action(on_left)
            .on_action(on_right)
            .on_action(on_up)
            .on_action(on_down)
            .on_action(on_select_all)
            .on_action(on_newline)
            .on_action(on_backspace)
            .on_action(on_delete)
            .on_action(on_undo)
            .on_action(on_redo)
            .on_action(on_copy)
            .on_action(on_cut)
            .on_action(on_paste)
            .on_action(on_line_start)
            .on_action(on_line_end)
            .on_action(on_doc_start)
            .on_action(on_doc_end)
            .on_mouse_down(
                gpui_kit::MouseButton::Left,
                cx.listener(|this, event: &gpui_kit::MouseDownEvent, window, cx| {
                    this.place_caret_from_click(event.position, window, cx);
                    // Anchor the drag at the click, so moving the mouse extends
                    // the selection from here instead of moving the caret.
                    this.drag_anchor = Some(this.editor.selection().head());
                }),
            )
            .on_mouse_move(
                cx.listener(|this, event: &gpui_kit::MouseMoveEvent, window, cx| {
                    // Only while a button is held: a bare hover must not move the
                    // caret.
                    if event.pressed_button != Some(gpui_kit::MouseButton::Left) {
                        return;
                    }
                    this.extend_to(this.drag_anchor, cx);
                    this.place_caret_from_click(event.position, window, cx);
                }),
            )
            .on_mouse_up(
                gpui_kit::MouseButton::Left,
                cx.listener(|this, _: &gpui_kit::MouseUpEvent, _, cx| {
                    this.drag_anchor = None;
                    cx.notify();
                }),
            )
            .child(scrollable)
            .into_any_element();
        InputSurface {
            view: cx.entity(),
            focus: self.focus.clone(),
            child: surface,
            caret_color: gpui_kit::component::theme::Theme::global(cx).foreground,
            decorations,
        }
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
}

impl TypesetView {
    /// Places the caret where the user clicked.
    ///
    /// The click lands in window coordinates and the leaf bounds are the ones
    /// recorded at layout time. Inside a scrolled container those two differ by
    /// the scroll offset, so the point is translated into the document's own
    /// space first. The resolved index is leaf-local and is shifted by the
    /// leaf's span before it becomes a document offset.
    fn place_caret_from_click(
        &mut self,
        point: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.focus.focus(window, cx);
        let point = self.document_point(point, window, cx);
        let Some(key) = self.caret_leaf_from_point(point) else {
            return;
        };
        let (Some(leaf), Some(span)) = (self.geometry.get(key), self.document.span_of(key)) else {
            return;
        };
        let local = leaf.index_for_position(point).min(leaf.len());
        self.editor.set_caret(span.start + local);
        cx.notify();
    }

    /// The rectangle to draw the insertion caret in, when it can be located.
    ///
    /// The caret only shows for a collapsed selection: with text selected the
    /// highlight is the indicator, and a caret on top of it would be noise.
    fn caret_bounds(&self) -> Option<Bounds<Pixels>> {
        if !self.editor.selection().range().is_empty() {
            return None;
        }
        let key = self.caret_leaf?;
        let leaf = self.geometry.get(key)?;
        let span = self.document.span_of(key)?;
        let local = self.editor.selection().head().saturating_sub(span.start);
        let position = leaf.position_for_index(local.min(leaf.len()));
        Some(Bounds {
            origin: position,
            size: gpui_kit::size(px(2.), leaf.caret_height()),
        })
    }

    /// Translates a window point into the scrolled document's own space.
    ///
    /// Leaf bounds come from layout, before the container's scroll offset is
    /// applied. Adding that offset back makes a click land where the user sees
    /// the text, not where it would be if the document were not scrolled.
    fn document_point(
        &self,
        point: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Point<Pixels> {
        let _ = (window, cx);
        let offset = self.scroll.offset();
        Point {
            x: point.x + offset.x,
            y: point.y + offset.y,
        }
    }

    /// The leaf whose bounds contain `point`, else the vertically nearest one.
    fn caret_leaf_from_point(&self, point: Point<Pixels>) -> Option<u64> {
        let mut fallback: Option<(u64, Pixels)> = None;
        for (key, leaf) in self.geometry.entries() {
            let bounds = leaf.bounds();
            if bounds.contains(&point) {
                return Some(key);
            }
            // A click in the margin should still place a caret rather than do
            // nothing, so track the nearest leaf by vertical distance.
            let vertical = if point.y < bounds.origin.y {
                bounds.origin.y - point.y
            } else if point.y > bounds.origin.y + bounds.size.height {
                point.y - (bounds.origin.y + bounds.size.height)
            } else {
                Pixels::ZERO
            };
            if fallback.is_none_or(|(_, best)| vertical < best) {
                fallback = Some((key, vertical));
            }
        }
        fallback.map(|(key, _)| key)
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
        let result = match command {
            inkpoint_editor_typeset::EditorCommand::ToggleBold => {
                self.editor.wrap_selection("**", "**")
            }
            inkpoint_editor_typeset::EditorCommand::ToggleItalic => {
                self.editor.wrap_selection("*", "*")
            }
            inkpoint_editor_typeset::EditorCommand::ToggleInlineCode => {
                self.editor.wrap_selection("`", "`")
            }
            inkpoint_editor_typeset::EditorCommand::ToggleStrikethrough => {
                self.editor.wrap_selection("~~", "~~")
            }
            inkpoint_editor_typeset::EditorCommand::ToggleQuote => {
                self.editor.toggle_line_prefix("> ")
            }
            inkpoint_editor_typeset::EditorCommand::ToggleBulletList => {
                self.editor.toggle_line_prefix("- ")
            }
            inkpoint_editor_typeset::EditorCommand::ToggleOrderedList => {
                self.editor.toggle_line_prefix("1. ")
            }
            inkpoint_editor_typeset::EditorCommand::ToggleTaskList => {
                self.editor.toggle_line_prefix("- [ ] ")
            }
            inkpoint_editor_typeset::EditorCommand::Heading(level) => {
                self.editor.set_heading(level)
            }
        };
        // A rejected command is kept rather than dropped: a read-only document or
        // a range the source cannot take would otherwise fail silently, and the
        // user would see a menu click do nothing. Re-parsing only on success
        // keeps a rejected command from rebuilding the tree for nothing.
        match result {
            Ok(()) => {
                self.last_error = None;
                self.reparse();
            }
            Err(error) => self.last_error = Some(error.to_string()),
        }
        cx.notify();
    }

    /// Why the last command was rejected, when it was.
    pub fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }
}

/// Registers the view as the window's text input target.
///
/// GPUI only routes typed text and IME calls to a view that installs an input
/// handler during paint. Without this the view implements `EntityInputHandler`
/// but never receives a character: `key_char` events are dropped because the
/// window has no handler to hand them to.
struct InputSurface {
    view: Entity<TypesetView>,
    focus: FocusHandle,
    child: AnyElement,
    /// The colour to draw it in.
    caret_color: gpui_kit::Hsla,
    /// Selection decorations to paint behind the text.
    decorations: std::collections::HashMap<u64, Vec<(Range<usize>, gpui_kit::Hsla)>>,
}

impl IntoElement for InputSurface {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for InputSurface {
    type RequestLayoutState = ();
    type PrepaintState = Bounds<Pixels>;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        (self.child.request_layout(window, cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        // Geometry is only reported while the tree is prepainted, so the scope
        // has to wrap this call. Opening it during `render` — where the element is
        // merely constructed — always yields an empty map, which silently disables
        // click-to-caret, arrow navigation, the painted caret and IME bounds while
        // leaving typing intact.
        let (_, leaves) = gpui_kit::base::text::editor_host::collect_leaf_geometry(
            std::mem::take(&mut self.decorations),
            || self.child.prepaint(window, cx),
        );
        self.view.update(cx, |view, _| {
            view.geometry = LeafIndex::new(leaves);
            let offset = view.editor.selection().head();
            view.caret_leaf = view
                .document
                .leaf_at(offset)
                .filter(|key| view.geometry.get(*key).is_some());
        });
        bounds
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        _: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.child.paint(window, cx);
        // The caret is computed here, not in `render`: `render` runs before this
        // frame's geometry exists, so a rectangle taken there would draw last
        // frame's caret one frame behind the text.
        let caret = self.view.read(cx).caret_bounds();
        if let Some(caret) = caret {
            window.paint_quad(gpui_kit::fill(caret, self.caret_color));
        }
        // This is the line that makes typing work: it tells the window which
        // entity answers the platform's text and IME calls.
        window.handle_input(
            &self.focus,
            ElementInputHandler::new(bounds, self.view.clone()),
            cx,
        );
    }
}

#[cfg(test)]
mod input_tests {
    use super::*;
    use gpui_kit::TestAppContext;

    fn markdown(view: &Entity<TypesetView>, cx: &mut gpui_kit::VisualTestContext) -> String {
        view.read_with(cx, |view, _| view.markdown().to_string())
    }

    /// Opens a view with `source`, focused and drawn twice so its input handler
    /// is registered, and returns it with its window context.
    fn open<'a>(
        cx: &'a mut TestAppContext,
        source: &str,
    ) -> (Entity<TypesetView>, &'a mut gpui_kit::VisualTestContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
        // Two frames: the input handler is registered during paint, so the first
        // frame is what makes the view reachable at all.
        for _ in 0..2 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| view.focus(window, cx));
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        (view, vcx)
    }

    /// The test the whole wiring exists for: a keystroke reaches the view and
    /// changes the document.
    ///
    /// Before `InputSurface` registered a handler, GPUI had nowhere to deliver
    /// typed text, so this could not pass however correct the editing engine was.
    #[gpui_kit::test]
    fn typing_reaches_the_document(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, ""));
        // Two frames: the input handler is registered during paint, so the first
        // frame is what makes the view reachable.
        for _ in 0..2 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| view.focus(window, cx));
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        vcx.simulate_input("hi");
        assert_eq!(markdown(&view, vcx), "hi");
    }

    /// CJK input travels the same path and each character must land whole.
    #[gpui_kit::test]
    fn typing_chinese_reaches_the_document(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, ""));
        for _ in 0..2 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| view.focus(window, cx));
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        vcx.simulate_input("中文");
        assert_eq!(markdown(&view, vcx), "中文");
    }

    /// Backspace and undo, driven by real keystrokes rather than by calling the
    /// editor directly.
    #[gpui_kit::test]
    fn backspace_then_undo_round_trips(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, "abc"));
        for _ in 0..2 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| {
                    view.focus(window, cx);
                    view.set_caret(3, cx);
                });
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        vcx.simulate_keystrokes("backspace");
        assert_eq!(
            markdown(&view, vcx),
            "ab",
            "backspace deletes one character"
        );
        vcx.simulate_keystrokes("cmd-z");
        assert_eq!(markdown(&view, vcx), "abc", "undo restores it");
    }

    /// The acceptance sequence from the spec, driven through the real key path:
    /// select all, replace, type Chinese, change a heading level, and undo.
    ///
    /// This is the closest thing to "open a real article and work in it" that a
    /// headless test can express: every step goes through the window's input
    /// handler rather than calling the editor.
    #[gpui_kit::test]
    fn a_real_article_flow_works_end_to_end(cx: &mut TestAppContext) {
        let article = "# Title\n\nBody paragraph.\n\n## Section\n\nMore text.\n";
        let (view, vcx) = open(cx, article);

        // Select all, then replace it by typing: the whole buffer is rewritten.
        vcx.simulate_keystrokes("cmd-a");
        vcx.simulate_input("Replaced.");
        assert_eq!(
            markdown(&view, vcx),
            "Replaced.",
            "select-all then type replaces"
        );

        // A burst of typing is one undo step, so a single Cmd-Z brings the
        // whole article back.
        vcx.simulate_keystrokes("cmd-z");
        assert_eq!(markdown(&view, vcx), article, "undo restores the article");

        // Insert Chinese in the middle.
        vcx.update(|window, cx| {
            view.update(cx, |view, cx| {
                view.focus(window, cx);
                view.set_caret(0, cx);
            });
            window.draw(cx).clear(cx);
        });
        vcx.run_until_parked();
        vcx.simulate_input("中文");
        assert!(
            markdown(&view, vcx).starts_with("中文"),
            "Chinese input lands at the caret: {:?}",
            markdown(&view, vcx)
        );

        // The heading command rewrites the line the caret is on, driven through
        // the command path the menu uses rather than by reaching into the
        // editor — otherwise `execute_command` has no end-to-end coverage.
        vcx.update(|window, cx| {
            view.update(cx, |view, cx| {
                view.focus(window, cx);
                view.set_caret(0, cx);
                view.execute_command(
                    inkpoint_editor_typeset::EditorCommand::Heading(3),
                    window,
                    cx,
                );
            });
            window.draw(cx).clear(cx);
        });
        vcx.run_until_parked();
        assert!(
            markdown(&view, vcx).starts_with("###"),
            "setting a heading rewrites the line: {:?}",
            markdown(&view, vcx)
        );
    }

    /// Left and right move the caret by whole characters, including across a
    /// multi-byte one.
    #[gpui_kit::test]
    fn arrows_move_over_whole_characters(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, "a中b"));
        for _ in 0..2 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| {
                    view.focus(window, cx);
                    view.set_caret(5, cx);
                });
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        vcx.simulate_keystrokes("left");
        assert_eq!(
            view.read_with(&*vcx, |view, _| view.selected_range().start),
            4,
            "left from the end lands after the CJK character"
        );
        vcx.simulate_keystrokes("left");
        assert_eq!(
            view.read_with(&*vcx, |view, _| view.selected_range().start),
            1,
            "and then before it, never inside it"
        );
    }
}

#[cfg(test)]
mod key_tests {
    use super::*;

    /// The modifier is chosen from the running platform, not the build host.
    ///
    /// A WebAssembly build is compiled once and served to any browser, so a
    /// compile-time choice would bind cmd on a Linux user's machine — which is
    /// exactly the bug the Playground smoke test caught.
    #[test]
    fn command_keys_follow_the_running_platform() {
        let mac = CommandKeys::for_os(gpui_kit::OperatingSystem::Mac);
        assert_eq!(mac.undo, "cmd-z");
        assert_eq!(mac.select_all, "cmd-a");
        assert_eq!(mac.redo, "cmd-shift-z");

        let linux = CommandKeys::for_os(gpui_kit::OperatingSystem::Linux);
        assert_eq!(linux.undo, "ctrl-z");
        assert_eq!(linux.select_all, "ctrl-a");
        assert_eq!(linux.redo, "ctrl-shift-z");
    }

    /// The bindings actually register, which is what makes undo reachable.
    #[gpui_kit::test]
    fn binding_undo_succeeds_on_this_platform(cx: &mut gpui_kit::TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        // Reaching this point without a panic means `KeyBinding::load` resolved
        // every keystroke for the running platform.
    }
}

#[cfg(test)]
mod clipboard_tests {
    use super::*;
    use gpui_kit::TestAppContext;

    fn open<'a>(
        cx: &'a mut TestAppContext,
        source: &str,
    ) -> (Entity<TypesetView>, &'a mut gpui_kit::VisualTestContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
        for _ in 0..2 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| view.focus(window, cx));
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        (view, vcx)
    }

    /// Select all, cut, then paste: the text leaves and comes back.
    ///
    /// The spec's acceptance sequence names this round trip, and it goes
    /// through the platform clipboard rather than an internal buffer.
    #[gpui_kit::test]
    fn cut_then_paste_round_trips_through_the_clipboard(cx: &mut TestAppContext) {
        let (view, vcx) = open(cx, "hello world");
        vcx.simulate_keystrokes("cmd-a");
        vcx.simulate_keystrokes("cmd-x");
        assert_eq!(
            view.read_with(&*vcx, |view, _| view.markdown().to_string()),
            "",
            "cut removes the selection"
        );
        vcx.simulate_keystrokes("cmd-v");
        assert_eq!(
            view.read_with(&*vcx, |view, _| view.markdown().to_string()),
            "hello world",
            "paste puts it back"
        );
    }

    /// Copy leaves the document alone.
    #[gpui_kit::test]
    fn copy_does_not_change_the_document(cx: &mut TestAppContext) {
        let (view, vcx) = open(cx, "keep me");
        vcx.simulate_keystrokes("cmd-a");
        vcx.simulate_keystrokes("cmd-c");
        assert_eq!(
            view.read_with(&*vcx, |view, _| view.markdown().to_string()),
            "keep me"
        );
    }
}

#[cfg(test)]
mod ime_tests {
    use super::*;
    use gpui_kit::TestAppContext;

    fn open<'a>(
        cx: &'a mut TestAppContext,
        source: &str,
    ) -> (Entity<TypesetView>, &'a mut gpui_kit::VisualTestContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, source));
        for _ in 0..2 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| view.focus(window, cx));
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        (view, vcx)
    }

    /// Composing text must be insertable, reportable and clearable.
    ///
    /// The OS drives this sequence for every CJK keystroke: it replaces a range
    /// with the current composition, asks where the composing region is, and
    /// finally clears the mark when the character commits.
    #[gpui_kit::test]
    fn a_composition_is_marked_and_then_cleared(cx: &mut TestAppContext) {
        let (view, vcx) = open(cx, "");
        vcx.update(|window, cx| {
            view.update(cx, |view, cx| {
                // Start composing at the caret.
                view.replace_and_mark_text_in_range(None, "zhong", None, window, cx);
                assert!(
                    view.marked_text_range(window, cx).is_some(),
                    "a composition in progress must be reported"
                );
                assert!(view.composing(), "and the view must say it is composing");
                // Commit: the OS clears the mark.
                view.unmark_text(window, cx);
                assert!(
                    view.marked_text_range(window, cx).is_none(),
                    "a committed composition is no longer marked"
                );
                assert!(!view.composing());
            });
        });
        assert_eq!(
            view.read_with(&*vcx, |view, _| view.markdown().to_string()),
            "zhong",
            "the composed text is in the document"
        );
    }

    /// The platform asks for text by UTF-16 range and gets the right slice.
    #[gpui_kit::test]
    fn text_for_a_utf16_range_returns_the_matching_slice(cx: &mut TestAppContext) {
        let (view, vcx) = open(cx, "a中b");
        vcx.update(|window, cx| {
            view.update(cx, |view, cx| {
                let mut adjusted = None;
                let all = view
                    .text_for_range(0..3, &mut adjusted, window, cx)
                    .expect("the whole document");
                assert_eq!(all, "a中b", "three UTF-16 units cover the document");
                assert_eq!(adjusted, Some(0..3));
            });
        });
        vcx.run_until_parked();
    }

    /// Replacing a UTF-16 range writes through to the document.
    #[gpui_kit::test]
    fn replacing_a_utf16_range_edits_the_document(cx: &mut TestAppContext) {
        let (view, vcx) = open(cx, "abc");
        vcx.update(|window, cx| {
            view.update(cx, |view, cx| {
                view.replace_text_in_range(Some(1..2), "X", window, cx);
            });
        });
        assert_eq!(
            view.read_with(&*vcx, |view, _| view.markdown().to_string()),
            "aXc",
            "the range was replaced in place"
        );
    }
}

#[cfg(test)]
mod geometry_tests {
    use super::*;
    use gpui_kit::TestAppContext;

    /// The product path must produce geometry.
    ///
    /// Every caret-dependent feature — click-to-caret, arrow navigation, the
    /// painted caret, IME bounds — reads `caret_leaf`, which comes from the
    /// geometry this view collects. If it is empty, all four are inert while
    /// typing still works, so the suite can look green and the editor still be
    /// unusable by pointer.
    #[gpui_kit::test]
    fn the_view_collects_geometry_for_its_blocks(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) = cx
            .add_window_view(|window, cx| TypesetView::new(window, cx, "# Title\n\nBody text.\n"));
        for _ in 0..3 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| view.focus(window, cx));
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        let (leaves, caret_leaf) =
            view.read_with(&*vcx, |view, _| (view.geometry.len(), view.caret_leaf));
        assert!(
            leaves > 0,
            "the view must collect leaf geometry, got {leaves}"
        );
        assert!(
            caret_leaf.is_some(),
            "and resolve the caret to a leaf, got {caret_leaf:?}"
        );
    }

    /// A click must move the caret, which needs geometry from the product path.
    #[gpui_kit::test]
    fn a_click_moves_the_caret(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) = cx.add_window_view(|window, cx| {
            TypesetView::new(
                window,
                cx,
                "first line

second line
",
            )
        });
        for _ in 0..3 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| view.focus(window, cx));
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        // Click inside the second block, which only works when its leaf laid out.
        let target = view.read_with(&*vcx, |view, _| {
            view.geometry
                .entries()
                .map(|(key, leaf)| (key, leaf.bounds()))
                .find(|(_, bounds)| bounds.origin.y > gpui_kit::px(0.))
                .map(|(_, bounds)| {
                    gpui_kit::point(
                        bounds.origin.x + gpui_kit::px(2.),
                        bounds.origin.y + bounds.size.height / 2.,
                    )
                })
        });
        let Some(point) = target else {
            panic!("the second block must lay out so it can be clicked");
        };
        vcx.update(|window, cx| {
            view.update(cx, |view, cx| {
                view.place_caret_from_click(point, window, cx)
            });
        });
        let caret = view.read_with(&*vcx, |view, _| view.selected_range().start);
        assert!(
            caret > 0,
            "clicking the second block must move the caret past the first, got {caret}"
        );
    }

    /// Down must move the caret between blocks, which needs geometry.
    #[gpui_kit::test]
    fn down_moves_the_caret_to_the_next_block(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) = cx.add_window_view(|window, cx| {
            TypesetView::new(
                window,
                cx,
                "first

second

third
",
            )
        });
        for _ in 0..3 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| {
                    view.focus(window, cx);
                    view.set_caret(0, cx);
                });
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        vcx.simulate_keystrokes("down down");
        let caret = view.read_with(&*vcx, |view, _| view.selected_range().start);
        assert!(
            caret > 0,
            "pressing down must move the caret between blocks, got {caret}"
        );
    }
}
