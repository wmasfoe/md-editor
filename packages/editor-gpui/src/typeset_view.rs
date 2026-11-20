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

#[path = "find.rs"]
mod find;

use gpui_kit::base::text::editor_host::RenderContext;
use gpui_kit::{
    AnyElement, App, Bounds, Context, Element, ElementId, ElementInputHandler, Entity,
    EntityInputHandler, FocusHandle, GlobalElementId, InspectorElementId, IntoElement, KeyBinding,
    LayoutId, Pixels, Point, Render, SharedString, UTF16Selection, Window, actions, div,
    prelude::*, px,
};
use inkpoint_editor_typeset::{
    LeafIndex, TypesetDocument, TypesetEditor, TypesetError, byte_offset, line_start, move_left,
    move_right, utf16_offset,
};

actions!(
    inkpoint_typeset,
    [
        OpenFind,
        CloseFind,
        FormatBold,
        FormatItalic,
        FormatCode,
        FormatStrike,
        Heading0,
        Heading1,
        Heading2,
        Heading3,
        Heading4,
        Heading5,
        Heading6,
        ToggleQuote,
        ToggleBulletList,
        ToggleOrderedList,
        ToggleTaskList,
        TableNextCell,
        TablePreviousCell,
        Indent,
        Outdent,
        IndentListItem,
        OutdentListItem,
        MoveLeft,
        SelectLeft,
        MoveRight,
        SelectRight,
        MoveUp,
        SelectUp,
        MoveDown,
        SelectDown,
        MoveWordLeft,
        SelectWordLeft,
        MoveWordRight,
        SelectWordRight,
        SelectAll,
        InsertNewline,
        InsertPlainNewline,
        DeleteBackward,
        DeleteForward,
        DeleteWordBackward,
        DeleteWordForward,
        DeleteToLineStart,
        Undo,
        Redo,
        Copy,
        Cut,
        Paste,
        MoveToLineStart,
        SelectToLineStart,
        MoveToLineEnd,
        SelectToLineEnd,
        MoveToDocumentStart,
        SelectToDocumentStart,
        MoveToDocumentEnd,
        SelectToDocumentEnd,
    ]
);

/// The body font size a document lays out at.
const BODY_FONT_SIZE: f32 = 17.;

/// Host-controlled typography, independent of the document and its selection.
#[derive(Clone, Debug, PartialEq)]
pub struct TypesetTypography {
    pub body_font_size: f32,
    pub prose_font_family: String,
    pub code_font_family: String,
}

impl Default for TypesetTypography {
    fn default() -> Self {
        Self {
            body_font_size: BODY_FONT_SIZE,
            prose_font_family: String::new(),
            code_font_family: String::new(),
        }
    }
}

impl TypesetTypography {
    fn render_context(&self, cx: &App) -> RenderContext {
        let mut context = RenderContext::from_app(cx);
        if !self.code_font_family.is_empty() {
            let family: SharedString = self.code_font_family.clone().into();
            let style = context.style().clone();
            let code_block = style.code_block().clone().font_family(family.clone());
            let inline_code = style.inline_code_style().clone().font_family(family);
            context = context.with_style(
                style
                    .with_code_block(code_block)
                    .with_inline_code_style(inline_code),
            );
        }
        context
    }
}

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
    find: String,
    bold: String,
    italic: String,
    code: String,
    strike: String,
    select_all: String,
    copy: String,
    cut: String,
    paste: String,
    document_start: String,
    document_end: String,
    shift_document_start: String,
    shift_document_end: String,
    line_start: String,
    line_end: String,
    shift_line_start: String,
    shift_line_end: String,
    word_left: String,
    word_right: String,
    shift_word_left: String,
    shift_word_right: String,
    delete_word_backward: String,
    delete_word_forward: String,
    delete_line_start: String,
    heading_0: String,
    heading_1: String,
    heading_2: String,
    heading_3: String,
    heading_4: String,
    heading_5: String,
    heading_6: String,
    bullet_list: String,
    ordered_list: String,
    task_list: String,
    quote: String,
    undo: String,
    redo: String,
    redo_alt: String,
}

impl CommandKeys {
    /// The keys for `os`.
    fn for_os(os: gpui_kit::OperatingSystem) -> Self {
        let is_mac = os == gpui_kit::OperatingSystem::Mac;
        let modifier = if is_mac { "cmd" } else { "ctrl" };
        let [(_, bold), (_, italic), (_, code), (_, strike)] = crate::format_shortcuts(os);
        let (
            line_start,
            line_end,
            shift_line_start,
            shift_line_end,
            word_left,
            word_right,
            shift_word_left,
            shift_word_right,
            delete_word_backward,
            delete_word_forward,
            delete_line_start,
            document_start,
            document_end,
            shift_document_start,
            shift_document_end,
        ) = if is_mac {
            (
                "cmd-left".into(),
                "cmd-right".into(),
                "shift-cmd-left".into(),
                "shift-cmd-right".into(),
                "alt-left".into(),
                "alt-right".into(),
                "shift-alt-left".into(),
                "shift-alt-right".into(),
                "alt-backspace".into(),
                "alt-delete".into(),
                "cmd-backspace".into(),
                "cmd-up".into(),
                "cmd-down".into(),
                "shift-cmd-up".into(),
                "shift-cmd-down".into(),
            )
        } else {
            (
                "home".into(),
                "end".into(),
                "shift-home".into(),
                "shift-end".into(),
                "ctrl-left".into(),
                "ctrl-right".into(),
                "shift-ctrl-left".into(),
                "shift-ctrl-right".into(),
                "ctrl-backspace".into(),
                "ctrl-delete".into(),
                "ctrl-u".into(),
                "ctrl-home".into(),
                "ctrl-end".into(),
                "shift-ctrl-home".into(),
                "shift-ctrl-end".into(),
            )
        };
        Self {
            find: format!("{modifier}-f"),
            bold,
            italic,
            code,
            strike,
            heading_0: format!("{modifier}-0"),
            heading_1: format!("{modifier}-1"),
            heading_2: format!("{modifier}-2"),
            heading_3: format!("{modifier}-3"),
            heading_4: format!("{modifier}-4"),
            heading_5: format!("{modifier}-5"),
            heading_6: format!("{modifier}-6"),
            bullet_list: format!("{modifier}-shift-u"),
            ordered_list: format!("{modifier}-shift-o"),
            task_list: format!("{modifier}-shift-t"),
            quote: format!("{modifier}-shift-q"),
            select_all: format!("{modifier}-a"),
            copy: format!("{modifier}-c"),
            cut: format!("{modifier}-x"),
            paste: format!("{modifier}-v"),
            document_start,
            document_end,
            shift_document_start,
            shift_document_end,
            line_start,
            line_end,
            shift_line_start,
            shift_line_end,
            word_left,
            word_right,
            shift_word_left,
            shift_word_right,
            delete_word_backward,
            delete_word_forward,
            delete_line_start,
            undo: format!("{modifier}-z"),
            redo: format!("{modifier}-shift-z"),
            redo_alt: format!("{modifier}-y"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum DragMode {
    Char,
    Word(Range<usize>),
    Line(Range<usize>),
}

/// A GPUI element that renders and edits Markdown.
pub struct TypesetView {
    typography: TypesetTypography,
    find: find::FindState,
    editor: TypesetEditor,
    document: TypesetDocument,
    geometry: LeafIndex,
    focus: FocusHandle,
    /// The leaf the caret is in, as reported by the last frame's geometry.
    caret_leaf: Option<u64>,
    /// Composing text range in UTF-8 bytes, while an IME is active.
    marked: Option<Range<usize>>,
    image_paste_enabled: bool,
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
    drag_mode: DragMode,
    drag_start_point: Option<Point<Pixels>>,
    /// Sticky horizontal column for vertical arrow navigation.
    goal_x: Option<Pixels>,
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
        let find = find::FindState::new(window, cx);
        Self {
            find,
            typography: TypesetTypography::default(),
            editor,
            document,
            geometry: LeafIndex::default(),
            focus,
            caret_leaf: None,
            marked: None,
            image_paste_enabled: false,
            diagrams,
            last_error: None,
            scroll: gpui_kit::ScrollHandle::new(),
            drag_anchor: None,
            drag_mode: DragMode::Char,
            drag_start_point: None,
            goal_x: None,
            parse_error,
        }
    }

    /// Enables image paste events when the host can persist clipboard images.
    pub fn set_image_paste_enabled(&mut self, enabled: bool) {
        self.image_paste_enabled = enabled;
    }

    /// Applies typography without changing the document or editing state.
    pub fn set_typography(&mut self, typography: TypesetTypography, cx: &mut Context<Self>) {
        if self.typography != typography {
            self.typography = typography;
            cx.notify();
        }
    }

    fn navigate_table(&mut self, backward: bool, cx: &mut Context<Self>) {
        if self.marked.is_some() {
            return;
        }
        let Some(target) = inkpoint_editor_typeset::navigate_table(
            self.editor.source(),
            self.editor.selection().range(),
            backward,
        ) else {
            return;
        };
        match target {
            inkpoint_editor_typeset::TableNavigation::Select(range) => {
                self.editor.set_selection(range.start, range.end);
                cx.notify();
            }
            inkpoint_editor_typeset::TableNavigation::AppendRow {
                offset,
                text,
                caret,
            } => {
                if self.editor.is_readonly() {
                    return;
                }
                self.editor.set_caret(offset);
                let result = self.editor.insert(&text);
                if result.is_ok() {
                    self.editor.set_caret(caret);
                }
                self.apply(result, cx);
            }
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
        self.goal_x = None;
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
        self.goal_x = None;
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
        self.goal_x = None;
        match edit {
            Ok(()) => {
                self.last_error = None;
                self.reparse();
                self.scroll_caret_into_view();
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
        if let Ok(true) = self.editor.try_wrap_pair(text) {
            self.apply(Ok(()), cx);
            return;
        }
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
        self.move_vertical(true, false, cx);
    }

    /// Moves the caret one visual line down, crossing into the next leaf at the
    /// bottom of this one.
    fn caret_down(&mut self, cx: &mut Context<Self>) {
        self.move_vertical(false, false, cx);
    }

    /// One vertical step, staying inside the leaf or crossing into a neighbour.
    ///
    /// Preserves `goal_x` across vertical movements so navigation through short
    /// or empty lines does not discard the user's intended column.
    fn move_vertical(&mut self, up: bool, shift: bool, cx: &mut Context<Self>) {
        if !shift && !self.editor.selection().is_collapsed() {
            let target = if up {
                self.editor.selection().range().start
            } else {
                self.editor.selection().range().end
            };
            self.editor.set_caret(target);
        }
        let key = match self.caret_leaf.or_else(|| {
            let offset = self.editor.selection().head();
            self.document.leaf_at(offset)
        }) {
            Some(k) => k,
            None => return,
        };
        let Some(leaf) = self.geometry.get(key) else {
            return;
        };
        let Some(span) = self.document.span_of(key) else {
            return;
        };
        let local = self
            .document
            .rendered_offset(key, self.editor.selection().head())
            .unwrap_or(0);
        let caret = gpui_kit::base::text::editor_host::Caret::new(local.min(leaf.len()));
        let origin = leaf.position_for_caret(caret);
        let goal_x = *self.goal_x.get_or_insert(origin.x);

        // Stay inside this leaf when it has another visual line.
        let inside = inkpoint_editor_typeset::move_vertical_with_goal(
            leaf,
            caret,
            if up {
                inkpoint_editor_typeset::Vertical::Up
            } else {
                inkpoint_editor_typeset::Vertical::Down
            },
            Some(goal_x),
        );
        if let Some(moved) = inside {
            self.editor.set_caret(
                self.document
                    .source_offset(key, moved.index.min(leaf.len()))
                    .unwrap_or(span.start),
            );
            self.scroll_caret_into_view();
            cx.notify();
            return;
        }

        // Otherwise cross into the nearest laid-out neighbour.
        let laid_out: Vec<u64> = self.geometry.entries().map(|(key, _)| key).collect();
        let Some((neighbour_key, neighbour_span)) =
            self.document.vertical_neighbour(key, up, &laid_out)
        else {
            return;
        };
        let Some(neighbour) = self.geometry.get(neighbour_key) else {
            return;
        };
        let bounds = neighbour.bounds();
        let target_y = if up {
            bounds.origin.y + (bounds.size.height - px(2.0)).max(px(0.0))
        } else {
            bounds.origin.y + px(2.0)
        };
        let target = neighbour.caret_for_position(Point {
            x: goal_x,
            y: target_y,
        });
        self.editor.set_caret(
            self.document
                .source_offset(neighbour_key, target.index.min(neighbour.len()))
                .unwrap_or(neighbour_span.start),
        );
        self.scroll_caret_into_view();
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
            self.scroll_caret_into_view();
            cx.notify();
        }
    }

    /// Moves the caret to the start or end of the line, or of the document.
    ///
    /// `within_line` picks the line around the caret; otherwise the whole
    /// document. `to_end` picks which end.
    fn move_to(&mut self, within_line: bool, to_end: bool, shift: bool, cx: &mut Context<Self>) {
        self.goal_x = None;
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
        let anchor = if shift {
            self.editor.selection().anchor()
        } else {
            target
        };
        self.editor.set_selection(anchor, target);
        self.scroll_caret_into_view();
        cx.notify();
    }

    /// Writes the selection to the clipboard.
    fn copy(&mut self, cx: &mut Context<Self>) {
        self.goal_x = None;
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

    /// Gives images to capable hosts; otherwise inserts available text.
    fn paste(&mut self, cx: &mut Context<Self>) {
        let Some(item) = cx.read_from_clipboard() else {
            return;
        };
        let image = self
            .image_paste_enabled
            .then(|| {
                item.entries().iter().find_map(|entry| match entry {
                    gpui_kit::ClipboardEntry::Image(image) => Some(image.clone()),
                    _ => None,
                })
            })
            .flatten();
        if let Some(image) = image {
            if self.editor.is_readonly() {
                self.last_error = Some("The document is read-only.".into());
                cx.notify();
                return;
            }
            if self.marked.is_some() {
                self.last_error =
                    Some("Finish the current text composition before inserting.".into());
                cx.notify();
                return;
            }
            cx.emit(ImagePaste {
                image,
                target: PasteTarget {
                    revision: self.editor.revision(),
                    selection: self.editor.selection().range(),
                },
            });
        } else if let Some(text) = item.text() {
            if let Ok(true) = self.editor.paste_smart_link(&text) {
                self.apply(Ok(()), cx);
                return;
            }
            self.insert(&text, cx);
        }
    }

    /// Reverts the last edit.
    fn undo(&mut self, cx: &mut Context<Self>) {
        self.goal_x = None;
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
        self.goal_x = None;
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
        self.goal_x = None;
        let len = self.editor.source().len();
        self.editor.set_selection(0, len);
        cx.notify();
    }

    /// Moves the caret left, extending the selection when `shift` is held.
    fn do_move_left(&mut self, shift: bool, cx: &mut Context<Self>) {
        self.goal_x = None;
        if !shift && !self.editor.selection().is_collapsed() {
            let start = self.editor.selection().range().start;
            self.editor.set_caret(start);
            self.scroll_caret_into_view();
            cx.notify();
            return;
        }
        let head = self.editor.selection().head();
        let caret = gpui_kit::base::text::editor_host::Caret::new(head);
        let moved = move_left(self.editor.source(), caret).index;
        let anchor = if shift {
            self.editor.selection().anchor()
        } else {
            moved
        };
        self.editor.set_selection(anchor, moved);
        self.scroll_caret_into_view();
        cx.notify();
    }

    /// Moves the caret right, extending the selection when `shift` is held.
    fn do_move_right(&mut self, shift: bool, cx: &mut Context<Self>) {
        self.goal_x = None;
        if !shift && !self.editor.selection().is_collapsed() {
            let end = self.editor.selection().range().end;
            self.editor.set_caret(end);
            self.scroll_caret_into_view();
            cx.notify();
            return;
        }
        let head = self.editor.selection().head();
        let caret = gpui_kit::base::text::editor_host::Caret::new(head);
        let moved = move_right(self.editor.source(), caret).index;
        let anchor = if shift {
            self.editor.selection().anchor()
        } else {
            moved
        };
        self.editor.set_selection(anchor, moved);
        self.scroll_caret_into_view();
        cx.notify();
    }

    /// Moves the caret by word left or right, extending the selection when `shift` is held.
    fn do_move_word(&mut self, forward: bool, shift: bool, cx: &mut Context<Self>) {
        self.goal_x = None;
        let head = self.editor.selection().head();
        let caret = gpui_kit::base::text::editor_host::Caret::new(head);
        let moved = if forward {
            inkpoint_editor_typeset::move_word_right(self.editor.source(), caret).index
        } else {
            inkpoint_editor_typeset::move_word_left(self.editor.source(), caret).index
        };
        let anchor = if shift {
            self.editor.selection().anchor()
        } else {
            moved
        };
        self.editor.set_selection(anchor, moved);
        self.scroll_caret_into_view();
        cx.notify();
    }

    fn delete_word_backward(&mut self, cx: &mut Context<Self>) {
        self.goal_x = None;
        let result = self.editor.delete_word_backward();
        self.apply(result, cx);
    }

    fn delete_to_line_start(&mut self, cx: &mut Context<Self>) {
        self.goal_x = None;
        let result = self.editor.delete_to_line_start();
        self.apply(result, cx);
    }

    /// Scrolls the container so the caret is inside the visible viewport with a padding margin.
    pub(crate) fn scroll_caret_into_view(&mut self) {
        let head = self.editor.selection().head();
        self.scroll_offset_into_view(head);
    }

    /// Scrolls the container so `offset` is inside the visible viewport.
    pub(crate) fn scroll_offset_into_view(&mut self, offset: usize) {
        let viewport = self.scroll.bounds();
        if viewport.size.height <= px(0.) {
            return;
        }
        let Some((leaf, local)) = self.document.leaf_at(offset).and_then(|key| {
            Some((
                self.geometry.get(key)?,
                self.document.rendered_offset(key, offset)?,
            ))
        }) else {
            return;
        };
        let y = leaf.position_for_index(local.min(leaf.len())).y;
        let caret_h = leaf.caret_height();
        let scroll_offset = self.scroll.offset();
        let margin = px(20.);
        let top_limit = viewport.top() + margin;
        let bottom_limit = viewport.bottom() - margin;
        let adjustment = if y < top_limit {
            top_limit - y
        } else if y + caret_h > bottom_limit {
            bottom_limit - (y + caret_h)
        } else {
            px(0.)
        };
        if adjustment != px(0.) {
            self.scroll.set_offset(gpui_kit::point(
                scroll_offset.x,
                scroll_offset.y + adjustment,
            ));
        }
    }

    /// Binds the movement keys.
    /// Binds the editor's keys inside the editor's own key context.
    ///
    /// Scoped, not app-global: an unscoped `backspace` or `cmd-a` would claim
    /// those keys everywhere, so a focused settings field or a tree rename would
    /// silently lose them.
    pub fn bind_keys(cx: &mut App) {
        let keys = CommandKeys::for_os(cx.platform_info().os);
        let load = |key: &str, action: Box<dyn gpui_kit::Action>, cx: &mut App| {
            KeyBinding::load(
                key,
                action,
                Some(std::rc::Rc::new(
                    gpui_kit::KeyBindingContextPredicate::parse(KEY_CONTEXT)
                        .expect("editor context"),
                )),
                false,
                None,
                cx,
            )
            .expect("key binding")
        };
        let bindings = vec![
            KeyBinding::new("escape", find::CloseFind, Some("TypesetFind")),
            KeyBinding::new("escape", CloseFind, Some(KEY_CONTEXT)),
            KeyBinding::new("cmd-h", find::ToggleReplace, Some("TypesetFind")),
            KeyBinding::new("ctrl-h", find::ToggleReplace, Some("TypesetFind")),
            KeyBinding::new("alt-cmd-f", find::ToggleReplace, Some("TypesetFind")),
            KeyBinding::new("alt-ctrl-f", find::ToggleReplace, Some("TypesetFind")),
            KeyBinding::new("alt-cmd-c", find::ToggleCaseSensitive, Some("TypesetFind")),
            KeyBinding::new("alt-ctrl-c", find::ToggleCaseSensitive, Some("TypesetFind")),
            KeyBinding::new("alt-cmd-w", find::ToggleWholeWord, Some("TypesetFind")),
            KeyBinding::new("alt-ctrl-w", find::ToggleWholeWord, Some("TypesetFind")),
            KeyBinding::new("alt-cmd-r", find::ToggleRegex, Some("TypesetFind")),
            KeyBinding::new("alt-ctrl-r", find::ToggleRegex, Some("TypesetFind")),
            KeyBinding::new("tab", TableNextCell, Some("TypesetView && table_cell")),
            KeyBinding::new(
                "shift-tab",
                TablePreviousCell,
                Some("TypesetView && table_cell"),
            ),
            KeyBinding::new("tab", IndentListItem, Some("TypesetView && list_item")),
            KeyBinding::new(
                "shift-tab",
                OutdentListItem,
                Some("TypesetView && list_item"),
            ),
            KeyBinding::new("tab", Indent, Some("TypesetView && has_selection")),
            KeyBinding::new("shift-tab", Outdent, Some(KEY_CONTEXT)),
            KeyBinding::new("shift-enter", InsertPlainNewline, Some(KEY_CONTEXT)),
            KeyBinding::new("left", MoveLeft, Some(KEY_CONTEXT)),
            KeyBinding::new("shift-left", SelectLeft, Some(KEY_CONTEXT)),
            KeyBinding::new("right", MoveRight, Some(KEY_CONTEXT)),
            KeyBinding::new("shift-right", SelectRight, Some(KEY_CONTEXT)),
            KeyBinding::new("up", MoveUp, Some(KEY_CONTEXT)),
            KeyBinding::new("shift-up", SelectUp, Some(KEY_CONTEXT)),
            KeyBinding::new("down", MoveDown, Some(KEY_CONTEXT)),
            KeyBinding::new("shift-down", SelectDown, Some(KEY_CONTEXT)),
            KeyBinding::new("home", MoveToLineStart, Some(KEY_CONTEXT)),
            KeyBinding::new("shift-home", SelectToLineStart, Some(KEY_CONTEXT)),
            KeyBinding::new("end", MoveToLineEnd, Some(KEY_CONTEXT)),
            KeyBinding::new("shift-end", SelectToLineEnd, Some(KEY_CONTEXT)),
            KeyBinding::new("enter", InsertNewline, Some(KEY_CONTEXT)),
            KeyBinding::new("backspace", DeleteBackward, Some(KEY_CONTEXT)),
            KeyBinding::new("delete", DeleteForward, Some(KEY_CONTEXT)),
            load(&keys.find, Box::new(OpenFind), cx),
            load(&keys.bold, Box::new(FormatBold), cx),
            load(&keys.italic, Box::new(FormatItalic), cx),
            load(&keys.code, Box::new(FormatCode), cx),
            load(&keys.strike, Box::new(FormatStrike), cx),
            load(&keys.heading_0, Box::new(Heading0), cx),
            load(&keys.heading_1, Box::new(Heading1), cx),
            load(&keys.heading_2, Box::new(Heading2), cx),
            load(&keys.heading_3, Box::new(Heading3), cx),
            load(&keys.heading_4, Box::new(Heading4), cx),
            load(&keys.heading_5, Box::new(Heading5), cx),
            load(&keys.heading_6, Box::new(Heading6), cx),
            load(&keys.bullet_list, Box::new(ToggleBulletList), cx),
            load(&keys.ordered_list, Box::new(ToggleOrderedList), cx),
            load(&keys.task_list, Box::new(ToggleTaskList), cx),
            load(&keys.quote, Box::new(ToggleQuote), cx),
            load(&keys.copy, Box::new(Copy), cx),
            load(&keys.cut, Box::new(Cut), cx),
            load(&keys.paste, Box::new(Paste), cx),
            load(&keys.select_all, Box::new(SelectAll), cx),
            load(&keys.undo, Box::new(Undo), cx),
            load(&keys.redo, Box::new(Redo), cx),
            load(&keys.redo_alt, Box::new(Redo), cx),
            load(&keys.line_start, Box::new(MoveToLineStart), cx),
            load(&keys.line_end, Box::new(MoveToLineEnd), cx),
            load(&keys.shift_line_start, Box::new(SelectToLineStart), cx),
            load(&keys.shift_line_end, Box::new(SelectToLineEnd), cx),
            load(&keys.word_left, Box::new(MoveWordLeft), cx),
            load(&keys.word_right, Box::new(MoveWordRight), cx),
            load(&keys.shift_word_left, Box::new(SelectWordLeft), cx),
            load(&keys.shift_word_right, Box::new(SelectWordRight), cx),
            load(&keys.document_start, Box::new(MoveToDocumentStart), cx),
            load(&keys.document_end, Box::new(MoveToDocumentEnd), cx),
            load(
                &keys.shift_document_start,
                Box::new(SelectToDocumentStart),
                cx,
            ),
            load(&keys.shift_document_end, Box::new(SelectToDocumentEnd), cx),
            load(&keys.delete_word_backward, Box::new(DeleteWordBackward), cx),
            load(&keys.delete_word_forward, Box::new(DeleteWordForward), cx),
            load(&keys.delete_line_start, Box::new(DeleteToLineStart), cx),
        ];
        cx.bind_keys(bindings);
    }
}

impl TypesetView {
    fn ime_replacement_range(&self, range: Option<Range<usize>>) -> Range<usize> {
        // GPUI passes None when the platform omits an explicit replacement
        // range. An update then targets the preedit even if its caret is at the end.
        range
            .map(|range| {
                let source = self.editor.source();
                byte_offset(source, range.start)..byte_offset(source, range.end)
            })
            .or_else(|| self.marked.clone())
            .unwrap_or_else(|| self.editor.selection().range())
    }

    fn finish_composition(&mut self) {
        self.marked = None;
        self.editor.commit_composition();
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
        self.finish_composition();
        cx.notify();
    }

    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let target = self.ime_replacement_range(range);
        self.editor.set_selection(target.start, target.end);
        if self.composing() {
            // Candidate insertion is the last update of the same undo step.
            let result = self.editor.insert_composing(text);
            self.finish_composition();
            self.apply(result, cx);
        } else {
            self.insert(text, cx);
        }
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        new_text: &str,
        new_selected_range: Option<Range<usize>>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let target = self.ime_replacement_range(range);
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
        if inserted && !new_text.is_empty() {
            self.marked = Some(start..start + new_text.len());
        } else {
            self.finish_composition();
        }
        // Only when the insert landed: the offsets were computed for a document
        // that did not change, so applying them after a rejection would move the
        // caret to a meaningless place.
        if let (true, Some(selected)) = (inserted, new_selected_range) {
            let from = start + byte_offset(new_text, selected.start);
            let to = start + byte_offset(new_text, selected.end);
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
        let local = self.document.rendered_offset(key, offset).unwrap_or(0);
        let position = leaf.position_for_index(local.min(leaf.len()));
        let height = leaf.caret_height();
        // Prepaint geometry already includes the scroll offset.
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
        let document_offset = self
            .document
            .source_offset(key, caret.index)
            .unwrap_or(span.start);
        let source = self.editor.source();
        Some(utf16_offset(source, document_offset))
    }

    fn set_selected_text_range(
        &mut self,
        range: Range<usize>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.goal_x = None;
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
        let on_table_next =
            cx.listener(|this, _: &TableNextCell, _, cx| this.navigate_table(false, cx));
        let on_table_previous =
            cx.listener(|this, _: &TablePreviousCell, _, cx| this.navigate_table(true, cx));
        let on_find = cx.listener(|this, _: &OpenFind, window, cx| this.open_find(window, cx));
        let on_left = cx.listener(|this, _: &MoveLeft, _, cx| {
            this.do_move_left(false, cx);
        });
        let on_select_left = cx.listener(|this, _: &SelectLeft, _, cx| {
            this.do_move_left(true, cx);
        });
        let on_right = cx.listener(|this, _: &MoveRight, _, cx| {
            this.do_move_right(false, cx);
        });
        let on_select_right = cx.listener(|this, _: &SelectRight, _, cx| {
            this.do_move_right(true, cx);
        });
        let on_up = cx.listener(|this, _: &MoveUp, _, cx| {
            this.caret_up(cx);
        });
        let on_select_up = cx.listener(|this, _: &SelectUp, _, cx| {
            let anchor = this.editor.selection().anchor();
            this.move_vertical(true, true, cx);
            this.extend_to(Some(anchor), cx);
        });
        let on_down = cx.listener(|this, _: &MoveDown, _, cx| {
            this.caret_down(cx);
        });
        let on_select_down = cx.listener(|this, _: &SelectDown, _, cx| {
            let anchor = this.editor.selection().anchor();
            this.move_vertical(false, true, cx);
            this.extend_to(Some(anchor), cx);
        });
        let on_format_bold = cx.listener(|this, _: &FormatBold, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::ToggleBold,
                window,
                cx,
            )
        });
        let on_format_italic = cx.listener(|this, _: &FormatItalic, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::ToggleItalic,
                window,
                cx,
            )
        });
        let on_format_code = cx.listener(|this, _: &FormatCode, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::ToggleInlineCode,
                window,
                cx,
            )
        });
        let on_format_strike = cx.listener(|this, _: &FormatStrike, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::ToggleStrikethrough,
                window,
                cx,
            )
        });
        let on_indent = cx.listener(|this, _: &IndentListItem, _, cx| {
            if let Ok(true) = this.editor.indent_list(true) {
                this.apply(Ok(()), cx);
            } else {
                this.insert("  ", cx);
            }
        });
        let on_outdent = cx.listener(|this, _: &OutdentListItem, _, cx| {
            if let Ok(true) = this.editor.outdent_current() {
                this.apply(Ok(()), cx);
            }
        });
        let on_indent_general = cx.listener(|this, _: &Indent, _, cx| {
            if this.marked.is_some() {
                return;
            }
            if inkpoint_editor_typeset::navigate_table(
                this.editor.source(),
                this.editor.selection().range(),
                false,
            )
            .is_some()
            {
                this.navigate_table(false, cx);
                return;
            }
            if let Ok(true) = this.editor.indent_selection(true) {
                this.apply(Ok(()), cx);
            } else {
                this.insert("  ", cx);
            }
        });
        let on_outdent_general = cx.listener(|this, _: &Outdent, _, cx| {
            if this.marked.is_some() {
                return;
            }
            if inkpoint_editor_typeset::navigate_table(
                this.editor.source(),
                this.editor.selection().range(),
                true,
            )
            .is_some()
            {
                this.navigate_table(true, cx);
                return;
            }
            if let Ok(true) = this.editor.indent_selection(false) {
                this.apply(Ok(()), cx);
            } else if let Ok(true) = this.editor.outdent_current() {
                this.apply(Ok(()), cx);
            }
        });
        let on_soft_break = cx.listener(|this, _: &InsertPlainNewline, _, cx| {
            let result = this.editor.insert_soft_break();
            this.apply(result, cx);
        });
        let on_heading_0 = cx.listener(|this, _: &Heading0, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::Heading(0),
                window,
                cx,
            );
        });
        let on_heading_1 = cx.listener(|this, _: &Heading1, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::Heading(1),
                window,
                cx,
            );
        });
        let on_heading_2 = cx.listener(|this, _: &Heading2, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::Heading(2),
                window,
                cx,
            );
        });
        let on_heading_3 = cx.listener(|this, _: &Heading3, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::Heading(3),
                window,
                cx,
            );
        });
        let on_heading_4 = cx.listener(|this, _: &Heading4, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::Heading(4),
                window,
                cx,
            );
        });
        let on_heading_5 = cx.listener(|this, _: &Heading5, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::Heading(5),
                window,
                cx,
            );
        });
        let on_heading_6 = cx.listener(|this, _: &Heading6, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::Heading(6),
                window,
                cx,
            );
        });
        let on_toggle_quote = cx.listener(|this, _: &ToggleQuote, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::ToggleQuote,
                window,
                cx,
            );
        });
        let on_toggle_bullet = cx.listener(|this, _: &ToggleBulletList, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::ToggleBulletList,
                window,
                cx,
            );
        });
        let on_toggle_ordered = cx.listener(|this, _: &ToggleOrderedList, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::ToggleOrderedList,
                window,
                cx,
            );
        });
        let on_toggle_task = cx.listener(|this, _: &ToggleTaskList, window, cx| {
            this.execute_command(
                inkpoint_editor_typeset::EditorCommand::ToggleTaskList,
                window,
                cx,
            );
        });
        let on_close_find = cx.listener(|this, _: &CloseFind, window, cx| {
            if this.find.open {
                this.close_find(window, cx);
            }
        });
        let on_word_left = cx.listener(|this, _: &MoveWordLeft, _, cx| {
            this.do_move_word(false, false, cx);
        });
        let on_select_word_left = cx.listener(|this, _: &SelectWordLeft, _, cx| {
            this.do_move_word(false, true, cx);
        });
        let on_word_right = cx.listener(|this, _: &MoveWordRight, _, cx| {
            this.do_move_word(true, false, cx);
        });
        let on_select_word_right = cx.listener(|this, _: &SelectWordRight, _, cx| {
            this.do_move_word(true, true, cx);
        });
        let on_delete_word_backward = cx.listener(|this, _: &DeleteWordBackward, _, cx| {
            this.delete_word_backward(cx);
        });
        let on_delete_word_forward = cx.listener(|this, _: &DeleteWordForward, _, cx| {
            let result = this.editor.delete_word_forward();
            this.apply(result, cx);
        });
        let on_delete_line_start = cx.listener(|this, _: &DeleteToLineStart, _, cx| {
            this.delete_to_line_start(cx);
        });
        let on_select_all = cx.listener(|this, _: &SelectAll, _, cx| this.select_all(cx));
        let on_newline = cx.listener(|this, _: &InsertNewline, _, cx| {
            let result = this.editor.insert_newline();
            this.apply(result, cx);
        });
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
            cx.listener(|this, _: &MoveToLineStart, _, cx| this.move_to(true, false, false, cx));
        let on_select_line_start =
            cx.listener(|this, _: &SelectToLineStart, _, cx| this.move_to(true, false, true, cx));
        let on_line_end =
            cx.listener(|this, _: &MoveToLineEnd, _, cx| this.move_to(true, true, false, cx));
        let on_select_line_end =
            cx.listener(|this, _: &SelectToLineEnd, _, cx| this.move_to(true, true, true, cx));
        let on_doc_start = cx
            .listener(|this, _: &MoveToDocumentStart, _, cx| this.move_to(false, false, false, cx));
        let on_select_doc_start = cx.listener(|this, _: &SelectToDocumentStart, _, cx| {
            this.move_to(false, false, true, cx)
        });
        let on_doc_end =
            cx.listener(|this, _: &MoveToDocumentEnd, _, cx| this.move_to(false, true, false, cx));
        let on_select_doc_end =
            cx.listener(|this, _: &SelectToDocumentEnd, _, cx| this.move_to(false, true, true, cx));

        let context = self.typography.render_context(cx);
        // Pass the selection through so the selected text is visibly highlighted:
        // without it, cmd-a and shift-arrow change state the user cannot see.
        let selection = self.editor.selection().range();
        let (element, decorations) = self.document.render_with_selection(
            px(self.typography.body_font_size),
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
            .cursor_text()
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .text_size(px(self.typography.body_font_size))
            .when(!self.typography.prose_font_family.is_empty(), |div| {
                div.font_family(SharedString::from(
                    self.typography.prose_font_family.clone(),
                ))
            })
            .child(element);
        // The action handlers live on this wrapper: `InputSurface` is a plain
        // element and only registers input, it does not dispatch actions.
        let surface = div()
            .id("typeset-view")
            .cursor_text()
            .track_focus(&self.focus)
            .key_context(
                if inkpoint_editor_typeset::navigate_table(
                    self.editor.source(),
                    self.editor.selection().range(),
                    false,
                )
                .is_some()
                {
                    "TypesetView table_cell"
                } else if self.editor.is_in_list() {
                    "TypesetView list_item"
                } else if !self.editor.selection().is_collapsed() {
                    "TypesetView has_selection"
                } else {
                    KEY_CONTEXT
                },
            )
            .w_full()
            .flex_1()
            .min_h_0()
            .on_action(on_table_next)
            .on_action(on_table_previous)
            .on_action(on_indent)
            .on_action(on_outdent)
            .on_action(on_indent_general)
            .on_action(on_outdent_general)
            .on_action(on_soft_break)
            .on_action(on_heading_0)
            .on_action(on_heading_1)
            .on_action(on_heading_2)
            .on_action(on_heading_3)
            .on_action(on_heading_4)
            .on_action(on_heading_5)
            .on_action(on_heading_6)
            .on_action(on_toggle_quote)
            .on_action(on_toggle_bullet)
            .on_action(on_toggle_ordered)
            .on_action(on_toggle_task)
            .on_action(on_close_find)
            .on_action(on_find)
            .on_action(on_format_bold)
            .on_action(on_format_italic)
            .on_action(on_format_code)
            .on_action(on_format_strike)
            .on_action(on_left)
            .on_action(on_select_left)
            .on_action(on_right)
            .on_action(on_select_right)
            .on_action(on_up)
            .on_action(on_select_up)
            .on_action(on_down)
            .on_action(on_select_down)
            .on_action(on_word_left)
            .on_action(on_select_word_left)
            .on_action(on_word_right)
            .on_action(on_select_word_right)
            .on_action(on_delete_word_backward)
            .on_action(on_delete_word_forward)
            .on_action(on_delete_line_start)
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
            .on_action(on_select_line_start)
            .on_action(on_line_end)
            .on_action(on_select_line_end)
            .on_action(on_doc_start)
            .on_action(on_select_doc_start)
            .on_action(on_doc_end)
            .on_action(on_select_doc_end)
            .on_mouse_down(
                gpui_kit::MouseButton::Left,
                cx.listener(|this, event: &gpui_kit::MouseDownEvent, window, cx| {
                    this.handle_mouse_down(event, window, cx);
                }),
            )
            .on_mouse_move(
                cx.listener(|this, event: &gpui_kit::MouseMoveEvent, _, cx| {
                    // Only while a button is held: a bare hover must not move the
                    // caret.
                    if event.pressed_button != Some(gpui_kit::MouseButton::Left) {
                        return;
                    }
                    this.extend_drag_to(event.position, cx);
                }),
            )
            .on_mouse_up(
                gpui_kit::MouseButton::Left,
                cx.listener(|this, _: &gpui_kit::MouseUpEvent, _, cx| {
                    this.drag_anchor = None;
                    this.drag_start_point = None;
                    this.drag_mode = DragMode::Char;
                    cx.notify();
                }),
            )
            .child(scrollable)
            .into_any_element();
        let input_surface = InputSurface {
            view: cx.entity(),
            focus: self.focus.clone(),
            child: surface,
            caret_color: gpui_kit::component::theme::Theme::global(cx).foreground,
            decorations,
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .when(self.find.open, |div| div.child(self.find_bar(cx)))
            .child(input_surface)
    }
}

impl TypesetView {
    /// The selection as byte offsets, for the host's snapshot protocol.
    pub fn selected_range(&self) -> Range<usize> {
        self.editor.selection().range()
    }

    /// Sets the selection range in byte offsets.
    pub fn set_selected_range(&mut self, range: Range<usize>, cx: &mut Context<Self>) {
        self.goal_x = None;
        let len = self.markdown().len();
        let start = range.start.min(len);
        let end = range.end.min(len);
        self.editor.set_selection(start, end);
        cx.notify();
    }

    /// The leaf key the caret is in, when the last frame laid it out.
    pub fn caret_leaf(&self) -> Option<u64> {
        self.caret_leaf
    }
}

/// An image clipboard payload for the host to persist and insert.
#[derive(Clone, Debug)]
pub struct ImagePaste {
    pub image: gpui_kit::Image,
    pub target: PasteTarget,
}

impl gpui_kit::EventEmitter<ImagePaste> for TypesetView {}

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
    /// Handles mouse-down events, supporting single click, double-click (word),
    /// triple-click (line), shift-click (range extension), and task checkbox toggle.
    fn handle_mouse_down(
        &mut self,
        event: &gpui_kit::MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.focus.focus(window, cx);
        self.goal_x = None;
        self.drag_start_point = Some(event.position);
        let max_bottom = self
            .geometry
            .leaves()
            .map(|l| l.bounds().origin.y + l.bounds().size.height)
            .reduce(Pixels::max);
        let offset = if let Some(bottom) = max_bottom {
            if event.position.y > bottom + px(8.0) {
                Some(self.markdown().len())
            } else {
                self.source_offset_for_point(event.position)
            }
        } else {
            self.source_offset_for_point(event.position)
        };
        let Some(offset) = offset.or_else(|| {
            Some(if self.markdown().is_empty() {
                0
            } else {
                self.markdown().len()
            })
        }) else {
            return;
        };

        if let Ok(true) = self.editor.toggle_task_checkbox(offset) {
            self.apply(Ok(()), cx);
            return;
        }

        if event.modifiers.shift {
            let anchor = self.editor.selection().anchor();
            self.editor.set_selection(anchor, offset);
            self.drag_anchor = Some(anchor);
            self.drag_mode = DragMode::Char;
        } else if event.click_count == 2 {
            let range = inkpoint_editor_typeset::word_range_at(self.markdown(), offset);
            self.editor.set_selection(range.start, range.end);
            self.drag_anchor = Some(range.start);
            self.drag_mode = DragMode::Word(range);
        } else if event.click_count >= 3 {
            let range = inkpoint_editor_typeset::line_range_at(self.markdown(), offset);
            self.editor.set_selection(range.start, range.end);
            self.drag_anchor = Some(range.start);
            self.drag_mode = DragMode::Line(range);
        } else {
            self.editor.set_caret(offset);
            self.drag_anchor = Some(offset);
            self.drag_mode = DragMode::Char;
        }
        self.scroll_caret_into_view();
        cx.notify();
    }

    /// Places the caret where the user clicked, used directly by tests.
    #[cfg(test)]
    pub(crate) fn place_caret_from_click(
        &mut self,
        point: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.focus.focus(window, cx);
        self.goal_x = None;
        let Some(offset) = self.source_offset_for_point(point) else {
            return;
        };
        if let Ok(true) = self.editor.toggle_task_checkbox(offset) {
            self.apply(Ok(()), cx);
            return;
        }
        self.editor.set_caret(offset);
        self.scroll_caret_into_view();
        cx.notify();
    }

    /// Extend from the original mouse-down anchor without collapsing the range.
    fn extend_drag_to(&mut self, point: Point<Pixels>, cx: &mut Context<Self>) {
        self.goal_x = None;
        let Some(anchor) = self.drag_anchor else {
            return;
        };
        if let Some(start_point) = self.drag_start_point {
            let dx = (point.x - start_point.x).as_f32();
            let dy = (point.y - start_point.y).as_f32();
            if (dx * dx + dy * dy).sqrt() < 3.0 {
                return;
            }
        }
        let Some(key) = self.caret_leaf_from_point(point) else {
            return;
        };
        let Some(leaf) = self.geometry.get(key) else {
            return;
        };
        let local = leaf.index_for_position(point).min(leaf.len());
        let Some(head) = self.document.source_offset(key, local) else {
            return;
        };
        match self.drag_mode {
            DragMode::Word(ref initial_word) => {
                let cur_word = inkpoint_editor_typeset::word_range_at(self.markdown(), head);
                let (sel_anchor, sel_head) = if head >= initial_word.start {
                    (initial_word.start, cur_word.end)
                } else {
                    (initial_word.end, cur_word.start)
                };
                self.editor.set_selection(sel_anchor, sel_head);
            }
            DragMode::Line(ref initial_line) => {
                let cur_line = inkpoint_editor_typeset::line_range_at(self.markdown(), head);
                let (sel_anchor, sel_head) = if head >= initial_line.start {
                    (initial_line.start, cur_line.end)
                } else {
                    (initial_line.end, cur_line.start)
                };
                self.editor.set_selection(sel_anchor, sel_head);
            }
            DragMode::Char => {
                let (sel_anchor, sel_head) = if head > anchor {
                    (
                        anchor,
                        self.document
                            .source_offset_before(key, local)
                            .unwrap_or(head),
                    )
                } else if head < anchor {
                    let trailing = self
                        .document
                        .leaf_at(anchor)
                        .and_then(|key| {
                            let local = self.document.rendered_offset(key, anchor)?;
                            self.document.source_offset_before(key, local)
                        })
                        .unwrap_or(anchor);
                    (trailing, head)
                } else {
                    (anchor, head)
                };
                self.editor.set_selection(sel_anchor, sel_head);
            }
        }
        self.scroll_offset_into_view(head);
        cx.notify();
    }

    fn source_offset_for_point(&self, point: Point<Pixels>) -> Option<usize> {
        let key = self.caret_leaf_from_point(point)?;
        let leaf = self.geometry.get(key)?;
        self.document
            .source_offset(key, leaf.index_for_position(point).min(leaf.len()))
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
        let local = self
            .document
            .rendered_offset(key, self.editor.selection().head())
            .unwrap_or(0);
        let position = leaf.position_for_index(local.min(leaf.len()));
        Some(Bounds {
            origin: position,
            size: gpui_kit::size(px(2.), leaf.caret_height()),
        })
    }

    /// The leaf whose bounds contain `point`, else the nearest one.
    fn caret_leaf_from_point(&self, point: Point<Pixels>) -> Option<u64> {
        self.geometry
            .caret_and_key_for_point(point)
            .map(|(key, _)| key)
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
        if self.marked.is_some() {
            self.last_error = Some("Finish the current text composition before formatting.".into());
            cx.notify();
            return;
        }
        let result = match command {
            inkpoint_editor_typeset::EditorCommand::ToggleBold => self
                .editor
                .toggle_inline_mark(inkpoint_editor_core::InlineFormat::Bold),
            inkpoint_editor_typeset::EditorCommand::ToggleItalic => self
                .editor
                .toggle_inline_mark(inkpoint_editor_core::InlineFormat::Italic),
            inkpoint_editor_typeset::EditorCommand::ToggleInlineCode => self
                .editor
                .toggle_inline_mark(inkpoint_editor_core::InlineFormat::Code),
            inkpoint_editor_typeset::EditorCommand::ToggleStrikethrough => self
                .editor
                .toggle_inline_mark(inkpoint_editor_core::InlineFormat::Strikethrough),
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

    #[gpui_kit::test]
    fn format_shortcuts_toggle_selected_text(cx: &mut TestAppContext) {
        let os = cx.update(|cx| cx.platform_info().os);
        let (view, vcx) = open(cx, "中文");
        for (format, key) in crate::format_shortcuts(os) {
            vcx.update(|_, cx| {
                view.update(cx, |view, _| view.editor.set_selection(0, "中文".len()))
            });
            vcx.simulate_keystrokes(&key);
            let delimiter = match format {
                crate::InlineFormat::Bold => "**",
                crate::InlineFormat::Italic => "*",
                crate::InlineFormat::Code => "`",
                crate::InlineFormat::Strikethrough => "~~",
            };
            assert_eq!(markdown(&view, vcx), format!("{delimiter}中文{delimiter}"));
            vcx.simulate_keystrokes(&key);
            assert_eq!(markdown(&view, vcx), "中文");
        }
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

    #[gpui_kit::test]
    fn shift_arrows_extend_selection(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) =
            cx.add_window_view(|window, cx| TypesetView::new(window, cx, "hello world"));
        for _ in 0..2 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| {
                    view.focus(window, cx);
                    view.set_caret(0, cx);
                });
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        vcx.simulate_keystrokes("shift-right");
        assert_eq!(
            view.read_with(&*vcx, |view, _| view.selected_range()),
            0..1,
            "shift-right selects one char"
        );
        vcx.simulate_keystrokes("shift-right");
        assert_eq!(
            view.read_with(&*vcx, |view, _| view.selected_range()),
            0..2,
            "shift-right extends selection"
        );
    }

    #[gpui_kit::test]
    fn word_navigation_and_deletion(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) =
            cx.add_window_view(|window, cx| TypesetView::new(window, cx, "hello world"));
        for _ in 0..2 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| {
                    view.focus(window, cx);
                    view.set_caret(11, cx);
                });
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        vcx.update(|_, cx| {
            view.update(cx, |view, cx| {
                view.delete_word_backward(cx);
            });
        });
        assert_eq!(markdown(&view, vcx), "hello ");
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

    #[gpui_kit::test]
    fn formatting_waits_for_composition_to_finish(cx: &mut TestAppContext) {
        let (view, vcx) = open(cx, "");
        vcx.update(|window, cx| {
            view.update(cx, |view, cx| {
                view.replace_and_mark_text_in_range(None, "中", None, window, cx);
                view.execute_command(
                    inkpoint_editor_typeset::EditorCommand::ToggleBold,
                    window,
                    cx,
                );
                assert_eq!(view.editor.source(), "中");
                assert!(view.marked.is_some());
                view.finish_composition();
                view.execute_command(
                    inkpoint_editor_typeset::EditorCommand::ToggleBold,
                    window,
                    cx,
                );
                assert_eq!(view.editor.source(), "中****");
            });
        });
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

    #[gpui_kit::test]
    fn implicit_ime_updates_and_commit_replace_the_marked_text(cx: &mut TestAppContext) {
        let (view, vcx) = open(cx, "😀后");
        vcx.update(|window, cx| {
            view.update(cx, |view, cx| {
                view.editor.set_caret("😀".len());
                view.replace_and_mark_text_in_range(None, "z", Some(1..1), window, cx);
                view.replace_and_mark_text_in_range(None, "zhong", Some(5..5), window, cx);
                assert_eq!(view.markdown(), "😀zhong后");
                assert_eq!(view.marked_text_range(window, cx), Some(2..7));

                view.replace_text_in_range(None, "中", window, cx);
                assert_eq!(view.markdown(), "😀中后");
                assert!(!view.composing());
                assert_eq!(view.editor.selection().range(), "😀中".len().."😀中".len());

                view.replace_text_in_range(None, "!", window, cx);
                assert_eq!(view.markdown(), "😀中!后");
                view.undo(cx);
                assert_eq!(view.markdown(), "😀中后");
                view.undo(cx);
                assert_eq!(view.markdown(), "😀后");
            });
        });
    }

    #[gpui_kit::test]
    fn clearing_the_preedit_does_not_leave_a_marked_range(cx: &mut TestAppContext) {
        let (view, vcx) = open(cx, "后");
        vcx.update(|window, cx| {
            view.update(cx, |view, cx| {
                view.replace_and_mark_text_in_range(None, "zhong", Some(5..5), window, cx);
                view.replace_and_mark_text_in_range(None, "", Some(0..0), window, cx);
                assert_eq!(view.markdown(), "后");
                assert_eq!(view.marked_text_range(window, cx), None);
                assert!(!view.composing());
            });
        });
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

#[cfg(test)]
mod ime_geometry_tests {
    use super::*;
    use gpui_kit::TestAppContext;

    #[gpui_kit::test]
    fn dragging_preserves_anchor_and_replaces_the_selected_text(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        let (view, vcx) =
            cx.add_window_view(|window, cx| TypesetView::new(window, cx, "first\n\nsecond\n"));
        vcx.update(|window, cx| {
            window.draw(cx).clear(cx);
            view.update(cx, |view, cx| {
                let first = view.document.leaf_key(0).unwrap();
                let second = view.document.leaf_key(1).unwrap();
                let point = |key, index| {
                    let leaf = view.geometry.get(key).unwrap();
                    let position = leaf.position_for_index(index);
                    gpui_kit::point(position.x, position.y + leaf.caret_height() / 2.)
                };
                let start = point(first, 1);
                let end = point(second, 3);
                view.place_caret_from_click(start, window, cx);
                let anchor = view.editor.selection().head();
                view.drag_anchor = Some(anchor);
                view.extend_drag_to(end, cx);
                let head = view.editor.selection().head();
                assert!(head > anchor);
                assert_eq!(view.editor.selection().anchor(), anchor);
                view.editor.insert("X").unwrap();
                view.editor.undo();
                assert_eq!(view.editor.source(), "first\n\nsecond\n");
                assert_eq!(view.editor.selection().anchor(), anchor);
                assert_eq!(view.editor.selection().head(), head);
                view.drag_anchor = Some(head);
                view.extend_drag_to(start, cx);
                assert_eq!(view.editor.selection().anchor(), head);
                assert_eq!(view.editor.selection().head(), anchor);
            });
        });
    }

    #[gpui_kit::test]
    fn dragging_formatted_text_preserves_delimiters_in_both_directions(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        let (view, vcx) =
            cx.add_window_view(|window, cx| TypesetView::new(window, cx, "**中文** tail"));
        vcx.update(|window, cx| {
            window.draw(cx).clear(cx);
            view.update(cx, |view, cx| {
                let key = view.document.leaf_key(0).unwrap();
                let leaf = view.geometry.get(key).unwrap();
                let point = |index| {
                    let position = leaf.position_for_index(index);
                    gpui_kit::point(position.x, position.y + leaf.caret_height() / 2.)
                };
                let start = point(0);
                let end = point("中文".len());
                for (from, to) in [(start, end), (end, start)] {
                    view.place_caret_from_click(from, window, cx);
                    view.drag_anchor = Some(view.editor.selection().head());
                    view.extend_drag_to(to, cx);
                    assert_eq!(view.editor.selection().range(), 2..8);
                    view.editor.insert("X").unwrap();
                    assert_eq!(view.editor.source(), "**X** tail");
                    view.editor.undo();
                }
            });
        });
    }

    /// The IME needs a rectangle to anchor its candidate window.
    ///
    /// `bounds_for_range` returns None without geometry, which leaves the
    /// candidate window unanchored — the visible symptom of the geometry bug that
    /// made typing work while composition placement did not.
    #[gpui_kit::test]
    fn bounds_for_range_returns_a_rectangle(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) =
            cx.add_window_view(|window, cx| TypesetView::new(window, cx, "first\n\nsecond\n"));
        for _ in 0..3 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| view.focus(window, cx));
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        let bounds = vcx.update(|window, cx| {
            view.update(cx, |view, cx| {
                view.bounds_for_range(0..1, gpui_kit::Bounds::default(), window, cx)
            })
        });
        assert!(
            bounds.is_some(),
            "the IME must get a rectangle for the composing range"
        );
    }

    /// Clicking must report a document offset the IME can use.
    #[gpui_kit::test]
    fn character_index_for_point_resolves_through_the_clicked_leaf(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) =
            cx.add_window_view(|window, cx| TypesetView::new(window, cx, "first\n\nsecond\n"));
        for _ in 0..3 {
            vcx.update(|window, cx| {
                view.update(cx, |view, cx| view.focus(window, cx));
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        // A point inside the second block must resolve past the first block's
        // text, which is only possible with geometry.
        let point = view.read_with(&*vcx, |view, _| {
            view.geometry
                .entries()
                .map(|(_, leaf)| leaf.bounds())
                .find(|bounds| bounds.origin.y > gpui_kit::px(0.))
                .map(|bounds| {
                    gpui_kit::point(
                        bounds.origin.x + gpui_kit::px(2.),
                        bounds.origin.y + bounds.size.height / 2.,
                    )
                })
        });
        let Some(point) = point else {
            panic!("the second block must lay out");
        };
        let index = vcx.update(|window, cx| {
            view.update(cx, |view, cx| {
                view.character_index_for_point(point, window, cx)
            })
        });
        assert!(
            index.is_some_and(|index| index > 0),
            "a click in the second block must resolve past the first, got {index:?}"
        );
    }

    #[gpui_kit::test]
    fn ime_anchor_and_hit_test_follow_scrolled_text(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        let source: String = (0..60)
            .map(|index| format!("第{index}段中文\n\n"))
            .collect();
        let target = source.find("第8段中文").expect("test paragraph");
        let index = utf16_offset(&source, target);
        let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, &source));
        let range_bounds = |view: &mut TypesetView, window: &mut Window, cx: &mut Context<_>| {
            view.bounds_for_range(index..index, Bounds::default(), window, cx)
                .expect("IME anchor is laid out")
        };
        vcx.update(|window, cx| {
            window.draw(cx).clear(cx);
            let before = view.update(cx, |view, cx| {
                let bounds = range_bounds(view, window, cx);
                view.scroll.set_offset(gpui_kit::point(px(0.), px(-96.)));
                cx.notify();
                bounds
            });
            window.draw(cx).clear(cx);
            view.update(cx, |view, cx| {
                let after = range_bounds(view, window, cx);
                assert_eq!(after.origin.y, before.origin.y - px(96.));
                let point =
                    gpui_kit::point(after.origin.x, after.origin.y + after.size.height / 2.);
                assert_eq!(
                    view.character_index_for_point(point, window, cx),
                    Some(index)
                );
            });
        });
    }
}

#[cfg(test)]
#[path = "../tests/support/typography_view.rs"]
mod typography_view_tests;
