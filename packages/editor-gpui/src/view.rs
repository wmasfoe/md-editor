//! Native Markdown editing backed by GPUI's multiline text engine.

use std::ops::Range;
use std::rc::Rc;

use gpui_kit::base::text::TextView;
use gpui_kit::component::{
    ActiveTheme, Sizable,
    button::Button,
    input::{Editor as NativeEditor, EditorState, InputEvent},
};
use gpui_kit::{
    Action, App, ClipboardItem, Context, Entity, EntityInputHandler, FocusHandle, IntoElement,
    Render, Subscription, Window, div, prelude::*,
};
use inkpoint_editor_core::{BlockKind, MarkdownDocument, SourceBlock};

/// Inline Markdown formats available in the source editor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InlineFormat {
    Bold,
    Italic,
    Strikethrough,
    Code,
}

/// Block formats available in the source editor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockFormat {
    Heading(u8),
    Quote,
    UnorderedList,
    OrderedList,
    TaskList,
}

/// Editor commands shared by the desktop menus and the Playground controls.
#[derive(Action, Clone, Copy, Debug, PartialEq, Eq)]
#[action(namespace = inkpoint_editor, no_json)]
pub enum EditorCommand {
    ShowSource,
    ShowBlockEditor,
    ShowSplitPreview,
    ToggleSourceMode,
    ToggleOutline,
    FormatInline(InlineFormat),
    FormatBlock(BlockFormat),
}

/// Source snapshot attached to a host-handled clipboard paste.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PasteContext {
    pub revision: u64,
    pub selection: Range<usize>,
}

/// Host adapter for non-text clipboard payloads such as images. Returning
/// `true` consumes the event; `false` lets GPUI insert clipboard text.
pub type PasteHandler =
    Rc<dyn Fn(&ClipboardItem, PasteContext, &mut Window, &mut App) -> bool + 'static>;

/// Owns the native editor state and exposes Markdown-oriented operations.
pub struct EditorView {
    state: Entity<EditorState>,
    preview_focus: FocusHandle,
    revision: u64,
    readonly: bool,
    rich_edit: Option<RichBlockEdit>,
    preview_mode: PreviewMode,
    show_toolbar: bool,
    outline_open: bool,
    source_selection: Range<usize>,
    blocks_cache: Vec<SourceBlock>,
    blocks_revision: Option<u64>,
    paste_handler: Option<PasteHandler>,
    _subscription: Subscription,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PreviewMode {
    Source,
    Preview,
    Split,
}

struct RichBlockEdit {
    state: Entity<EditorState>,
    _subscription: Subscription,
    revision: u64,
    range: Range<usize>,
    original_source: String,
}

struct OutlineEntry {
    label: String,
    range: Range<usize>,
    level: u8,
}

impl EditorView {
    pub fn new(window: &mut Window, cx: &mut Context<Self>, markdown: &str) -> Self {
        let state = cx.new(|cx| {
            EditorState::new(window, cx)
                .default_value(markdown)
                .searchable(true)
                .language("markdown")
        });
        state.update(cx, |state, cx| state.focus(window, cx));
        let subscription = cx.subscribe(&state, |view, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                view.revision = view.revision.wrapping_add(1);
                cx.notify();
            }
        });

        Self {
            state,
            preview_focus: cx.focus_handle(),
            revision: 0,
            readonly: false,
            rich_edit: None,
            preview_mode: PreviewMode::Source,
            show_toolbar: true,
            outline_open: false,
            source_selection: 0..0,
            blocks_cache: Vec::new(),
            blocks_revision: None,
            paste_handler: None,
            _subscription: subscription,
        }
    }

    /// Let a host that provides its own command surface omit the editor toolbar.
    pub fn without_toolbar(mut self) -> Self {
        self.show_toolbar = false;
        self
    }

    fn source(&self) -> impl IntoElement {
        let editor = NativeEditor::new(&self.state)
            .h_full()
            .aria_label("Markdown source editor");
        if let Some(handler) = &self.paste_handler {
            let handler = handler.clone();
            let state = self.state.clone();
            let revision = self.revision;
            editor.on_paste(move |item, window, cx| {
                // Do not hand an image/file to host code while the native input
                // still owns an IME marked-text range.
                if state.update(cx, |editor, cx| {
                    editor.marked_text_range(window, cx).is_some()
                }) {
                    return true;
                }
                handler(
                    item,
                    PasteContext {
                        revision,
                        selection: state.read(cx).selected_range(),
                    },
                    window,
                    cx,
                )
            })
        } else {
            editor
        }
    }

    pub fn markdown(&self, cx: &App) -> String {
        self.state.read(cx).value().to_string()
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn selected_range(&self, cx: &App) -> Range<usize> {
        self.state.read(cx).selected_range()
    }

    pub fn focus(&self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(edit) = &self.rich_edit {
            edit.state.update(cx, |state, cx| state.focus(window, cx));
        } else if self.preview_mode == PreviewMode::Preview {
            self.preview_focus.focus(window, cx);
        } else {
            self.state.update(cx, |state, cx| state.focus(window, cx));
        }
    }

    pub fn seek_line(&self, line: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.state.update(cx, |state, cx| {
            let value = state.value();
            let start = line
                .checked_sub(2)
                .and_then(|index| value.match_indices('\n').nth(index))
                .map_or(0, |(offset, _)| offset + 1);
            state.set_selected_range(start..start, cx);
        });
        self.state.update(cx, |state, cx| state.focus(window, cx));
    }

    fn jump_to_range(&mut self, range: Range<usize>, window: &mut Window, cx: &mut Context<Self>) {
        if self.rich_edit.is_some() && self.commit_rich_block_edit(window, cx).is_err() {
            return;
        }
        self.preview_mode = PreviewMode::Source;
        self.source_selection = range.clone();
        self.state.update(cx, |state, cx| {
            state.set_selected_range(range, cx);
            state.focus(window, cx);
        });
        cx.notify();
    }

    pub fn replace_markdown(
        &mut self,
        markdown: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        // A new state also resets GPUI's native undo stack so history from a
        // previous file cannot be replayed into the newly opened document.
        let state = cx.new(|cx| {
            EditorState::new(window, cx)
                .default_value(markdown)
                .searchable(true)
                .language("markdown")
        });
        let subscription = cx.subscribe(&state, |view, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                view.revision = view.revision.wrapping_add(1);
                cx.notify();
            }
        });
        if self.readonly {
            state.update(cx, |state, cx| state.set_readonly(true, cx));
        }
        self.state = state;
        self._subscription = subscription;
        self.rich_edit = None;
        self.source_selection = 0..0;
        self.blocks_cache.clear();
        self.blocks_revision = None;
        self.revision = self.revision.wrapping_add(1);
        self.focus(window, cx);
        cx.notify();
    }

    pub fn set_readonly(&mut self, readonly: bool, cx: &mut Context<Self>) {
        self.readonly = readonly;
        self.state
            .update(cx, |state, cx| state.set_readonly(readonly, cx));
        if let Some(edit) = &self.rich_edit {
            edit.state
                .update(cx, |state, cx| state.set_readonly(readonly, cx));
        }
        cx.notify();
    }

    /// Install a host adapter for image or file clipboard payloads.
    pub fn set_paste_handler(&mut self, handler: Option<PasteHandler>, cx: &mut Context<Self>) {
        self.paste_handler = handler;
        cx.notify();
    }

    pub fn has_pending_rich_edit(&self) -> bool {
        self.rich_edit.is_some()
    }

    pub fn has_unsaved_rich_changes(&self, cx: &App) -> bool {
        self.rich_edit
            .as_ref()
            .is_some_and(|edit| edit.state.read(cx).value().as_ref() != edit.original_source)
    }

    pub fn commit_pending_rich_edit(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<(), &'static str> {
        self.commit_rich_block_edit(window, cx)
    }

    pub fn discard_pending_rich_edit(&mut self, cx: &mut Context<Self>) {
        self.cancel_rich_block_edit(cx);
    }

    pub fn execute_command(
        &mut self,
        command: EditorCommand,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let mode = match command {
            EditorCommand::ShowSource => PreviewMode::Source,
            EditorCommand::ShowBlockEditor => PreviewMode::Preview,
            EditorCommand::ShowSplitPreview => PreviewMode::Split,
            EditorCommand::ToggleSourceMode if self.preview_mode == PreviewMode::Source => {
                PreviewMode::Preview
            }
            EditorCommand::ToggleSourceMode => PreviewMode::Source,
            EditorCommand::ToggleOutline => {
                self.outline_open = !self.outline_open;
                cx.notify();
                return;
            }
            EditorCommand::FormatInline(format) => return self.format_inline(format, window, cx),
            EditorCommand::FormatBlock(format) => return self.format_block(format, window, cx),
        };
        self.set_preview_mode(mode, window, cx);
    }

    fn set_preview_mode(&mut self, mode: PreviewMode, window: &mut Window, cx: &mut Context<Self>) {
        if mode == self.preview_mode {
            self.focus(window, cx);
            return;
        }
        let leaving_preview = self.preview_mode == PreviewMode::Preview;
        if mode == PreviewMode::Preview {
            if self.source_has_marked_text(window, cx) {
                return;
            }
            self.source_selection = self.state.read(cx).selected_range();
        }
        if leaving_preview && self.commit_rich_block_edit(window, cx).is_err() {
            return;
        }
        self.preview_mode = mode;
        if leaving_preview {
            let length = self.state.read(cx).value().len();
            let start = self.source_selection.start.min(length);
            let end = self.source_selection.end.min(length).max(start);
            self.state
                .update(cx, |state, cx| state.set_selected_range(start..end, cx));
        }
        self.focus(window, cx);
        cx.notify();
    }

    fn begin_rich_block_edit(
        &mut self,
        range: Range<usize>,
        source: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.readonly {
            return;
        }
        let state = cx.new(|cx| {
            EditorState::new(window, cx)
                .default_value(&source)
                .searchable(true)
                .language("markdown")
        });
        state.update(cx, |state, cx| state.focus(window, cx));
        let subscription = cx.subscribe(&state, |_, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                cx.notify();
            }
        });
        self.source_selection = range.clone();
        self.rich_edit = Some(RichBlockEdit {
            state,
            _subscription: subscription,
            revision: self.revision,
            range,
            original_source: source,
        });
        cx.notify();
    }

    fn commit_rich_block_edit(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<(), &'static str> {
        let Some(edit) = self.rich_edit.take() else {
            return Ok(());
        };
        if self.readonly {
            self.rich_edit = Some(edit);
            return Err("The editor is read-only.");
        }
        if edit.state.update(cx, |state, cx| {
            state.marked_text_range(window, cx).is_some()
        }) {
            self.rich_edit = Some(edit);
            return Err("Finish the current text composition before applying the block edit.");
        }
        let replacement = edit.state.read(cx).value().to_string();
        if replacement == edit.original_source {
            cx.notify();
            return Ok(());
        }
        match self.replace_range_if_unchanged(
            edit.revision,
            edit.range.clone(),
            &edit.original_source,
            &replacement,
            window,
            cx,
        ) {
            Ok(_) => {
                cx.notify();
                Ok(())
            }
            Err(_) => {
                self.rich_edit = Some(edit);
                cx.notify();
                Err("The source block changed. Reopen it before applying the draft.")
            }
        }
    }

    fn cancel_rich_block_edit(&mut self, cx: &mut Context<Self>) {
        self.rich_edit = None;
        cx.notify();
    }

    /// Apply an AI result only when both document revision and source range match.
    pub fn insert_if_unchanged(
        &mut self,
        expected_revision: u64,
        expected_range: Range<usize>,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<u64, &'static str> {
        if self.readonly {
            return Err("The editor is read-only.");
        }
        if self.revision != expected_revision
            || self.state.read(cx).selected_range() != expected_range
        {
            return Err("The document or selection changed while AI was responding.");
        }

        self.state.update(cx, |state, cx| {
            state.replace(text, window, cx);
        });
        Ok(self.revision)
    }

    /// Insert a host-produced Markdown image reference at its original paste
    /// target only if the document, selection, and IME composition still match.
    pub fn insert_image_if_unchanged(
        &mut self,
        target: &PasteContext,
        reference: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<(), &'static str> {
        if self.state.update(cx, |state, cx| {
            state.marked_text_range(window, cx).is_some()
        }) {
            return Err("Finish the current text composition before inserting an image.");
        }
        if self.rich_edit.is_some() {
            return Err("Finish the active rich-text edit before inserting an image.");
        }
        if !reference.starts_with("./assets/")
            || !reference.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'/' | b'_' | b'-')
            })
        {
            return Err("The image path is not a safe relative assets path.");
        }
        let markdown = format!("![image]({reference})");
        self.insert_if_unchanged(
            target.revision,
            target.selection.clone(),
            &markdown,
            window,
            cx,
        )?;
        Ok(())
    }

    /// Replace a source range only if its snapshot still matches the document.
    pub fn replace_range_if_unchanged(
        &mut self,
        expected_revision: u64,
        expected_range: Range<usize>,
        expected_source: &str,
        replacement: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<u64, &'static str> {
        if self.readonly {
            return Err("The editor is read-only.");
        }
        let current = self.state.read(cx).value();
        if self.revision != expected_revision
            || current.get(expected_range.clone()) != Some(expected_source)
        {
            return Err("The document changed while this block was being edited.");
        }

        let cursor = expected_range.start + replacement.len();
        self.state.update(cx, |state, cx| {
            state.set_selected_range(expected_range, cx);
            state.replace(replacement, window, cx);
            state.set_selected_range(cursor..cursor, cx);
        });
        self.source_selection = cursor..cursor;
        Ok(self.revision)
    }

    fn source_has_marked_text(&self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        self.state.update(cx, |state, cx| {
            state.marked_text_range(window, cx).is_some()
        })
    }

    fn can_format(&self) -> bool {
        !self.readonly && self.preview_mode != PreviewMode::Preview
    }

    fn format_inline(&mut self, format: InlineFormat, window: &mut Window, cx: &mut Context<Self>) {
        if !self.can_format() || self.source_has_marked_text(window, cx) {
            return;
        }
        let (prefix, suffix) = match format {
            InlineFormat::Bold => ("**", "**"),
            InlineFormat::Italic => ("*", "*"),
            InlineFormat::Strikethrough => ("~~", "~~"),
            InlineFormat::Code => ("`", "`"),
        };
        self.state.update(cx, |state, cx| {
            let range = state.selected_range();
            let document = MarkdownDocument::new(state.value().to_string());
            let Ok(edit) = document.wrap_selection(range, prefix, suffix) else {
                return;
            };
            let selection_after = edit.selection_after.clone();
            state.set_selected_range(edit.range, cx);
            state.replace(edit.replacement, window, cx);
            state.set_selected_range(selection_after, cx);
        });
    }

    fn format_block(&mut self, format: BlockFormat, window: &mut Window, cx: &mut Context<Self>) {
        if !self.can_format() || self.source_has_marked_text(window, cx) {
            return;
        }
        self.state.update(cx, |state, cx| {
            let range = state.selected_range();
            let document = MarkdownDocument::new(state.value().to_string());
            let edit = match format {
                BlockFormat::Heading(level) => document.set_heading(range, level),
                BlockFormat::Quote => document.toggle_line_prefix(range, "> "),
                BlockFormat::UnorderedList => document.toggle_line_prefix(range, "- "),
                BlockFormat::OrderedList => document.toggle_line_prefix(range, "1. "),
                BlockFormat::TaskList => document.toggle_line_prefix(range, "- [ ] "),
            };
            let Ok(edit) = edit else {
                return;
            };
            let selection_after = edit.selection_after.clone();
            state.set_selected_range(edit.range, cx);
            state.replace(edit.replacement, window, cx);
            state.set_selected_range(selection_after, cx);
        });
    }
}

impl Render for EditorView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let markdown = self.markdown(cx);
        self.ensure_blocks_cache(&markdown);
        let source = self.source().into_any_element();
        let border = cx.theme().border;
        let content = match self.preview_mode {
            PreviewMode::Source => div().flex_1().min_h_0().child(source).into_any_element(),
            PreviewMode::Preview => self.render_rich_document(&markdown, cx),
            PreviewMode::Split => div()
                .flex_1()
                .min_h_0()
                .flex()
                .child(div().flex_1().min_w_0().child(source))
                .child(
                    div()
                        .id("split-preview")
                        .flex_1()
                        .min_w_0()
                        .overflow_y_scroll()
                        .px_4()
                        .child(TextView::markdown("markdown-preview", &markdown).scrollable(true)),
                )
                .into_any_element(),
        };
        let content = if self.outline_open {
            let items = self
                .outline_entries(&markdown)
                .into_iter()
                .enumerate()
                .map(|(index, entry)| {
                    let range = entry.range;
                    Button::new(format!("outline-heading-{index}"))
                        .small()
                        .label(format!(
                            "{}{}",
                            "  ".repeat(entry.level.saturating_sub(1) as usize),
                            entry.label
                        ))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.jump_to_range(range.clone(), window, cx);
                        }))
                        .into_any_element()
                })
                .collect::<Vec<_>>();
            div()
                .flex()
                .flex_1()
                .min_h_0()
                .child(
                    div()
                        .id("markdown-outline")
                        .w(gpui_kit::px(220.))
                        .min_h_0()
                        .overflow_y_scroll()
                        .border_r_1()
                        .border_color(border)
                        .flex()
                        .flex_col()
                        .gap_1()
                        .p_2()
                        .children(items),
                )
                .child(div().flex_1().min_w_0().min_h_0().child(content))
                .into_any_element()
        } else {
            content
        };

        div()
            .flex()
            .flex_col()
            .size_full()
            .track_focus(&self.preview_focus)
            .children(self.show_toolbar.then(|| self.render_toolbar(cx)))
            .child(content)
    }
}

impl EditorView {
    fn render_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        use EditorCommand::*;
        let outline_label = if self.outline_open {
            "Hide outline"
        } else {
            "Outline"
        };
        let views = [
            ("source", "Source", ShowSource),
            ("rich", "Block Editor", ShowBlockEditor),
            ("split", "Split", ShowSplitPreview),
            ("outline-toggle", outline_label, ToggleOutline),
        ];
        let formats = [
            ("bold", "Bold", FormatInline(InlineFormat::Bold)),
            ("italic", "Italic", FormatInline(InlineFormat::Italic)),
            ("code", "Code", FormatInline(InlineFormat::Code)),
            (
                "strike",
                "Strike",
                FormatInline(InlineFormat::Strikethrough),
            ),
            ("heading", "H1", FormatBlock(BlockFormat::Heading(1))),
            ("quote", "Quote", FormatBlock(BlockFormat::Quote)),
            ("list", "List", FormatBlock(BlockFormat::UnorderedList)),
            ("ordered-list", "1.", FormatBlock(BlockFormat::OrderedList)),
            ("task-list", "Task", FormatBlock(BlockFormat::TaskList)),
        ];
        div()
            .flex()
            .items_center()
            .gap_1()
            .px_3()
            .py_1()
            .border_b_1()
            .border_color(cx.theme().border)
            .children(views.map(|(id, label, command)| command_button(id, label, command, cx)))
            .child(div().flex_1())
            .children(
                self.can_format()
                    .then(|| {
                        formats.map(|(id, label, command)| command_button(id, label, command, cx))
                    })
                    .into_iter()
                    .flatten(),
            )
    }

    fn ensure_blocks_cache(&mut self, markdown: &str) {
        if self.blocks_revision != Some(self.revision) {
            self.blocks_cache = MarkdownDocument::new(markdown).blocks().unwrap_or_default();
            self.blocks_revision = Some(self.revision);
        }
    }

    fn outline_entries(&self, markdown: &str) -> Vec<OutlineEntry> {
        let mut entries = Vec::new();
        collect_outline_entries(&self.blocks_cache, markdown, &mut entries);
        entries
    }

    fn render_rich_document(
        &mut self,
        markdown: &str,
        cx: &mut Context<Self>,
    ) -> gpui_kit::AnyElement {
        self.ensure_blocks_cache(markdown);
        let blocks = &self.blocks_cache;
        let mut rows = Vec::with_capacity(blocks.len());

        for (index, block) in blocks.iter().enumerate() {
            let Some(source) = markdown.get(block.range.clone()).map(str::to_string) else {
                continue;
            };
            if matches!(block.kind, BlockKind::Table) {
                rows.push(self.render_table_block(block, markdown, index, cx));
                continue;
            }
            let content_range = block.content_range.clone();
            let active_edit = self
                .rich_edit
                .as_ref()
                .filter(|edit| edit.range == content_range);
            let row = if let Some(edit) = active_edit {
                let state = edit.state.clone();
                let expired = edit.revision != self.revision;
                let mut row = div()
                    .id(format!("rich-block-{index}"))
                    .flex()
                    .flex_col()
                    .gap_2()
                    .px_3()
                    .py_2()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .child(NativeEditor::new(&state).h(gpui_kit::px(140.)));
                if expired {
                    row = row.child("This block changed elsewhere. Reopen it before saving.");
                }
                row.child(
                    div()
                        .flex()
                        .gap_2()
                        .child(Button::new("rich-save").small().label("Apply").on_click(
                            cx.listener(|this, _, window, cx| {
                                let _ = this.commit_rich_block_edit(window, cx);
                            }),
                        ))
                        .child(Button::new("rich-cancel").small().label("Cancel").on_click(
                            cx.listener(|this, _, _, cx| this.cancel_rich_block_edit(cx)),
                        )),
                )
            } else {
                let range = content_range;
                let Some(captured_source) = markdown.get(range.clone()).map(str::to_string) else {
                    continue;
                };
                div()
                    .id(format!("rich-block-{index}"))
                    .px_3()
                    .py_2()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.begin_rich_block_edit(
                            range.clone(),
                            captured_source.clone(),
                            window,
                            cx,
                        );
                    }))
                    .child(TextView::markdown(
                        format!("rich-block-content-{index}"),
                        source,
                    ))
            };
            rows.push(row.into_any_element());
        }

        if rows.is_empty() {
            let empty = self.rich_edit.as_ref();
            if let Some(edit) = empty {
                rows.push(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .px_3()
                        .py_2()
                        .child(NativeEditor::new(&edit.state).h(gpui_kit::px(140.)))
                        .child(
                            Button::new("rich-save-empty")
                                .small()
                                .label("Apply")
                                .on_click(cx.listener(|this, _, window, cx| {
                                    let _ = this.commit_rich_block_edit(window, cx);
                                })),
                        )
                        .child(
                            Button::new("rich-cancel-empty")
                                .small()
                                .label("Cancel")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.cancel_rich_block_edit(cx);
                                })),
                        )
                        .into_any_element(),
                );
            } else {
                rows.push(
                    div()
                        .id("rich-empty-document")
                        .px_3()
                        .py_2()
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.begin_rich_block_edit(0..0, String::new(), window, cx);
                        }))
                        .child("Click to add the first block")
                        .into_any_element(),
                );
            }
        }

        div()
            .id("rich-document")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .children(rows)
            .into_any_element()
    }

    fn render_table_block(
        &self,
        table: &SourceBlock,
        markdown: &str,
        block_index: usize,
        cx: &mut Context<Self>,
    ) -> gpui_kit::AnyElement {
        let mut rows = Vec::with_capacity(table.children.len());
        for (row_index, row) in table.children.iter().enumerate() {
            if !matches!(row.kind, BlockKind::TableRow) {
                continue;
            }
            let mut cells = Vec::with_capacity(row.children.len());
            for (cell_index, cell) in row.children.iter().enumerate() {
                if !matches!(cell.kind, BlockKind::TableCell) {
                    continue;
                }
                let Some(content) = markdown.get(cell.content_range.clone()) else {
                    continue;
                };
                let id = format!("rich-table-{block_index}-{row_index}-{cell_index}");
                let active = self
                    .rich_edit
                    .as_ref()
                    .filter(|edit| edit.range == cell.content_range);
                let rendered = if let Some(edit) = active {
                    let state = edit.state.clone();
                    div()
                        .id(format!("{id}-editing"))
                        .flex_1()
                        .min_w_0()
                        .px_2()
                        .py_1()
                        .border_1()
                        .border_color(cx.theme().border)
                        .child(NativeEditor::new(&state).h(gpui_kit::px(44.)))
                } else {
                    let range = cell.content_range.clone();
                    let captured = content.to_string();
                    let edit_value = captured.clone();
                    div()
                        .id(id)
                        .flex_1()
                        .min_w_0()
                        .px_2()
                        .py_1()
                        .border_1()
                        .border_color(cx.theme().border)
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.begin_rich_block_edit(
                                range.clone(),
                                edit_value.clone(),
                                window,
                                cx,
                            );
                        }))
                        .child(TextView::markdown(
                            format!("rich-table-content-{block_index}-{row_index}-{cell_index}"),
                            captured,
                        ))
                };
                cells.push(rendered.into_any_element());
            }
            rows.push(div().flex().children(cells).into_any_element());
        }

        if self
            .rich_edit
            .as_ref()
            .is_some_and(|edit| table.range.contains(&edit.range.start))
        {
            rows.push(
                div()
                    .flex()
                    .gap_2()
                    .px_2()
                    .py_1()
                    .child(
                        Button::new("rich-table-apply")
                            .small()
                            .label("Apply")
                            .on_click(cx.listener(|this, _, window, cx| {
                                let _ = this.commit_rich_block_edit(window, cx);
                            })),
                    )
                    .child(
                        Button::new("rich-table-cancel")
                            .small()
                            .label("Cancel")
                            .on_click(
                                cx.listener(|this, _, _, cx| this.cancel_rich_block_edit(cx)),
                            ),
                    )
                    .into_any_element(),
            );
        }

        div()
            .id(format!("rich-table-{block_index}"))
            .flex()
            .flex_col()
            .px_3()
            .py_2()
            .children(rows)
            .into_any_element()
    }
}

fn command_button(
    id: &'static str,
    label: &'static str,
    command: EditorCommand,
    cx: &mut Context<EditorView>,
) -> Button {
    Button::new(id)
        .small()
        .label(label)
        .on_click(cx.listener(move |this, _, window, cx| this.execute_command(command, window, cx)))
}

fn collect_outline_entries(
    blocks: &[SourceBlock],
    markdown: &str,
    entries: &mut Vec<OutlineEntry>,
) {
    for block in blocks {
        if let BlockKind::Heading { level } = block.kind
            && let Some(label) = markdown.get(block.content_range.clone())
        {
            entries.push(OutlineEntry {
                label: label.trim().to_string(),
                range: block.content_range.clone(),
                level,
            });
        }
        collect_outline_entries(&block.children, markdown, entries);
    }
}
