//! Native GPUI composition for editable Markdown blocks.
//!
//! The block renderer owns inline shaping and leaf geometry. This module owns
//! the desktop page width, typography inheritance, stable block identities, and
//! viewport-aware mounting through GPUI's variable-height list.

use std::{
    cell::Cell,
    collections::{HashMap, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
    ops::Range,
    rc::Rc,
};

use gpui_kit::base::text::editor_host::{BlockNode, FlowPosition, RenderContext};
use gpui_kit::{
    AnyElement, FontWeight, IntoElement, ListAlignment, ListOffset, ListState, Overflow,
    StyleRefinement, div, list, prelude::*, px, relative, rems,
};

/// Layout constants for the native document page.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct NativeLayoutConfig {
    /// Maximum readable measure for the document, in points.
    pub page_width: f32,
    /// Minimum gutter at either edge on a narrow window, in points.
    pub narrow_margin: f32,
    /// Body font size used to derive the body line box.
    pub body_font_size: f32,
    /// Body line height as a multiple of the body font size.
    pub line_height: f32,
    /// Literal source mode uses a line per block without prose paragraph gaps.
    pub source_mode: bool,
}

impl Default for NativeLayoutConfig {
    fn default() -> Self {
        Self {
            page_width: 720.0,
            narrow_margin: 20.0,
            body_font_size: 17.0,
            line_height: 1.65,
            source_mode: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct BlockSignature {
    kind: std::mem::Discriminant<BlockNode>,
    source: String,
    active_reveal: Option<(usize, usize)>,
}

/// Persistent native list state. It owns measured item heights across frames
/// and reparses only invalidate the block range whose rendered content changed.
pub(crate) struct NativeLayoutState {
    config: NativeLayoutConfig,
    list: ListState,
    signatures: Vec<BlockSignature>,
    blocks: Rc<Vec<BlockNode>>,
    flows: Rc<Vec<FlowPosition>>,
    ids: Rc<Vec<u64>>,
    revision: Option<u64>,
    source: String,
    reveal: Option<Range<usize>>,
    pending_reveal: Cell<Option<usize>>,
}

pub(crate) struct NativeDocumentInput<'a> {
    pub blocks: &'a [BlockNode],
    pub block_ranges: &'a [Option<Range<usize>>],
    pub source: &'a str,
    pub revision: u64,
    pub reveal: Option<Range<usize>>,
}

impl NativeLayoutState {
    pub fn new(config: NativeLayoutConfig) -> Self {
        Self {
            config,
            list: ListState::new(0, ListAlignment::Top, px(480.)),
            signatures: Vec::new(),
            blocks: Rc::new(Vec::new()),
            flows: Rc::new(Vec::new()),
            ids: Rc::new(Vec::new()),
            revision: None,
            source: String::new(),
            reveal: None,
            pending_reveal: Cell::new(None),
        }
    }

    /// The native list owns scrolling; this converts a caret/source location to
    /// a mounted block when it is currently outside the viewport.
    pub fn reveal_block(&self, block_index: usize) {
        if block_index >= self.list.item_count() {
            // A new block may be requested before the list sees the edit.
            // Apply the reveal once its source snapshot is laid out.
            self.reveal_after_layout(block_index);
            return;
        }
        if self.list.bounds_for_item(block_index).is_some() {
            self.list.scroll_to_reveal_item(block_index);
        } else {
            // A never-measured item has no height in the list's estimate yet,
            // so `scroll_to_reveal_item` cannot account for its position. Jump
            // directly by item index; the next layout pass measures this block
            // and its visible neighbors, then subsequent reveal calls can use
            // the measured heights.
            self.list.scroll_to(ListOffset {
                item_ix: block_index,
                offset_in_item: px(0.),
            });
        }
    }

    /// Defers scrolling until the new block tree is mounted.
    pub fn reveal_after_layout(&self, block_index: usize) {
        self.pending_reveal.set(Some(block_index));
    }

    /// Applies a caret reveal against the mounted block tree.
    pub fn resolve_pending_reveal(&self) -> bool {
        let Some(index) = self.pending_reveal.take() else {
            return false;
        };
        let count = self.list.item_count();
        if count == 0 {
            return false;
        }
        self.reveal_block(index.min(count - 1));
        true
    }

    /// Measured bounds for a mounted block, in window coordinates.
    pub fn block_bounds(&self, block_index: usize) -> Option<gpui_kit::Bounds<gpui_kit::Pixels>> {
        self.list.bounds_for_item(block_index)
    }

    /// Viewport bounds in window coordinates.
    pub fn viewport_bounds(&self) -> gpui_kit::Bounds<gpui_kit::Pixels> {
        self.list.viewport_bounds()
    }

    /// Scroll a measured list by document-space pixels.
    pub fn scroll_by(&self, distance: gpui_kit::Pixels) {
        self.list.scroll_by(distance);
    }

    #[cfg(test)]
    pub fn top_item_index(&self) -> usize {
        self.list.logical_scroll_top().item_ix
    }

    fn sync(
        &mut self,
        blocks: &[BlockNode],
        block_ranges: &[Option<Range<usize>>],
        source: &str,
        revision: u64,
        reveal: Option<Range<usize>>,
        config: NativeLayoutConfig,
    ) {
        let layout_changed = self.config != config;
        if self.revision == Some(revision)
            && self.source == source
            && self.reveal == reveal
            && !layout_changed
        {
            return;
        }

        let signatures = block_signatures(blocks, block_ranges, source, reveal.as_ref());
        if layout_changed {
            let scroll = self.list.logical_scroll_top();
            self.list.reset(blocks.len());
            self.list.scroll_to(ListOffset {
                item_ix: scroll.item_ix.min(blocks.len()),
                offset_in_item: scroll.offset_in_item,
            });
        } else {
            let prefix = self
                .signatures
                .iter()
                .zip(&signatures)
                .take_while(|(old, new)| old == new)
                .count();
            let suffix = self.signatures[prefix..]
                .iter()
                .rev()
                .zip(signatures[prefix..].iter().rev())
                .take_while(|(old, new)| old == new)
                .count();
            let old_end = self.signatures.len().saturating_sub(suffix);
            let new_end = signatures.len().saturating_sub(suffix);
            self.list.splice(prefix..old_end, new_end - prefix);
        }

        self.blocks = Rc::new(blocks.to_vec());
        self.flows = Rc::new(block_flows(&self.blocks));
        self.ids = Rc::new(stable_block_ids(&signatures));
        self.signatures = signatures;
        self.revision = Some(revision);
        self.source.clear();
        self.source.push_str(source);
        self.reveal = reveal;
        self.config = config;
    }
}

fn block_signatures(
    blocks: &[BlockNode],
    block_ranges: &[Option<Range<usize>>],
    source: &str,
    reveal: Option<&Range<usize>>,
) -> Vec<BlockSignature> {
    blocks
        .iter()
        .enumerate()
        .map(|(index, block)| {
            let range = block_ranges
                .get(index)
                .cloned()
                .flatten()
                .or_else(|| block.span().map(|span| span.start..span.end));
            let source = range
                .as_ref()
                .and_then(|range| source.get(range.clone()))
                .unwrap_or_default()
                .to_owned();
            let active_reveal = range.as_ref().and_then(|block| {
                let reveal = reveal?;
                let start = block.start.max(reveal.start);
                let end = block.end.min(reveal.end);
                (start <= end).then(|| (start - block.start, end - block.start))
            });
            BlockSignature {
                kind: std::mem::discriminant(block),
                source,
                active_reveal,
            }
        })
        .collect()
}

fn block_flows(blocks: &[BlockNode]) -> Vec<FlowPosition> {
    let references: Vec<&BlockNode> = blocks.iter().collect();
    (0..blocks.len())
        .map(|index| FlowPosition::at(&references, index, index + 1 == blocks.len()))
        .collect()
}

fn stable_block_ids(signatures: &[BlockSignature]) -> Vec<u64> {
    let mut occurrences = HashMap::<(std::mem::Discriminant<BlockNode>, String), usize>::new();
    signatures
        .iter()
        .map(|signature| {
            let identity = (signature.kind, signature.source.clone());
            let occurrence = occurrences.entry(identity).or_default();
            let mut hasher = DefaultHasher::new();
            signature.kind.hash(&mut hasher);
            signature.source.hash(&mut hasher);
            (*occurrence).hash(&mut hasher);
            *occurrence += 1;
            hasher.finish()
        })
        .collect()
}

/// Composes a centered native page from virtualized, variable-height GPUI blocks.
///
/// Only visible blocks plus 480pt of overdraw are mounted. Every mounted text
/// leaf is shaped by the same GPUI block renderer whose geometry the editor
/// collects, so scroll, selection, and hit testing share one layout.
pub(crate) fn render_document(
    state: &mut NativeLayoutState,
    document: NativeDocumentInput<'_>,
    context: RenderContext,
    config: NativeLayoutConfig,
) -> AnyElement {
    state.sync(
        document.blocks,
        document.block_ranges,
        document.source,
        document.revision,
        document.reveal,
        config,
    );

    let body_size = config.body_font_size;
    let base_style = if config.source_mode {
        context.style().clone().with_paragraph_gap(rems(0.))
    } else {
        context.style().clone()
    };
    let mut code_block = base_style
        .code_block()
        .clone()
        .whitespace_nowrap()
        .max_h(px(480.));
    code_block.overflow.y = Some(Overflow::Scroll);
    let table_cell = base_style.table_cell().clone().whitespace_nowrap();
    let mut table = base_style.table().clone();
    table.overflow.x = Some(Overflow::Scroll);
    let style = base_style
        .with_code_block(code_block)
        .with_table_cell(table_cell)
        .with_table(table)
        .with_heading(move |level| {
            let scale = match level {
                1 => 2.0,
                2 => 1.6,
                3 => 1.3,
                4 => 1.15,
                5 => 1.05,
                _ => 1.0,
            };
            StyleRefinement::default()
                .text_size(px(body_size * scale))
                .font_weight(FontWeight::BOLD)
        });
    let context = context
        .with_style(style)
        .with_body_font_size(px(config.body_font_size));
    let list_state = state.list.clone();
    let blocks = state.blocks.clone();
    let flows = state.flows.clone();
    let ids = state.ids.clone();
    let list_element = list(list_state, move |index, window, cx| {
        let block = &blocks[index];
        let identity = ids[index];
        let element = block.render_with_id(
            format!("native-block-{identity}"),
            flows[index],
            &context,
            window,
            cx,
        );
        match block {
            BlockNode::Table(_) => element,
            BlockNode::CodeBlock(code) => {
                // Keep the horizontal scroll extent at the longest unwrapped
                // code line while allowing shorter blocks to fill only the
                // available viewport width.
                let theme = gpui_kit::base::Theme::global(cx);
                let mono = theme.tokens.typography.mono_md;
                let mut text_style = window.text_style();
                text_style.font_family = theme.tokens.typography.mono.clone();
                text_style.font_size = mono.size.into();
                let max_line_width = code
                    .code()
                    .lines()
                    .map(|line| {
                        let run = text_style.to_run(line.len());
                        window
                            .text_system()
                            .layout_line(line, mono.size, &[run], None)
                            .width
                    })
                    .fold(px(0.), |max, width| max.max(width));
                let horizontal_insets = window.rem_size() * 2. + px(2.);
                let content_width = max_line_width + horizontal_insets;
                div()
                    .id(format!("native-wide-block-{identity}"))
                    .w_full()
                    .min_w_0()
                    .overflow_x_scroll()
                    .child(div().min_w(relative(1.)).w(content_width).child(element))
                    .into_any_element()
            }
            _ => element,
        }
    });

    let page = div()
        .w_full()
        .h_full()
        .px(px(config.narrow_margin))
        .flex()
        .justify_center()
        .child(
            div()
                .w_full()
                .h_full()
                .max_w(px(config.page_width))
                .pt(px(28.))
                .text_size(px(config.body_font_size))
                .line_height(relative(config.line_height))
                .child(list_element.size_full()),
        );
    #[cfg(target_os = "macos")]
    let page = {
        let mut page = page;
        // Use a Chinese fallback with separate regular and bold faces when the
        // primary font does not cover a glyph.
        page.text_style().font_fallbacks = Some(gpui_kit::FontFallbacks::from_fonts(vec![
            "Hiragino Sans GB".to_owned(),
        ]));
        page
    };
    page.into_any_element()
}

#[cfg(test)]
#[path = "../tests/support/native_layout.rs"]
mod tests;
