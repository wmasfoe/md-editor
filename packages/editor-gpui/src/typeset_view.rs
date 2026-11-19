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
    LeafIndex, TypesetDocument, TypesetEditor, TypesetError, caret_at, move_down, move_left,
    move_right, move_up,
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
}

impl TypesetView {
    /// Opens `source` in a new view.
    pub fn new(window: &mut Window, cx: &mut Context<Self>, source: impl Into<String>) -> Self {
        let editor = TypesetEditor::new(source);
        let document = TypesetDocument::parse(editor.source()).unwrap_or_else(|_| {
            // A document that will not parse still has to be editable: an empty
            // tree keeps the buffer alive instead of losing the user's file.
            TypesetDocument::parse("").expect("the empty document parses")
        });
        let focus = cx.focus_handle();
        focus.focus(window, cx);
        Self {
            editor,
            document,
            geometry: LeafIndex::default(),
            focus,
            caret_leaf: None,
            marked: None,
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

    /// Re-parses after the source changed.
    fn reparse(&mut self) {
        if let Ok(document) = TypesetDocument::parse(self.editor.source()) {
            self.document = document;
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
        let selection = self.editor.selection().range();
        if selection.is_empty() {
            let source = self.editor.source().to_string();
            let caret = gpui_kit::base::text::editor_host::Caret::new(selection.start);
            let previous = move_left(&source, caret).index;
            self.editor.set_selection(previous, selection.start);
        }
        let result = self.editor.insert("");
        self.apply(result, cx);
    }

    /// Moves the caret one line up, crossing into the previous leaf at the top.
    fn caret_up(&mut self, cx: &mut Context<Self>) {
        let caret = self.caret_in_leaf();
        let Some(key) = self.caret_leaf else {
            return;
        };
        if let Some(moved) = self.geometry.get(key).and_then(|leaf| move_up(leaf, caret)) {
            self.editor.set_caret(moved.index);
            cx.notify();
            return;
        }
        // At the top of this leaf: land on the previous one's last line.
        let previous = key.checked_sub(1).and_then(|key| self.geometry.get(key));
        if let Some(leaf) = previous {
            let end = gpui_kit::base::text::editor_host::Caret::new(leaf.len());
            let position = leaf.position_for_caret(end);
            let target = leaf.caret_for_position(Point {
                x: position.x,
                y: position.y + leaf.line_height() / 2.,
            });
            self.caret_leaf = Some(key - 1);
            self.editor.set_caret(target.index);
            cx.notify();
        }
    }

    /// Moves the caret one line down, crossing into the next leaf at the bottom.
    fn caret_down(&mut self, cx: &mut Context<Self>) {
        let caret = self.caret_in_leaf();
        let Some(key) = self.caret_leaf else {
            return;
        };
        if let Some(moved) = self
            .geometry
            .get(key)
            .and_then(|leaf| move_down(leaf, caret))
        {
            self.editor.set_caret(moved.index);
            cx.notify();
            return;
        }
        // At the bottom of this leaf: land on the next one's first line.
        let next = self.geometry.get(key + 1);
        if let Some(leaf) = next {
            let position = leaf.position_for_index(0);
            let target = leaf.caret_for_position(Point {
                x: position.x,
                y: position.y + leaf.line_height() / 2.,
            });
            self.caret_leaf = Some(key + 1);
            self.editor.set_caret(target.index);
            cx.notify();
        }
    }

    /// The caret within its current leaf.
    fn caret_in_leaf(&self) -> gpui_kit::base::text::editor_host::Caret {
        let offset = self.editor.selection().head();
        let key = self.caret_leaf;
        let limit = key
            .and_then(|key| self.geometry.get(key))
            .map_or(offset, |leaf| offset.min(leaf.len()));
        gpui_kit::base::text::editor_host::Caret::new(limit)
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
            KeyBinding::new("cmd-a", SelectAll, None),
        ]);
    }
}

/// Converts a UTF-8 byte offset to UTF-16 code units, for the platform.
fn utf16_offset(text: &str, byte: usize) -> usize {
    let byte = byte.min(text.len());
    text.get(..byte)
        .map_or(0, |prefix| prefix.encode_utf16().count())
}

/// Converts a UTF-16 code-unit offset to UTF-8 bytes, for this crate.
///
/// An offset that lands inside a surrogate pair rounds down to the character
/// start, because every byte offset this crate accepts must be a char boundary.
fn byte_offset(text: &str, utf16: usize) -> usize {
    let mut units = 0;
    for (byte, character) in text.char_indices() {
        // Compare after adding this character: an offset that falls inside a
        // surrogate pair then stays at the character start, which is the only
        // boundary the source can be sliced at.
        units += character.len_utf16();
        if units > utf16 {
            return byte;
        }
        if units == utf16 {
            return byte + character.len_utf8();
        }
    }
    text.len()
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
        self.apply(result, cx);
        // The composing region covers the text just inserted.
        self.marked = Some(start..start + new_text.len());
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
        let position = leaf.position_for_index(offset.min(leaf.len()));
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
        let index = caret_at(&self.geometry, point)?;
        let source = self.editor.source();
        Some(utf16_offset(source, index.index))
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

        let context = RenderContext::from_app(cx);
        let (element, geometry) = self
            .document
            .render(px(BODY_FONT_SIZE), context, window, cx);
        // The caret follows the selection, so resolve which leaf holds it from
        // this frame's geometry rather than trusting a stale key.
        let offset = self.editor.selection().head();
        self.caret_leaf = geometry
            .entries()
            .find(|(_, leaf)| offset <= leaf.len())
            .map(|(key, _)| key);
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
            .child(element)
    }
}

impl TypesetView {
    /// Inserts `text` at the caret from outside the input path, e.g. a paste.
    pub fn paste_text(&mut self, text: &str, cx: &mut Context<Self>) {
        self.insert(text, cx);
    }

    /// The selection as byte offsets, for the host's snapshot protocol.
    pub fn selected_range(&self) -> Range<usize> {
        self.editor.selection().range()
    }

    /// The leaf key the caret is in, when the last frame laid it out.
    pub fn caret_leaf(&self) -> Option<u64> {
        self.caret_leaf
    }

    /// The shared string form of the document, for elements that need one.
    pub fn markdown_shared(&self) -> SharedString {
        SharedString::from(self.editor.source().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_offsets_map_one_to_one() {
        let text = "hello";
        assert_eq!(utf16_offset(text, 0), 0);
        assert_eq!(utf16_offset(text, 3), 3);
        assert_eq!(byte_offset(text, 3), 3);
    }

    #[test]
    fn a_cjk_character_is_one_utf16_unit_and_three_bytes() {
        // "中" is one UTF-16 unit and three UTF-8 bytes. Getting this wrong puts
        // the IME composing region in the wrong place.
        let text = "a中b";
        assert_eq!(utf16_offset(text, 0), 0);
        assert_eq!(utf16_offset(text, 1), 1);
        assert_eq!(utf16_offset(text, 4), 2);
        assert_eq!(utf16_offset(text, 5), 3);
        assert_eq!(byte_offset(text, 0), 0);
        assert_eq!(byte_offset(text, 1), 1);
        assert_eq!(byte_offset(text, 2), 4);
        assert_eq!(byte_offset(text, 3), 5);
    }

    #[test]
    fn an_emoji_uses_a_surrogate_pair() {
        // "😀" is four UTF-8 bytes but two UTF-16 units.
        let text = "a😀b";
        assert_eq!(utf16_offset(text, 1), 1);
        assert_eq!(utf16_offset(text, 5), 3);
        assert_eq!(byte_offset(text, 3), 5);
    }

    #[test]
    fn an_offset_inside_a_surrogate_pair_rounds_to_the_character_start() {
        let text = "a😀b";
        // UTF-16 offset 2 is the middle of the surrogate pair.
        assert_eq!(byte_offset(text, 2), 1);
    }

    #[test]
    fn offsets_past_the_end_clamp() {
        let text = "abc";
        assert_eq!(utf16_offset(text, 99), 3);
        assert_eq!(byte_offset(text, 99), 3);
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
        let result = self.editor.insert(text);
        self.apply(result, cx);
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

    /// Whether the view has rich-text changes that are not in the source.
    ///
    /// Always `false` for the same reason: there is no separate rich buffer.
    pub fn has_unsaved_rich_changes(&self, _cx: &App) -> bool {
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
        let source = self.editor.source();
        let mut current = 1;
        let mut offset = 0;
        if line <= 1 {
            self.editor.set_caret(0);
            cx.notify();
            return;
        }
        for (index, character) in source.char_indices() {
            if current + 1 == line {
                offset = index;
                break;
            }
            if character == '\n' {
                current += 1;
                offset = index + 1;
            }
        }
        self.editor.set_caret(offset);
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
            inkpoint_editor_typeset::EditorCommand::Heading(level) => {
                let _ = self.editor.set_heading(level);
            }
        }
        self.reparse();
        cx.notify();
    }

    /// Applies host preferences.
    ///
    /// Typography currently comes from the theme through `RenderContext`; a
    /// per-document override would land here.
    pub fn apply_preferences(&mut self, _preferences: &()) {}

    /// Reports that there is nothing buffered to flush.
    ///
    /// Every edit is applied to the source immediately, so a host waiting for a
    /// flush can proceed at once.
    pub fn flush(
        &self,
        done: impl FnOnce(Result<(), String>, &mut Window, &mut Context<Self>) + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        done(Ok(()), window, cx);
    }
}
