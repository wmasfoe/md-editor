//! Bridges the platform's UTF-16 input ranges to the session's UTF-8 source
//! and the marked text temporarily projected into the editor.

use std::ops::Range;

use super::TypesetView;
use gpui_kit::base::text::editor_host::Caret;
use gpui_kit::{Bounds, Context, EntityInputHandler, Pixels, Point, UTF16Selection, Window};
use inkpoint_editor_core::text::{byte_offset, utf16_offset};
use inkpoint_editor_typeset::caret_bounds_at;

fn utf8_range(source: &str, range: Range<usize>) -> Range<usize> {
    byte_offset(source, range.start)..byte_offset(source, range.end)
}

fn utf16_range(source: &str, range: Range<usize>) -> Range<usize> {
    utf16_offset(source, range.start)..utf16_offset(source, range.end)
}

impl TypesetView {
    fn refresh_preedit(&mut self, cx: &mut Context<Self>) {
        if self.composing() {
            let source = self.editor.display_source();
            self.document = super::source_mode::parse_document(
                source.as_ref(),
                self.source_mode,
                &self.diagrams,
            )
            .0;
            self.document_revision = None;
            self.scroll_offset_into_view(self.editor.display_selection().end);
        } else {
            self.reparse();
        }
        cx.notify();
    }

    /// A platform replacement is expressed in display coordinates while
    /// marked text is present. Translate it back to the committed document.
    fn composition_target(&self, range: Range<usize>) -> Range<usize> {
        let Some(target) = self.editor.composition_target() else {
            return range;
        };
        let Some(marked) = self.editor.marked_range() else {
            return target;
        };
        let map = |offset, end| {
            if offset <= marked.start {
                offset
            } else if offset >= marked.end {
                target.end + (offset - marked.end)
            } else if end {
                target.end
            } else {
                target.start
            }
        };
        map(range.start, false)..map(range.end, true)
    }

    pub(super) fn finish_composition(&mut self) {
        self.editor.commit_composition();
        self.reparse();
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
        let source = self.editor.display_source();
        let range = utf8_range(source.as_ref(), range);
        adjusted_range.replace(utf16_range(source.as_ref(), range.clone()));
        source.get(range).map(str::to_owned)
    }

    fn selected_text_range(
        &mut self,
        _ignore_disabled_input: bool,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        let source = self.editor.display_source();
        Some(UTF16Selection {
            range: utf16_range(source.as_ref(), self.editor.display_selection()),
            reversed: !self.composing() && self.editor.selection().is_reversed(),
        })
    }

    fn marked_text_range(
        &self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Range<usize>> {
        let range = self.editor.marked_range()?;
        Some(utf16_range(self.editor.display_source().as_ref(), range))
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
        if self.composing() {
            // A candidate normally replaces the full mark. Honor explicit
            // ranges too, including those that extend beyond the preedit.
            if let Some(range) = range {
                let display = self.editor.display_source();
                let range = utf8_range(display.as_ref(), range);
                let target = self.composition_target(range);
                if Some(&target) != self.editor.composition_target().as_ref() {
                    self.editor.cancel_composition();
                    self.editor.begin_composition(target);
                }
            }
            self.editor.commit_composition_with(text);
            self.reparse();
            self.scroll_caret_into_view();
            cx.notify();
        } else if let Some(range) = range {
            let target = utf8_range(self.editor.source(), range);
            let result =
                self.editor
                    .dispatch(inkpoint_editor_core::session::EditorIntent::Replace {
                        range: target,
                        text: text.to_owned(),
                    });
            self.apply(result.map(drop), cx);
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
        if self.editor.is_readonly() {
            return;
        }
        if new_text.is_empty() {
            self.editor.cancel_composition();
            self.refresh_preedit(cx);
            return;
        }
        if let Some(range) = range {
            let target =
                self.composition_target(utf8_range(self.editor.display_source().as_ref(), range));
            if Some(&target) != self.editor.composition_target().as_ref() {
                self.editor.cancel_composition();
                self.editor.begin_composition(target);
            }
        } else if !self.composing() {
            self.editor
                .begin_composition(self.editor.selection().range());
        }
        let selected = new_selected_range
            .map(|range| utf8_range(new_text, range))
            .unwrap_or(new_text.len()..new_text.len());
        self.editor.update_composition(new_text, selected);
        self.refresh_preedit(cx);
    }

    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        _element_bounds: Bounds<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let offset = byte_offset(self.editor.display_source().as_ref(), range.start);
        // The OS asks for the rectangle of the composition's text, which can
        // begin in a different leaf from the current insertion caret.
        let key = self.document.leaf_at(offset)?;
        let leaf = self.geometry.get(key)?;
        let local = self.document.rendered_offset(key, offset)?;
        Some(caret_bounds_at(leaf, Caret::new(local.min(leaf.len()))))
    }

    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        let offset = self.source_offset_for_point(point)?;
        Some(utf16_offset(self.editor.display_source().as_ref(), offset))
    }

    fn set_selected_text_range(
        &mut self,
        range: Range<usize>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.goal_x = None;
        let range = utf8_range(self.editor.display_source().as_ref(), range);
        if let Some(marked) = self.editor.marked_range() {
            let local = |offset: usize| offset.clamp(marked.start, marked.end) - marked.start;
            self.editor
                .set_composition_selection(local(range.start)..local(range.end));
        } else {
            self.editor.set_selection(range.start, range.end);
        }
        cx.notify();
    }

    fn text_length_utf16(
        &mut self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        Some(self.editor.display_source().encode_utf16().count())
    }
}
