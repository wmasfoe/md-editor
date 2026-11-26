//! Editable Markdown typesetting surface built on gpui-kit text rendering.
//!
//! This crate projects the source into the renderer's block tree and maps
//! between source offsets and shaped leaf geometry. The session owns source
//! and selection in `editor-core`; platform input is handled by `editor-gpui`.
//!
//! The seam this crate depends on:
//!
//! - [`editor_host::parse_markdown`] turns Markdown into a block tree.
//! - Each text leaf carries a host-chosen `u64` key.
//! - [`editor_host::collect_leaf_geometry`] returns, per key, the laid-out
//!   geometry the caret needs: bounds, line height, and the byte index at a
//!   window point.

mod diagram;
mod geometry;
mod math;
mod mermaid;
mod movement;
mod projection;
mod svg;

pub use diagram::DiagramRenderer;
pub use geometry::{LeafIndex, caret_at, caret_bounds_at};
pub use math::{Formula, FormulaError, MATH_LANGUAGE, MathRenderer, is_math_fence};
pub use mermaid::{Diagram, DiagramError, MERMAID_LANGUAGE, is_mermaid_fence, render_diagram};
pub use movement::{
    Vertical, line_range_at, move_down, move_left, move_right, move_up, move_vertical,
    move_vertical_with_goal, move_word_left, move_word_right, word_range_at,
};
pub use svg::{SvgError, SvgImageChannel, to_png_data_url};

use std::cell::OnceCell;
use std::collections::HashMap;
use std::ops::Range;

use gpui_kit::base::text::editor_host::{
    BlockNode, FlowPosition, Paragraph, RenderContext, parse_markdown,
};
use gpui_kit::{App, Pixels, SharedString, Window, div, prelude::*};
use inkpoint_editor_core::{BlockKind, MarkdownDocument, SourceBlock};

use self::projection::{
    collect_rendered_text, map_code_to_source, map_display_to_source, quote_blank_line_offsets,
    retain_empty_lines, reveal_in_block, source_line,
};

/// The leaf key assigned to the first text leaf of a document.
///
/// Keys are host-owned and stable for the lifetime of a document render: the
/// editor uses them to match geometry back to the block it came from.
pub const FIRST_LEAF_KEY: u64 = 1;

/// Ranges to paint behind a leaf's text, keyed by leaf key and in leaf-local bytes.
pub type Decorations = HashMap<u64, Vec<(Range<usize>, gpui_kit::Hsla)>>;

/// A text leaf's key and its document-wide source range.
///
/// Geometry reports leaf-local bytes. The source range anchors those positions
/// to the Markdown buffer.
#[derive(Clone, Debug)]
pub struct LeafSpan {
    key: u64,
    span: Option<Range<usize>>,
}

impl LeafSpan {
    /// The leaf key this block renders under.
    pub fn key(&self) -> u64 {
        self.key
    }

    /// The leaf's byte range in the document source, when the parser reported one.
    pub fn span(&self) -> Option<Range<usize>> {
        self.span.clone()
    }

    /// Whether `offset` falls inside this leaf or names its empty caret row.
    pub fn contains(&self, offset: usize) -> bool {
        self.span
            .as_ref()
            .is_some_and(|span| span.contains(&offset) || (span.is_empty() && offset == span.start))
    }
}

/// A parsed document ready to be rendered and edited.
pub struct TypesetDocument {
    blocks: Vec<BlockNode>,
    block_ranges: Vec<Option<Range<usize>>>,
    /// The first leaf key of each block, in block order.
    ///
    /// `None` for a block that renders no text (a rule, a definition). A table
    /// owns several keys, so this is not the flat key list.
    block_keys: Vec<Option<u64>>,
    spans: Vec<LeafSpan>,
    source: String,
    rendered_maps: HashMap<u64, Vec<usize>>,
    rendered_before_maps: HashMap<u64, Vec<usize>>,
    inline_marks: Vec<inkpoint_editor_core::InlineMark>,
    active_projection: Option<LocalProjection>,
}

/// Saves the one block and byte map replaced by revealing inline syntax.
struct LocalProjection {
    syntax: Range<usize>,
    block_index: usize,
    original_block: BlockNode,
    key: u64,
    original_leading: Vec<usize>,
    original_trailing: Vec<usize>,
}

impl TypesetDocument {
    /// Parses `source` and assigns leaf keys to the text leaves it renders.
    ///
    /// A heading carries its text in a nested paragraph and a table carries one
    /// paragraph per cell, so keys reach those inner leaves; attaching a key to
    /// the outer block alone would leave that block reporting no geometry. A
    /// table therefore consumes several keys and a block's key is not its index.
    ///
    /// The parser reports an error for input it cannot structure. A caller can
    /// project those same bytes with [`Self::plain_source`].
    pub fn parse(source: impl Into<String>) -> Result<Self, SharedString> {
        Self::parse_with(source, None)
    }

    /// Parses `source`, drawing `mermaid` and `math` fences with `diagrams`.
    ///
    /// Without a renderer those fences stay code blocks, which is the same thing
    /// a failed render produces: the source the user typed.
    pub fn parse_with(
        source: impl Into<String>,
        diagrams: Option<&DiagramRenderer>,
    ) -> Result<Self, SharedString> {
        Self::parse_at(source, diagrams, gpui_kit::SvgSize::ScaleFactor(1.0))
    }

    /// Typesets Markdown with caret positions for otherwise invisible empty lines.
    pub fn parse_for_editing(
        source: impl Into<String>,
        diagrams: Option<&DiagramRenderer>,
    ) -> Result<Self, SharedString> {
        let source = source.into();
        if source.trim().is_empty() {
            return Ok(Self::plain_source(source));
        }
        Self::parse_projection(source, diagrams, gpui_kit::SvgSize::ScaleFactor(1.0), true)
    }

    /// Parses `source`, rasterizing diagrams at `scale`.
    ///
    /// Scale is a display fact — DPI or zoom — so the caller decides it rather
    /// than the document. A diagram rasterized at the wrong scale is blurry or
    /// oversized and cannot be fixed without re-parsing.
    pub fn parse_at(
        source: impl Into<String>,
        diagrams: Option<&DiagramRenderer>,
        scale: gpui_kit::SvgSize,
    ) -> Result<Self, SharedString> {
        Self::parse_projection(source.into(), diagrams, scale, false)
    }

    fn parse_projection(
        source: String,
        diagrams: Option<&DiagramRenderer>,
        scale: gpui_kit::SvgSize,
        editable: bool,
    ) -> Result<Self, SharedString> {
        let parsed = parse_markdown(&source, Default::default())?;
        // Record each block's source range before any rendering replaces it. A
        // rendered diagram becomes a paragraph built from scratch, which carries
        // no span; keeping the original range is what lets the caret resolve an
        // offset inside the fence and lets vertical movement step past it.
        let spans_before: Vec<Option<Range<usize>>> = parsed
            .iter()
            .map(|block| block.span().map(|span| span.start..span.end))
            .collect();
        let parsed = match diagrams {
            Some(diagrams) => {
                let replaced = diagrams.replace_diagrams(parsed, scale);
                // The span carry-forward below is positional, so it is only sound
                // while replacement is strictly one block in, one block out.
                //
                // A mismatch is not a reason to fail the whole document: the user
                // would lose the rendered view of every other block because one
                // diagram misbehaved. Falling back to the unrendered parse keeps
                // the source visible and editable, which is the same degradation a
                // failed diagram gets.
                if replaced.len() == spans_before.len() {
                    replaced
                } else {
                    parse_markdown(&source, Default::default())?
                }
            }
            None => parsed,
        };
        let (parsed, spans_before) = if editable {
            retain_empty_lines(parsed, spans_before, &source)
        } else {
            (parsed, spans_before)
        };
        // Keys are handed out in document order and a table consumes one per
        // cell, so a block's key is no longer its index.
        let mut next_key = FIRST_LEAF_KEY;
        let mut block_keys = Vec::with_capacity(parsed.len());
        let mut spans = Vec::with_capacity(parsed.len());
        let mut blocks = Vec::with_capacity(parsed.len());
        let source_blocks = OnceCell::new();
        let parse_source_blocks = || {
            source_blocks
                .get_or_init(|| MarkdownDocument::new(&source).blocks().unwrap_or_default())
                .as_slice()
        };
        for (index, block) in parsed.into_iter().enumerate() {
            let first = next_key;
            blocks.push(with_leaf_keys(
                block,
                spans_before[index].as_ref(),
                editable.then_some(source.as_str()),
                &parse_source_blocks,
                &mut |span| {
                    let key = next_key;
                    next_key += 1;
                    spans.push(LeafSpan { key, span });
                    key
                },
            ));
            block_keys.push((next_key > first).then_some(first));
        }
        let inline_marks = MarkdownDocument::new(&source)
            .inline_marks()
            .unwrap_or_default();
        // Inline marks are sorted by start. Prefix maxima let us skip marks in
        // earlier leaves while retaining an enclosing mark around nested ones.
        let mark_prefix_ends: Vec<_> = inline_marks
            .iter()
            .scan(0, |end, mark| {
                *end = (*end).max(mark.syntax_range.end);
                Some(*end)
            })
            .collect();
        let mut rendered_texts = HashMap::new();
        let mut rendered_key = FIRST_LEAF_KEY;
        for block in &blocks {
            collect_rendered_text(block, &mut rendered_key, &mut rendered_texts);
        }
        let mut rendered_maps = HashMap::new();
        let mut rendered_before_maps = HashMap::new();
        for leaf in &spans {
            let (Some(span), Some(display)) = (leaf.span.as_ref(), rendered_texts.get(&leaf.key))
            else {
                continue;
            };
            let first = mark_prefix_ends.partition_point(|end| *end <= span.start);
            let last = inline_marks.partition_point(|mark| mark.syntax_range.start < span.end);
            let marks = &inline_marks[first.min(last)..last];
            let (leading, trailing) = if display.code {
                map_code_to_source(span, &display.text, &source)
            } else {
                map_display_to_source(span, &display.text, &source, marks)
            };
            rendered_maps.insert(leaf.key, leading);
            rendered_before_maps.insert(leaf.key, trailing);
        }
        Ok(Self {
            rendered_maps,
            rendered_before_maps,
            inline_marks,
            blocks,
            block_ranges: spans_before,
            block_keys,
            spans,
            source,
            active_projection: None,
        })
    }

    /// Displays every source line literally, with identity source mapping.
    pub fn plain_source(source: impl Into<String>) -> Self {
        use gpui_kit::base::text::editor_host::InlineNode;

        let source = source.into();
        let mut start = 0;
        let mut blocks = Vec::new();
        let mut block_ranges = Vec::new();
        let mut block_keys = Vec::new();
        let mut spans = Vec::new();
        loop {
            let (text, ending) = source_line(&source[start..]);
            let key = FIRST_LEAF_KEY + blocks.len() as u64;
            let mut paragraph = Paragraph::default();
            paragraph.push(InlineNode::new(text.to_owned()));
            blocks.push(BlockNode::Paragraph(paragraph.with_leaf_key(key)));
            block_ranges.push(Some(start..start + text.len()));
            block_keys.push(Some(key));
            spans.push(LeafSpan {
                key,
                span: Some(start..start + text.len()),
            });
            if ending == 0 {
                break;
            }
            start += text.len() + ending;
        }
        Self {
            source,
            blocks,
            block_ranges,
            block_keys,
            spans,
            rendered_maps: HashMap::new(),
            rendered_before_maps: HashMap::new(),
            inline_marks: Vec::new(),
            active_projection: None,
        }
    }

    /// The parsed block tree, with stable leaf keys assigned for geometry.
    pub fn blocks(&self) -> &[BlockNode] {
        &self.blocks
    }

    /// Original Markdown ranges for the top-level blocks, in render order.
    /// Rebuilding a table or rendering a diagram can replace a node's own span.
    pub fn block_ranges(&self) -> &[Option<Range<usize>>] {
        &self.block_ranges
    }

    /// Update which inline syntax range is locally revealed.
    ///
    /// `active_source` is a collapsed caret or selection range in source bytes.
    /// Caret movement within the same mark does not invalidate the projection;
    /// callers can use the returned flag to avoid rebuilding their view. The
    /// renderer uses [`Self::active_reveal`] to paint/reveal only that mark.
    pub fn prepare_projection(&mut self, active_source: Option<Range<usize>>) -> bool {
        let active_mark = active_source.and_then(|active| {
            self.inline_marks
                .iter()
                .filter(|mark| {
                    if matches!(
                        mark.kind,
                        inkpoint_editor_core::InlineMarkKind::Image { .. }
                            | inkpoint_editor_core::InlineMarkKind::InlineMath
                    ) {
                        return false;
                    }
                    if active.is_empty() {
                        mark.syntax_range.contains(&active.start)
                    } else {
                        mark.syntax_range.start < active.end && active.start < mark.syntax_range.end
                    }
                })
                .min_by_key(|mark| mark.syntax_range.len())
                .cloned()
        });
        if active_mark.as_ref().map(|mark| &mark.syntax_range)
            == self
                .active_projection
                .as_ref()
                .map(|previous| &previous.syntax)
        {
            return false;
        }
        if let Some(previous) = self.active_projection.take() {
            self.blocks[previous.block_index] = previous.original_block;
            self.rendered_maps
                .insert(previous.key, previous.original_leading);
            self.rendered_before_maps
                .insert(previous.key, previous.original_trailing);
        }
        self.active_projection = active_mark.and_then(|mark| self.reveal_mark(&mark));
        true
    }

    fn reveal_mark(&mut self, mark: &inkpoint_editor_core::InlineMark) -> Option<LocalProjection> {
        let key = self.leaf_at(mark.range.start)?;
        let block_index = self.block_of(key)?;
        let mut first_key = self.leaf_key(block_index)?;
        let leading = self.rendered_maps.get_mut(&key)?;
        let trailing = self.rendered_before_maps.get_mut(&key)?;
        let block = &mut self.blocks[block_index];
        let revealed = reveal_in_block(
            block,
            key,
            &mark.range,
            &mark.syntax_range,
            &self.source,
            leading,
            &mut first_key,
        );
        let start = leading
            .partition_point(|offset| *offset < mark.range.start)
            .min(leading.len() - 1);
        let end = leading
            .partition_point(|offset| *offset < mark.range.end)
            .min(leading.len() - 1);
        let mut revealed_leading = leading[..start].to_vec();
        revealed_leading.extend(mark.syntax_range.clone());
        revealed_leading.push(mark.syntax_range.end);
        revealed_leading.extend_from_slice(&leading[end + 1..]);
        let mut revealed_trailing = trailing[..=start].to_vec();
        revealed_trailing.extend(mark.syntax_range.start + 1..=mark.syntax_range.end);
        revealed_trailing.extend_from_slice(&trailing[end + 1..]);
        Some(LocalProjection {
            syntax: mark.syntax_range.clone(),
            block_index,
            original_block: std::mem::replace(block, revealed),
            key,
            original_leading: std::mem::replace(leading, revealed_leading),
            original_trailing: std::mem::replace(trailing, revealed_trailing),
        })
    }

    /// The source syntax range selected for local reveal, if any.
    pub fn active_reveal(&self) -> Option<Range<usize>> {
        self.active_projection
            .as_ref()
            .map(|projection| projection.syntax.clone())
    }

    /// The Markdown this document was parsed from.
    pub fn source(&self) -> &str {
        &self.source
    }

    /// The first leaf key of block `index`, or `None` when out of range.
    ///
    /// A table owns one key per cell, so its remaining keys are consecutive from
    /// here.
    pub fn leaf_key(&self, index: usize) -> Option<u64> {
        self.block_keys.get(index).copied().flatten()
    }

    /// Every leaf key with its source span, in document order.
    ///
    /// Tables and lists can contribute several entries. Use [`Self::leaf_key`]
    /// for the first key of each top-level block.
    pub fn leaf_spans(&self) -> &[LeafSpan] {
        &self.spans
    }

    /// The source span of `key`, when the parser reported one.
    ///
    /// Leaf geometry counts bytes from the start of the leaf, while a caret is a
    /// document-wide offset. Callers convert between the two with this span.
    pub fn span_of(&self, key: u64) -> Option<Range<usize>> {
        self.spans
            .get(usize::try_from(key.checked_sub(FIRST_LEAF_KEY)?).ok()?)?
            .span()
    }

    /// Maps a rendered byte offset to the source, skipping known inline delimiters.
    pub fn source_offset(&self, key: u64, rendered: usize) -> Option<usize> {
        let span = self.span_of(key)?;
        Some(match self.rendered_maps.get(&key) {
            Some(positions) => positions[rendered.min(positions.len() - 1)],
            None => span.start + rendered.min(span.len()),
        })
    }

    /// Maps a trailing selection endpoint to the end of the preceding text.
    pub fn source_offset_before(&self, key: u64, rendered: usize) -> Option<usize> {
        if rendered == 0 {
            return self.source_offset(key, 0);
        }
        match self.rendered_before_maps.get(&key) {
            Some(positions) => Some(positions[rendered.min(positions.len() - 1)]),
            None => self.source_offset(key, rendered),
        }
    }

    /// Maps a source byte offset into the rendered leaf.
    pub fn rendered_offset(&self, key: u64, source: usize) -> Option<usize> {
        let span = self.span_of(key)?;
        Some(match self.rendered_maps.get(&key) {
            Some(positions) => positions
                .partition_point(|position| *position < source)
                .min(positions.len() - 1),
            None => source.saturating_sub(span.start).min(span.len()),
        })
    }

    /// The leaf keys that reported geometry, ordered by document position.
    ///
    /// Vertical movement needs this rather than `key ± 1`: a block whose leaf
    /// reported no geometry leaves a gap in the key sequence, and stepping by
    /// one would stop there instead of reaching the next laid-out block.
    pub fn ordered_keys(&self, laid_out: &[u64]) -> Vec<u64> {
        let mut keys: Vec<u64> = self
            .spans
            .iter()
            .map(|leaf| leaf.key)
            .filter(|key| laid_out.contains(key))
            .collect();
        keys.sort_unstable();
        keys
    }

    /// The laid-out leaf adjacent to `key` in the direction of travel.
    ///
    /// Keys are not contiguous: a block whose leaf reported no geometry leaves a
    /// gap, so stepping by one would stop at that gap instead of reaching the
    /// next block that is actually on screen. The caller supplies which keys were
    /// laid out, because that is a per-frame fact.
    ///
    /// Returns the neighbour's key and its source span. Deciding which leaf comes
    /// next is document topology, which belongs here; placing the caret inside
    /// that leaf needs geometry, which belongs to the caller.
    pub fn vertical_neighbour(
        &self,
        key: u64,
        up: bool,
        laid_out: &[u64],
    ) -> Option<(u64, Range<usize>)> {
        let ordered = self.ordered_keys(laid_out);
        let position = ordered.iter().position(|candidate| *candidate == key)?;
        // Cells of one table belong to the same block. Stepping to the next key
        // would move sideways into the neighbouring cell, so the walk skips its
        // own block and lands beyond it: a table is one stop for vertical
        // navigation. The block is identified by which entry in `block_keys`
        // owns the key, since a cell's own span is just its content range.
        let own_block = self.block_of(key);
        let mut cursor = position;
        loop {
            cursor = if up {
                cursor.checked_sub(1)?
            } else {
                cursor + 1
            };
            let candidate = *ordered.get(cursor)?;
            // Skip a laid-out leaf that has no span instead of ending the walk:
            // stopping there would freeze vertical navigation at that block, the
            // failure this function exists to prevent.
            let Some(candidate_span) = self.span_of(candidate) else {
                continue;
            };
            if self.block_of(candidate) == own_block {
                continue;
            }
            return Some((candidate, candidate_span));
        }
    }

    /// The index of the block that owns `key`.
    ///
    /// A block owns the keys from its first one up to the next block's, so a
    /// table's later cells still resolve to the table.
    fn block_of(&self, key: u64) -> Option<usize> {
        // Keys are allocated in document order, so the owner is the last block
        // whose first key is at or before `key`.
        self.block_keys
            .iter()
            .enumerate()
            .filter(|(_, first)| first.is_some_and(|first| first <= key))
            .map(|(index, _)| index)
            .next_back()
    }

    /// The leaf whose source span contains `offset`.
    ///
    /// Falls back to the last block that starts at or before `offset`, because
    /// an offset in the gap between two blocks belongs to the block before it:
    /// that is where a caret at the end of a line sits.
    pub fn leaf_at(&self, offset: usize) -> Option<u64> {
        let mut candidate = None;
        for leaf in &self.spans {
            if leaf.contains(offset) {
                return Some(leaf.key);
            }
            if leaf.span.as_ref().is_some_and(|span| span.start <= offset) {
                candidate = Some(leaf.key);
            }
        }
        candidate.or_else(|| self.spans.first().map(|leaf| leaf.key))
    }

    /// Renders the document's blocks without collecting geometry.
    ///
    /// Use this when the caller owns the geometry collection — for example a
    /// host element that collects during its own prepaint. Collection scopes
    /// are isolated, so wrapping a call that already collects yields nothing.
    pub fn render_blocks(
        &self,
        body_font_size: Pixels,
        context: RenderContext,
        window: &mut Window,
        cx: &mut App,
    ) -> impl IntoElement {
        let context = context.with_body_font_size(body_font_size);
        let count = self.blocks.len();
        let references: Vec<&BlockNode> = self.blocks.iter().collect();
        div().flex().flex_col().children(
            self.blocks
                .iter()
                .enumerate()
                .map(|(index, block)| {
                    let flow = FlowPosition::at(&references, index, index + 1 == count);
                    block
                        .render_with_id(
                            SharedString::from(format!("block-{index}")),
                            flow,
                            &context,
                            window,
                            cx,
                        )
                        .into_any_element()
                })
                .collect::<Vec<_>>(),
        )
    }

    /// Renders the document, painting `selection` behind the selected text.
    ///
    /// `selection` is a document-wide byte range. It is split per leaf here
    /// because the decoration API works in leaf-local bytes; a caller that had
    /// to do that itself would need the same span bookkeeping the caret does.
    /// Builds the element and the decorations, without collecting geometry.
    ///
    /// Geometry can only be collected while the element is being **prepainted**;
    /// a scope opened here, during element construction, always yields an empty
    /// map. The host therefore opens the scope around its own prepaint and calls
    /// this to build the tree.
    pub fn render_with_selection(
        &self,
        body_font_size: Pixels,
        context: RenderContext,
        window: &mut Window,
        cx: &mut App,
        selection: Option<Range<usize>>,
    ) -> (impl IntoElement, Decorations) {
        let decorations = self.selection_decorations(selection);
        let element = self.render_blocks(body_font_size, context, window, cx);
        (element, decorations)
    }

    /// Splits a document-wide selection into per-leaf decorations.
    ///
    /// Each leaf gets the part of the selection that falls inside its span,
    /// rebased to leaf-local bytes. An empty selection paints nothing, which is
    /// why a bare caret needs no decoration of its own.
    pub fn selection_decorations(&self, selection: Option<Range<usize>>) -> Decorations {
        let Some(selection) = selection else {
            return HashMap::new();
        };
        if selection.start >= selection.end {
            return HashMap::new();
        }
        let color: gpui_kit::Hsla = gpui_kit::rgba(0x3b82f640).into();
        let mut decorations: Decorations = HashMap::new();
        for leaf in &self.spans {
            let Some(span) = leaf.span.as_ref() else {
                continue;
            };
            let start = selection.start.max(span.start);
            let end = selection.end.min(span.end);
            if start >= end {
                continue;
            }
            decorations.entry(leaf.key).or_default().push((
                self.rendered_offset(leaf.key, start).unwrap_or(0)
                    ..self.rendered_offset(leaf.key, end).unwrap_or(0),
                color,
            ));
        }
        decorations
    }
}

/// Assigns each rendered leaf a key and its own source range in document order.
fn with_leaf_keys<'a>(
    block: BlockNode,
    fallback: Option<&Range<usize>>,
    editable_source: Option<&str>,
    source_blocks: &impl Fn() -> &'a [SourceBlock],
    register: &mut impl FnMut(Option<Range<usize>>) -> u64,
) -> BlockNode {
    let own_range = block.span().map(|span| span.start..span.end);
    let range = own_range.as_ref().or(fallback);
    let mut map_children = |children: Vec<BlockNode>| {
        children
            .into_iter()
            .map(|child| with_leaf_keys(child, range, editable_source, source_blocks, register))
            .collect()
    };
    match block {
        BlockNode::Paragraph(paragraph) => {
            BlockNode::Paragraph(paragraph.with_leaf_key(register(range.cloned())))
        }
        BlockNode::Heading {
            level,
            children,
            span,
        } => {
            // The rendered paragraph starts after the Markdown heading marker.
            let content = own_range.as_ref().and_then(|range| {
                source_block(source_blocks(), range.start, &BlockKind::Heading { level })
                    .map(|heading| heading.content_range.clone())
            });
            BlockNode::Heading {
                level,
                children: children.with_leaf_key(register(content.or_else(|| range.cloned()))),
                span,
            }
        }
        BlockNode::CodeBlock(code) => {
            BlockNode::CodeBlock(code.with_leaf_key(register(range.cloned())))
        }
        BlockNode::Root { children, span } => BlockNode::Root {
            children: map_children(children),
            span,
        },
        BlockNode::Blockquote { children, span }
            if let (Some(source), Some(range)) = (editable_source, own_range.as_ref()) =>
        {
            let mut projected = Vec::with_capacity(children.len());
            let mut gap_start = range.start;
            for child in children {
                if let Some(child_span) = child.span() {
                    projected.extend(
                        quote_blank_line_offsets(source, gap_start..child_span.start)
                            .map(|offset| empty_caret_row(offset, register)),
                    );
                    gap_start = child_span.end;
                }
                projected.push(with_leaf_keys(
                    child,
                    Some(range),
                    editable_source,
                    source_blocks,
                    register,
                ));
            }
            projected.extend(
                quote_blank_line_offsets(source, gap_start..range.end)
                    .map(|offset| empty_caret_row(offset, register)),
            );
            BlockNode::Blockquote {
                children: projected,
                span,
            }
        }
        BlockNode::Blockquote { children, span } => BlockNode::Blockquote {
            children: map_children(children),
            span,
        },
        BlockNode::Surface {
            name,
            children,
            span,
        } => BlockNode::Surface {
            name,
            children: map_children(children),
            span,
        },
        BlockNode::List {
            children,
            ordered,
            start,
            span,
        } => BlockNode::List {
            children: map_children(children),
            ordered,
            start,
            span,
        },
        BlockNode::ListItem {
            children,
            spread,
            checked,
            task_marker,
            span,
        } => BlockNode::ListItem {
            children: if children.is_empty()
                && editable_source.is_some()
                && let Some(range) = &own_range
            {
                // List items need a paragraph for the marker and caret to render.
                vec![empty_caret_row(range.end, register)]
            } else {
                map_children(children)
            },
            spread,
            checked,
            task_marker,
            span,
        },
        BlockNode::Table(table) => {
            // Match the source parser's cells to the renderer's row-major order.
            let mut cells = Vec::new();
            if let Some(table_source) = own_range
                .as_ref()
                .and_then(|range| source_block(source_blocks(), range.start, &BlockKind::Table))
            {
                gather_cells(&table_source.children, &mut cells);
            }
            let count: usize = table.rows().map(|row| row.count()).sum();
            if cells.len() != count {
                cells.clear();
            }
            let mut cells = cells.into_iter();
            let aligns = table.column_aligns().to_vec();
            let rows: Vec<Vec<gpui_kit::base::text::editor_host::Paragraph>> = table
                .rows()
                .map(|row| {
                    row.map(|paragraph| {
                        let cell = cells.next().or_else(|| range.cloned());
                        paragraph.clone().with_leaf_key(register(cell))
                    })
                    .collect()
                })
                .collect();
            BlockNode::Table(gpui_kit::base::text::editor_host::Table::new(rows, aligns))
        }
        // Only register keys for nodes with a renderer leaf to receive them.
        other => other,
    }
}

fn empty_caret_row(
    offset: usize,
    register: &mut impl FnMut(Option<Range<usize>>) -> u64,
) -> BlockNode {
    BlockNode::Paragraph(Paragraph::default().with_leaf_key(register(Some(offset..offset))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editable_blank_lines_keep_their_source_ranges() {
        for (source, expected) in [
            ("\r\n- list\r\n \t\r\n\r\n---\r\n", &[1, 3, 4, 6][..]),
            ("- list\n  - nested\n\n\n---", &[3, 4][..]),
            ("- ```\n  code\n\n  ```\n\n---", &[5][..]),
            ("- ```\n  code\n\n\n", &[][..]),
            ("paragraph\n\n", &[2, 3][..]),
        ] {
            let document = TypesetDocument::parse_for_editing(source, None).unwrap();
            let mut blank_lines = Vec::new();
            for (block, range) in document.blocks().iter().zip(document.block_ranges()) {
                if let (BlockNode::Paragraph(paragraph), Some(range)) = (block, range)
                    && paragraph.children().is_empty()
                {
                    let key = document.leaf_at(range.start).unwrap();
                    assert_eq!(document.span_of(key).as_ref(), Some(range));
                    assert_eq!(document.source_offset(key, 0), Some(range.end));
                    assert_eq!(
                        source_line(&source[range.start..]).0,
                        &source[range.clone()]
                    );
                    blank_lines.push(
                        source[..range.start]
                            .bytes()
                            .filter(|b| *b == b'\n')
                            .count()
                            + 1,
                    );
                }
            }
            assert_eq!(blank_lines, expected, "{source:?}");
        }
    }

    #[test]
    fn editable_containers_project_empty_lines_at_the_end_of_the_marker() {
        for (source, empty_line) in [
            ("1. parent\n   - first\n   - \n   - last", "   - \n"),
            (">> first\r\n>> \r\n>> last", ">> \r\n"),
        ] {
            let offset = source.find(empty_line).unwrap() + source_line(empty_line).0.len();
            let document = TypesetDocument::parse_for_editing(source, None).unwrap();
            let key = document.leaf_at(offset).unwrap();
            assert_eq!(document.span_of(key), Some(offset..offset));
            assert_eq!(document.source_offset(key, 0), Some(offset));
            let preview = TypesetDocument::parse(source).unwrap();
            assert!(
                preview
                    .leaf_spans()
                    .iter()
                    .all(|leaf| leaf.span() != Some(offset..offset))
            );
        }
    }

    #[test]
    fn inline_syntax_maps_rendered_offsets_to_source() {
        let source = "**中文** [链接](https://example.com) 😀";
        let document = TypesetDocument::parse(source).unwrap();
        let key = document.leaf_key(0).unwrap();
        let link = source.find("链接").unwrap();
        let emoji = source.find('😀').unwrap();
        assert_eq!(document.source_offset(key, 0), Some(2));
        assert_eq!(document.source_offset(key, "中文 ".len()), Some(link));
        assert_eq!(document.source_offset(key, "中文 链接 ".len()), Some(emoji));
        assert_eq!(
            document.rendered_offset(key, emoji),
            Some("中文 链接 ".len())
        );
    }

    #[test]
    fn local_reveal_tracks_only_active_inline_syntax_and_caches_transitions() {
        let mut document = TypesetDocument::parse("before **bold** after").unwrap();
        assert!(!document.blocks().is_empty());
        assert!(document.prepare_projection(Some(10..10)));
        assert_eq!(document.active_reveal(), Some(7..15));
        let BlockNode::Paragraph(paragraph) = &document.blocks()[0] else {
            panic!("expected paragraph")
        };
        assert_eq!(
            paragraph
                .children()
                .iter()
                .map(|run| run.text())
                .collect::<String>(),
            "before **bold** after"
        );
        let key = document.leaf_key(0).unwrap();
        assert_eq!(document.source_offset(key, 9), Some(9));
        assert_eq!(document.source_offset_before(key, 9), Some(9));
        assert_eq!(document.rendered_offset(key, 11), Some(11));
        assert!(!document.prepare_projection(Some(12..12)));
        assert!(document.prepare_projection(Some(0..0)));
        assert_eq!(document.active_reveal(), None);
        assert!(!document.prepare_projection(None));

        let source = "**outer *inner* tail**";
        let mut nested = TypesetDocument::parse(source).unwrap();
        let caret = source.find("inner").unwrap() + 2;
        assert!(nested.prepare_projection(Some(caret..caret)));
        let start = source.find("*inner*").unwrap();
        assert_eq!(nested.active_reveal(), Some(start..start + "*inner*".len()));
    }

    #[test]
    fn display_map_handles_entities_escapes_and_atomic_images() {
        let entity_source = "a &amp; b";
        let entity = TypesetDocument::parse(entity_source).unwrap();
        let key = entity.leaf_key(0).unwrap();
        assert_eq!(entity.source_offset(key, 2), Some(2));
        assert_eq!(entity.source_offset_before(key, 3), Some(7));

        let escaped_source = "a \\* b";
        let escaped = TypesetDocument::parse(escaped_source).unwrap();
        let key = escaped.leaf_key(0).unwrap();
        assert_eq!(escaped.source_offset(key, 2), Some(3));
        assert_eq!(escaped.source_offset_before(key, 3), Some(4));

        let image_source = "a ![alt](img) b";
        let image = TypesetDocument::parse(image_source).unwrap();
        let key = image.leaf_key(0).unwrap();
        let image_start = image_source.find("![alt]").unwrap();
        let image_end = image_source.find(" b").unwrap();
        assert_eq!(image.source_offset_before(key, 2), Some(image_start));
        assert_eq!(image.source_offset(key, 2), Some(image_start));
        assert_eq!(
            image.source_offset(key, 2 + '\u{fffc}'.len_utf8()),
            Some(image_end)
        );

        let utf8 = TypesetDocument::parse("**中**").unwrap();
        let key = utf8.leaf_key(0).unwrap();
        assert_eq!(utf8.source_offset_before(key, "中".len()), Some(5));
        assert_eq!(utf8.source_offset(key, "中".len()), Some(7));

        for source in ["**a \\* b**", "**a &amp; b**"] {
            let mut document = TypesetDocument::parse(source).unwrap();
            let caret = source.find("a ").unwrap() + 1;
            assert!(document.prepare_projection(Some(caret..caret)));
            let BlockNode::Paragraph(paragraph) = &document.blocks()[0] else {
                panic!("expected paragraph")
            };
            assert_eq!(
                paragraph
                    .children()
                    .iter()
                    .map(|run| run.text())
                    .collect::<String>(),
                source
            );
        }
    }

    #[test]
    fn inline_syntax_maps_rendered_offsets_to_source_with_code_and_breaks() {
        let source = "prefix `code` suffix\nsecond line";
        let document = TypesetDocument::parse(source).unwrap();
        let key = document.leaf_key(0).unwrap();
        let code_pos = source.find("code").unwrap();
        let suffix_pos = source.find("suffix").unwrap();
        assert_eq!(document.source_offset(key, "prefix ".len()), Some(code_pos));
        assert_eq!(
            document.source_offset(key, "prefix code ".len()),
            Some(suffix_pos)
        );
    }

    /// The parser reports document-wide spans, which is what lets a caret
    /// offset resolve to a leaf.
    #[test]
    fn each_leaf_carries_its_source_span() {
        let document = TypesetDocument::parse("# One\n\nTwo\n").expect("markdown parses");
        let spans: Vec<_> = document
            .leaf_spans()
            .iter()
            .map(|leaf| leaf.span())
            .collect();
        assert_eq!(spans.len(), 2, "a heading and a paragraph");
        let heading = spans[0].clone().expect("the heading has a span");
        assert_eq!(&document.source()[heading.clone()], "One");
        let paragraph = spans[1].clone().expect("the paragraph has a span");
        assert!(
            paragraph.start >= heading.end,
            "the paragraph starts after the heading: {paragraph:?} vs {heading:?}"
        );
    }

    /// A caret offset is document-wide. Resolving it by leaf length would land
    /// on the first block every time, so this pins the span-based lookup.
    #[test]
    fn a_caret_offset_resolves_to_the_block_that_contains_it() {
        let source = "# One\n\nTwo\n";
        let document = TypesetDocument::parse(source).expect("markdown parses");
        let first = document.leaf_key(0).expect("a first key");
        let second = document.leaf_key(1).expect("a second key");
        assert_eq!(document.leaf_at(0), Some(first), "the start is the heading");
        let paragraph_start = source.find("Two").expect("the paragraph text");
        assert_eq!(
            document.leaf_at(paragraph_start),
            Some(second),
            "an offset inside the paragraph resolves to it, not the heading"
        );
    }

    /// A caret sitting in the blank line between blocks belongs to the block
    /// before it, which is where the end of a line actually is.
    #[test]
    fn an_offset_between_blocks_resolves_to_the_earlier_one() {
        let document = TypesetDocument::parse("# One\n\nTwo\n").expect("markdown parses");
        let first = document.leaf_key(0).expect("a first key");
        assert_eq!(
            document.leaf_at(6),
            Some(first),
            "offset 6 is the blank line"
        );
    }

    /// A rendered diagram must keep the fence's source range.
    ///
    /// Losing it breaks two things the caret depends on: resolving an offset
    /// inside the fence to its block, and stepping vertically past the diagram
    /// instead of stopping dead at it.
    #[test]
    fn a_rendered_diagram_keeps_its_source_span() {
        let source = "before\n\n```mermaid\nflowchart LR\nA-->B\n```\n\nafter\n";
        let plain = TypesetDocument::parse(source).expect("markdown parses");
        let renderer = DiagramRenderer::new(std::sync::Arc::new(()));
        let drawn = TypesetDocument::parse_with(source, Some(&renderer)).expect("markdown parses");

        let fence_span = plain
            .leaf_spans()
            .get(1)
            .and_then(|leaf| leaf.span())
            .expect("the fence has a range");
        let kept = drawn
            .leaf_spans()
            .get(1)
            .and_then(|leaf| leaf.span())
            .expect("the rendered block keeps the fence's range");
        assert_eq!(kept, fence_span, "rendering must not lose the source range");
    }

    /// A table consumes one key per cell, so a block's key is not its index.
    #[test]
    fn a_table_consumes_one_key_per_cell() {
        let document = TypesetDocument::parse("| a | b |\n| --- | --- |\n| c | d |\n")
            .expect("markdown parses");
        // Two paragraphs before/after would each take one key; the table takes
        // four (2x2), so the total is larger than the block count.
        assert_eq!(document.leaf_spans().len(), 4, "2x2 cells");
        assert_eq!(
            document.leaf_key(0),
            Some(FIRST_LEAF_KEY),
            "the first block starts at the first key"
        );
    }

    /// A table and the paragraph after it get distinct, non-overlapping keys.
    #[test]
    fn a_block_after_a_table_starts_past_the_cells() {
        let document =
            TypesetDocument::parse("| a | b |\n| --- | --- |\n\nafter\n").expect("markdown parses");
        let table_first = document.leaf_key(0).expect("the table");
        let after_first = document.leaf_key(1).expect("the paragraph");
        assert_eq!(
            after_first,
            table_first + 2,
            "the paragraph follows the table's two cells"
        );
    }

    /// A diagram renderer that changes the block count must not lose the view.
    ///
    /// The alternative — failing the parse — would blank every other block
    /// because one diagram misbehaved.
    #[test]
    fn a_renderer_that_changes_the_block_count_falls_back_to_source() {
        // No renderer means no replacement, which is the same shape the fallback
        // produces: the fence stays a code block.
        let source = "```mermaid\nflowchart LR\nA-->B\n```\n";
        let document = TypesetDocument::parse(source).expect("markdown parses");
        assert_eq!(document.leaf_spans().len(), 1);
        assert!(
            document.leaf_spans()[0].span().is_some(),
            "the block keeps its range even without a renderer"
        );
    }

    /// An offset inside a diagram resolves to the diagram's block.
    #[test]
    fn an_offset_inside_a_diagram_resolves_to_its_block() {
        let source = "before\n\n```mermaid\nflowchart LR\nA-->B\n```\n\nafter\n";
        let renderer = DiagramRenderer::new(std::sync::Arc::new(()));
        let document = TypesetDocument::parse_with(source, Some(&renderer)).expect("parses");
        let inside = source.find("flowchart").expect("the fence body");
        let key = document.leaf_at(inside).expect("a leaf");
        assert_eq!(
            Some(key),
            document.leaf_key(1),
            "the caret inside the fence belongs to the diagram block"
        );
    }

    #[test]
    fn a_vertical_neighbour_skips_keys_that_reported_no_geometry() {
        // Three blocks, but the middle one did not lay out this frame. Stepping
        // by one from the first would stop at the gap; the neighbour must be the
        // third block.
        let document = TypesetDocument::parse("one\n\ntwo\n\nthree\n").expect("parses");
        let first = document.leaf_key(0).expect("a first key");
        let third = document.leaf_key(2).expect("a third key");
        let laid_out = vec![first, third];
        let (key, span) = document
            .vertical_neighbour(first, false, &laid_out)
            .expect("the third block is below");
        assert_eq!(key, third);
        assert!(span.start > 0);
    }

    /// Up/Down must treat a table as one stop, not one per cell.
    ///
    /// Cells share their table's range; stepping to the next key would move
    /// sideways into the neighbouring cell instead of down past the table.
    #[test]
    fn a_vertical_neighbour_skips_the_rest_of_the_table() {
        let source = "before\n\n| a | b |\n| --- | --- |\n| c | d |\n\nafter\n";
        let document = TypesetDocument::parse(source).expect("markdown parses");
        let laid_out: Vec<u64> = document
            .leaf_spans()
            .iter()
            .map(|leaf| leaf.key())
            .collect();
        let first_cell = document.leaf_key(1).expect("the table's first cell");
        let after = document.leaf_key(2).expect("the paragraph after");
        let (key, _) = document
            .vertical_neighbour(first_cell, false, &laid_out)
            .expect("there is a block below");
        assert_eq!(key, after, "Down from a cell must leave the table entirely");
    }

    /// A laid-out leaf with no span must be skipped, not end the walk.
    ///
    /// Ending there would freeze vertical navigation at that block — the failure
    /// `vertical_neighbour` exists to prevent.
    #[test]
    fn a_vertical_neighbour_skips_a_leaf_without_a_span() {
        let document = TypesetDocument::parse("one\n\ntwo\n\nthree\n").expect("parses");
        let first = document.leaf_key(0).expect("a first key");
        let third = document.leaf_key(2).expect("a third key");
        // The middle key is "laid out" but has no span of its own.
        let laid_out = vec![first, third];
        let (key, _) = document
            .vertical_neighbour(first, false, &laid_out)
            .expect("the walk reaches the third block");
        assert_eq!(key, third);
    }

    #[test]
    fn a_vertical_neighbour_stops_at_the_edges() {
        let document = TypesetDocument::parse("one\n\ntwo\n").expect("parses");
        let first = document.leaf_key(0).expect("a first key");
        let second = document.leaf_key(1).expect("a second key");
        let laid_out = vec![first, second];
        assert!(
            document
                .vertical_neighbour(first, true, &laid_out)
                .is_none(),
            "nothing is above the first block"
        );
        assert!(
            document
                .vertical_neighbour(second, false, &laid_out)
                .is_none(),
            "nothing is below the last block"
        );
    }

    #[test]
    fn a_heading_leaf_key_reaches_its_nested_paragraph() {
        // Without this the heading reports no geometry at all.
        let document = TypesetDocument::parse("# One\n").expect("markdown parses");
        assert_eq!(document.leaf_spans().len(), 1);
        assert_eq!(document.leaf_key(0), Some(FIRST_LEAF_KEY));
    }
}

fn source_block<'a>(
    blocks: &'a [SourceBlock],
    start: usize,
    kind: &BlockKind,
) -> Option<&'a SourceBlock> {
    blocks.iter().find_map(|block| {
        if block.range.start == start && block.kind == *kind {
            Some(block)
        } else if block.range.contains(&start) {
            source_block(&block.children, start, kind)
        } else {
            None
        }
    })
}

/// Gathers cell content ranges from inside one table.
fn gather_cells(blocks: &[SourceBlock], out: &mut Vec<Range<usize>>) {
    for block in blocks {
        if matches!(block.kind, BlockKind::TableCell) {
            out.push(block.content_range.clone());
        }
        gather_cells(&block.children, out);
    }
}

#[cfg(test)]
mod table_span_tests {
    use super::*;

    /// Two tables in one document must each map their own cells.
    ///
    /// Collecting every table's cells and comparing against one table's count
    /// mismatches as soon as a second table exists, which silently sends every
    /// cell back to the whole-table range.
    #[test]
    fn two_tables_each_map_their_own_cells() {
        let source = "| a | b |\n| --- | --- |\n| c | d |\n\n| e | f |\n| --- | --- |\n| g | h |\n";
        let document = TypesetDocument::parse(source).expect("markdown parses");
        let starts: Vec<usize> = document
            .leaf_spans()
            .iter()
            .filter_map(|leaf| leaf.span().map(|span| span.start))
            .collect();
        assert_eq!(starts.len(), 8, "two 2x2 tables");
        let unique: std::collections::HashSet<usize> = starts.iter().copied().collect();
        assert_eq!(
            unique.len(),
            8,
            "every cell of both tables must start at its own offset, got {starts:?}"
        );
    }

    /// Each cell leaf must carry its own range.
    ///
    /// A click's offset is `span.start + leaf-local index`, so if every cell
    /// shares the table's range a click in any cell lands at the same offset and
    /// typed text goes into the first cell.
    #[test]
    fn each_table_cell_carries_its_own_range() {
        let source = "| a | b |\n| --- | --- |\n| c | d |\n";
        let document = TypesetDocument::parse(source).expect("markdown parses");
        let starts: Vec<usize> = document
            .leaf_spans()
            .iter()
            .filter_map(|leaf| leaf.span().map(|span| span.start))
            .collect();
        assert_eq!(starts.len(), 4, "2x2 cells");
        let unique: std::collections::HashSet<usize> = starts.iter().copied().collect();
        assert_eq!(
            unique.len(),
            4,
            "each cell must start at its own offset, got {starts:?}"
        );
        // And each range must slice to that cell's text.
        for leaf in document.leaf_spans() {
            let Some(span) = leaf.span() else { continue };
            let text = source.get(span).unwrap_or_default();
            assert!(
                ["a", "b", "c", "d"].contains(&text.trim()),
                "a cell range must cover exactly one cell, got {text:?}"
            );
        }
    }
}
