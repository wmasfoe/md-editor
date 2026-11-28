//! Markdown source operations for the editor. The editing session owns source
//! and history. Parsing never serializes an AST over user-authored source.

mod cjk;
mod fence;
pub mod links;
mod list_newline;
pub mod session;
pub mod table_edit;
pub mod table_navigation;
pub mod text;

use std::ops::Range;

use markdown::{Constructs, ParseOptions, mdast::Node, to_mdast};

/// Markdown remains source-authoritative to retain syntax not handled by the
/// visual renderer.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarkdownDocument {
    source: String,
}

/// Flow content a renderer can display as an editable block.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BlockKind {
    Paragraph,
    Heading { level: u8 },
    Blockquote,
    List { ordered: bool, start: Option<u32> },
    ListItem { checked: Option<bool> },
    Code { language: Option<Range<usize>> },
    Table,
    TableRow,
    TableCell,
    ThematicBreak,
    Html,
    Frontmatter,
    Other,
}

/// A source-anchored Markdown block. Offsets are UTF-8 byte offsets into the
/// original Markdown string.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceBlock {
    pub kind: BlockKind,
    pub range: Range<usize>,
    pub content_range: Range<usize>,
    pub children: Vec<SourceBlock>,
}

/// A style or link annotation projected from Markdown syntax.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InlineMark {
    /// The marked content, excluding Markdown delimiters.
    pub range: Range<usize>,
    /// The full syntax, including delimiters and link destination.
    pub syntax_range: Range<usize>,
    pub kind: InlineMarkKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InlineMarkKind {
    Emphasis,
    Strong,
    Strikethrough,
    Code,
    Link { destination: String },
    Image { source: String, alt: String },
    InlineMath,
}

/// Decodes a complete CommonMark character reference, including its delimiters.
pub fn decode_character_reference(reference: &str) -> Option<String> {
    let value = reference.strip_prefix('&')?.strip_suffix(';')?;
    match value.strip_prefix('#') {
        Some(digits) => {
            let (digits, radix, limit) = match digits.strip_prefix(['x', 'X']) {
                Some(hex) => (hex, 16, 6),
                None => (digits, 10, 7),
            };
            if digits.is_empty()
                || digits.len() > limit
                || !digits.chars().all(|digit| digit.is_digit(radix))
            {
                return None;
            }
            Some(markdown::decode_numeric(digits, radix))
        }
        None => markdown::decode_named(value, true),
    }
}

/// Inline Markdown delimiters supported by the formatting commands.
#[derive(Clone, Copy)]
pub enum InlineFormat {
    Bold,
    Italic,
    Strikethrough,
    Code,
}

/// Renderer-neutral source edit. Applying an edit changes only its requested
/// range, preserving surrounding spelling and whitespace.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceEdit {
    pub range: Range<usize>,
    pub replacement: String,
    pub selection_after: Range<usize>,
}

/// Checks if text is a valid standalone URL (http, https, ftp).
pub fn is_valid_url(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.contains(char::is_whitespace) {
        return false;
    }
    let Some(scheme_end) = trimmed.find("://") else {
        return false;
    };
    let scheme = &trimmed[..scheme_end];
    if !scheme.eq_ignore_ascii_case("http")
        && !scheme.eq_ignore_ascii_case("https")
        && !scheme.eq_ignore_ascii_case("ftp")
    {
        return false;
    }
    let rest = &trimmed[scheme_end + 3..];
    !rest.is_empty() && rest.contains('.')
}

#[allow(dead_code)]
fn word_range_at(source: &str, offset: usize) -> Range<usize> {
    if source.is_empty() {
        return 0..0;
    }
    let offset = offset.min(source.len());
    let before = &source[..offset];
    let after = &source[offset..];
    let start = before
        .rfind(|c: char| !c.is_alphanumeric() && c != '_')
        .map_or(0, |i| {
            let ch_len = before[i..].chars().next().map_or(1, char::len_utf8);
            i + ch_len
        });
    let end = after
        .find(|c: char| !c.is_alphanumeric() && c != '_')
        .map_or(source.len(), |i| offset + i);
    start..end
}

impl MarkdownDocument {
    pub fn new(source: impl Into<String>) -> Self {
        Self {
            source: source.into(),
        }
    }

    pub fn source(&self) -> &str {
        &self.source
    }

    pub fn into_source(self) -> String {
        self.source
    }

    pub fn blocks(&self) -> Result<Vec<SourceBlock>, String> {
        let root = parse_markdown(&self.source)?;
        Ok(flow_children(&root, &self.source))
    }

    pub fn inline_marks(&self) -> Result<Vec<InlineMark>, String> {
        let root = parse_markdown(&self.source)?;
        let mut marks = Vec::new();
        collect_inline_marks(&root, &self.source, &mut marks);
        marks.sort_by(|left, right| {
            left.syntax_range
                .start
                .cmp(&right.syntax_range.start)
                .then_with(|| right.syntax_range.end.cmp(&left.syntax_range.end))
        });
        Ok(marks)
    }

    pub fn apply(&self, edit: &SourceEdit) -> Result<Self, EditError> {
        validate_range(&self.source, &edit.range)?;
        let mut source = String::with_capacity(
            self.source.len() - (edit.range.end - edit.range.start) + edit.replacement.len(),
        );
        source.push_str(&self.source[..edit.range.start]);
        source.push_str(&edit.replacement);
        source.push_str(&self.source[edit.range.end..]);
        validate_range(&source, &edit.selection_after)?;
        Ok(Self::new(source))
    }

    pub fn wrap_selection(
        &self,
        selection: Range<usize>,
        prefix: &str,
        suffix: &str,
    ) -> Result<SourceEdit, EditError> {
        validate_range(&self.source, &selection)?;
        let selected = &self.source[selection.clone()];
        Ok(SourceEdit {
            range: selection.clone(),
            replacement: format!("{prefix}{selected}{suffix}"),
            selection_after: selection.start + prefix.len()
                ..selection.start + prefix.len() + selected.len(),
        })
    }

    /// Toggle one inline mark around a selected source range or word.
    /// An exact matching content range removes only that mark's syntax.
    pub fn toggle_inline_mark(
        &self,
        selection: Range<usize>,
        format: InlineFormat,
    ) -> Result<SourceEdit, EditError> {
        validate_range(&self.source, &selection)?;
        let (kind, delimiter) = match format {
            InlineFormat::Bold => (InlineMarkKind::Strong, "**"),
            InlineFormat::Italic => (InlineMarkKind::Emphasis, "*"),
            InlineFormat::Strikethrough => (InlineMarkKind::Strikethrough, "~~"),
            InlineFormat::Code => (InlineMarkKind::Code, "`"),
        };
        let d_len = delimiter.len();

        // 1. Collapsed selection handling
        if selection.is_empty() {
            let pos = selection.start;
            // Case 1a: Exactly between delimiters: **|**
            if self.source[..pos].ends_with(delimiter) && self.source[pos..].starts_with(delimiter)
            {
                let start = pos - d_len;
                return Ok(SourceEdit {
                    range: start..pos + d_len,
                    replacement: String::new(),
                    selection_after: start..start,
                });
            }
            // Case 1b: Caret is inside an existing mark of this kind: **he|llo** -> unwrap!
            if let Some(mark) = self
                .inline_marks()
                .unwrap_or_default()
                .into_iter()
                .find(|mark| mark.kind == kind && mark.syntax_range.contains(&pos))
            {
                let content = self.source[mark.range.clone()].to_string();
                let start = mark.syntax_range.start;
                let end = start + content.len();
                return Ok(SourceEdit {
                    range: mark.syntax_range,
                    replacement: content,
                    selection_after: start..end,
                });
            }
            return self.wrap_selection(selection, delimiter, delimiter);
        }

        // 2. Non-collapsed selection handling
        // Case 2a: Delimiters are immediately outside selection: **[hello]** -> unwrap!
        if selection.start >= d_len
            && selection.end + d_len <= self.source.len()
            && self.source[..selection.start].ends_with(delimiter)
            && self.source[selection.end..].starts_with(delimiter)
        {
            let selected = self.source[selection.clone()].to_string();
            let start = selection.start - d_len;
            return Ok(SourceEdit {
                range: start..selection.end + d_len,
                replacement: selected.clone(),
                selection_after: start..start + selected.len(),
            });
        }

        // Case 2b: Delimiters are inside selection: [**hello**] -> unwrap!
        let selected_text = &self.source[selection.clone()];
        if selected_text.len() >= 2 * d_len
            && selected_text.starts_with(delimiter)
            && selected_text.ends_with(delimiter)
        {
            let inner = &selected_text[d_len..selected_text.len() - d_len];
            return Ok(SourceEdit {
                range: selection.clone(),
                replacement: inner.to_string(),
                selection_after: selection.start..selection.start + inner.len(),
            });
        }

        // Case 2c: Existing mark matches selection or syntax_range
        if let Some(mark) = self
            .inline_marks()
            .unwrap_or_default()
            .into_iter()
            .find(|mark| {
                mark.kind == kind && (mark.range == selection || mark.syntax_range == selection)
            })
        {
            let content = self.source[mark.range.clone()].to_string();
            let start = mark.syntax_range.start;
            let end = start + content.len();
            return Ok(SourceEdit {
                range: mark.syntax_range,
                replacement: content,
                selection_after: start..end,
            });
        }

        // Case 2d: Wrap selection, but trim leading/trailing spaces outside delimiters so Markdown is valid CommonMark!
        let leading_spaces = selected_text
            .chars()
            .take_while(|c| c.is_whitespace())
            .map(char::len_utf8)
            .sum::<usize>();
        let trailing_spaces = selected_text
            .chars()
            .rev()
            .take_while(|c| c.is_whitespace())
            .map(char::len_utf8)
            .sum::<usize>();
        if leading_spaces > 0 || trailing_spaces > 0 {
            if leading_spaces >= selected_text.len() {
                // Whole selection is spaces
                return self.wrap_selection(selection, delimiter, delimiter);
            }
            let inner_start = selection.start + leading_spaces;
            let inner_end = selection.end - trailing_spaces;
            let body = &self.source[inner_start..inner_end];
            let leading = &selected_text[..leading_spaces];
            let trailing = &selected_text[selected_text.len() - trailing_spaces..];
            let replacement = format!("{leading}{delimiter}{body}{delimiter}{trailing}");
            let sel_start = selection.start + leading_spaces + d_len;
            let sel_end = sel_start + body.len();
            return Ok(SourceEdit {
                range: selection,
                replacement,
                selection_after: sel_start..sel_end,
            });
        }

        self.wrap_selection(selection, delimiter, delimiter)
    }

    pub fn set_heading(&self, selection: Range<usize>, level: u8) -> Result<SourceEdit, EditError> {
        if level > 6 {
            return Err(EditError::InvalidHeadingLevel);
        }
        self.transform_selected_lines(selection, |line| {
            let body = line.trim_start();
            let leading = line.len() - body.len();
            let marker_end = body.bytes().take_while(|byte| *byte == b'#').count();
            let text = if marker_end > 0
                && body
                    .as_bytes()
                    .get(marker_end)
                    .is_some_and(|byte| byte.is_ascii_whitespace())
            {
                body[marker_end..].trim_start()
            } else {
                body
            };
            if level == 0 {
                format!("{}{}", &line[..leading], text)
            } else {
                format!(
                    "{}{} {}",
                    &line[..leading],
                    "#".repeat(level as usize),
                    text
                )
            }
        })
    }

    pub fn toggle_line_prefix(
        &self,
        selection: Range<usize>,
        prefix: &str,
    ) -> Result<SourceEdit, EditError> {
        self.transform_selected_lines(selection, |line| {
            let body = line.trim_start();
            let leading = &line[..line.len() - body.len()];
            if let Some(unprefixed) = body.strip_prefix(prefix) {
                format!("{leading}{unprefixed}")
            } else {
                format!("{leading}{prefix}{body}")
            }
        })
    }

    fn transform_selected_lines(
        &self,
        selection: Range<usize>,
        transform: impl Fn(&str) -> String,
    ) -> Result<SourceEdit, EditError> {
        validate_range(&self.source, &selection)?;
        let start = self.source[..selection.start]
            .rfind('\n')
            .map_or(0, |index| index + 1);
        let end = self.source[selection.end..]
            .find('\n')
            .map_or(self.source.len(), |index| selection.end + index);
        let replacement = self.source[start..end]
            .split_inclusive('\n')
            .map(|line| {
                let content = line.strip_suffix('\n').unwrap_or(line);
                let newline = if line.ends_with('\n') { "\n" } else { "" };
                format!("{}{newline}", transform(content))
            })
            .collect::<String>();
        let selection_length = replacement.trim_end_matches('\n').len();
        Ok(SourceEdit {
            range: start..end,
            replacement,
            selection_after: start..start + selection_length,
        })
    }
}

fn parse_markdown(source: &str) -> Result<Node, String> {
    // CJK punctuation next to an emphasis delimiter makes CommonMark's flanking
    // rule reject both runs and match the wrong pair, so `**「a」**到**「b」**`
    // bolded the `到` instead. The rewrite keeps byte offsets identical, so every
    // range in the returned tree is still valid against `source`, and callers
    // keep slicing content from the original text.
    let rewritten;
    let parse_input = if crate::cjk::contains_cjk_punctuation(source) {
        rewritten = crate::cjk::with_cjk_friendly_flanking(source);
        rewritten.as_str()
    } else {
        source
    };
    to_mdast(parse_input, &parse_options())
        // Raw HTML is still part of the app's Markdown contract, while MDX
        // intentionally disables HTML. Fall back only when MDX parsing fails.
        .or_else(|_| to_mdast(parse_input, &ParseOptions::gfm()))
        .map_err(|error| error.to_string())
}

fn parse_options() -> ParseOptions {
    // Match the constructs used by the app: MDX plus GFM, YAML frontmatter,
    // and math. Keep source offsets intact; this AST is only a projection.
    let mut constructs = Constructs::mdx();
    constructs.frontmatter = true;
    constructs.gfm_autolink_literal = true;
    constructs.gfm_footnote_definition = true;
    constructs.gfm_label_start_footnote = true;
    constructs.gfm_strikethrough = true;
    constructs.gfm_table = true;
    constructs.gfm_task_list_item = true;
    constructs.math_flow = true;
    constructs.math_text = true;
    ParseOptions {
        constructs,
        ..ParseOptions::default()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EditError {
    InvalidRange,
    InvalidHeadingLevel,
}

impl std::fmt::Display for EditError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidRange => {
                "The edit range is outside the document or splits a UTF-8 character."
            }
            Self::InvalidHeadingLevel => "A Markdown heading level must be between one and six.",
        })
    }
}

impl std::error::Error for EditError {}

fn validate_range(source: &str, range: &Range<usize>) -> Result<(), EditError> {
    if range.start > range.end
        || range.end > source.len()
        || !source.is_char_boundary(range.start)
        || !source.is_char_boundary(range.end)
    {
        return Err(EditError::InvalidRange);
    }
    Ok(())
}

fn flow_children(node: &Node, source: &str) -> Vec<SourceBlock> {
    match node {
        Node::Root(root) => root
            .children
            .iter()
            .flat_map(|child| flow_blocks(child, source))
            .collect(),
        _ => flow_blocks(node, source),
    }
}

fn flow_blocks(node: &Node, source: &str) -> Vec<SourceBlock> {
    let Some((kind, range)) = block_kind_and_range(node, source) else {
        return Vec::new();
    };
    let children = match node {
        Node::Blockquote(value) => blocks_from_children(&value.children, source),
        Node::List(value) => blocks_from_children(&value.children, source),
        Node::ListItem(value) => blocks_from_children(&value.children, source),
        Node::Table(value) => table_rows(&value.children, source),
        _ => Vec::new(),
    };
    let content_range = match node {
        Node::Heading(value) => child_range(&value.children).unwrap_or_else(|| range.clone()),
        _ => children
            .first()
            .zip(children.last())
            .map_or(range.clone(), |(first, last)| {
                first.range.start..last.range.end
            }),
    };
    vec![SourceBlock {
        kind,
        range,
        content_range,
        children,
    }]
}

fn blocks_from_children(children: &[Node], source: &str) -> Vec<SourceBlock> {
    children
        .iter()
        .flat_map(|node| flow_blocks(node, source))
        .collect()
}

fn table_rows(rows: &[Node], source: &str) -> Vec<SourceBlock> {
    rows.iter()
        .filter_map(|row| {
            let Node::TableRow(row) = row else {
                return None;
            };
            let range = position(&row.position)?;
            let line_end = source[range.clone()]
                .find(['\r', '\n'])
                .map_or(range.end, |offset| range.start + offset);
            let row_range = range.start..line_end;
            let slots = table_cell_slots(source, row_range.clone(), row.children.len())?;
            let children = slots
                .into_iter()
                .map(|slot| {
                    let content_range = trim_cell_padding(source, &slot);
                    SourceBlock {
                        kind: BlockKind::TableCell,
                        range: slot,
                        content_range,
                        children: Vec::new(),
                    }
                })
                .collect();
            Some(SourceBlock {
                kind: BlockKind::TableRow,
                range: row_range.clone(),
                content_range: row_range,
                children,
            })
        })
        .collect()
}

/// Derive cell slices from source pipes because markdown-rs cell positions
/// can include a delimiter on either side depending on the table spelling.
fn table_cell_slots(source: &str, row: Range<usize>, expected: usize) -> Option<Vec<Range<usize>>> {
    let line = source.get(row.clone())?;
    let mut pipes = Vec::new();
    let mut offset = 0;
    let mut code_ticks = 0;
    let mut escaped = false;
    let bytes = line.as_bytes();
    while offset < bytes.len() {
        match bytes[offset] {
            b'\\' => {
                let start = offset;
                while bytes.get(offset) == Some(&b'\\') {
                    offset += 1;
                }
                escaped = (offset - start) % 2 == 1;
                continue;
            }
            b'|' if !escaped && code_ticks == 0 => pipes.push(offset),
            b'`' if !escaped => {
                let start = offset;
                while bytes.get(offset) == Some(&b'`') {
                    offset += 1;
                }
                let run = offset - start;
                code_ticks = if code_ticks == run {
                    0
                } else if code_ticks == 0 {
                    run
                } else {
                    code_ticks
                };
                escaped = false;
                continue;
            }
            _ => {}
        }
        if bytes[offset] != b'\\' {
            escaped = false;
        }
        offset += 1;
    }

    let mut start = 0;
    let mut slots = Vec::with_capacity(expected);
    for (index, pipe) in pipes.iter().copied().enumerate() {
        if index == 0 && pipe == 0 {
            start = pipe + 1;
        } else {
            slots.push(row.start + start..row.start + pipe);
            start = pipe + 1;
        }
    }
    if pipes.last().is_none_or(|pipe| *pipe + 1 != line.len()) {
        slots.push(row.start + start..row.end);
    }
    (slots.len() == expected).then_some(slots)
}

fn trim_cell_padding(source: &str, range: &Range<usize>) -> Range<usize> {
    let cell = &source[range.clone()];
    let start = cell.len() - cell.trim_start_matches([' ', '\t']).len();
    let end = cell.trim_end_matches([' ', '\t']).len();
    range.start + start..range.start + end.max(start)
}

fn block_kind_and_range(node: &Node, source: &str) -> Option<(BlockKind, Range<usize>)> {
    Some(match node {
        Node::Paragraph(value) => (BlockKind::Paragraph, position(&value.position)?),
        Node::Heading(value) => (
            BlockKind::Heading { level: value.depth },
            position(&value.position)?,
        ),
        Node::Blockquote(value) => (BlockKind::Blockquote, position(&value.position)?),
        Node::List(value) => (
            BlockKind::List {
                ordered: value.ordered,
                start: value.start,
            },
            position(&value.position)?,
        ),
        Node::ListItem(value) => (
            BlockKind::ListItem {
                checked: value.checked,
            },
            position(&value.position)?,
        ),
        Node::Code(value) => {
            let range = position(&value.position)?;
            let language = value.lang.as_deref().and_then(|lang| {
                let offset = source.get(range.clone())?.find(lang)?;
                Some(range.start + offset..range.start + offset + lang.len())
            });
            (BlockKind::Code { language }, range)
        }
        Node::Table(value) => (BlockKind::Table, position(&value.position)?),
        Node::TableRow(value) => (BlockKind::TableRow, position(&value.position)?),
        Node::TableCell(value) => (BlockKind::TableCell, position(&value.position)?),
        Node::ThematicBreak(value) => (BlockKind::ThematicBreak, position(&value.position)?),
        Node::Html(value) => (BlockKind::Html, position(&value.position)?),
        Node::MdxJsxFlowElement(value) => (BlockKind::Html, position(&value.position)?),
        Node::Yaml(value) if source.starts_with("---") => {
            (BlockKind::Frontmatter, position(&value.position)?)
        }
        Node::Toml(value) if source.starts_with("+++") => {
            (BlockKind::Frontmatter, position(&value.position)?)
        }
        _ => return None,
    })
}

fn position(position: &Option<markdown::unist::Position>) -> Option<Range<usize>> {
    let position = position.as_ref()?;
    Some(position.start.offset..position.end.offset)
}

fn collect_inline_marks(node: &Node, source: &str, marks: &mut Vec<InlineMark>) {
    match node {
        Node::Emphasis(value) => {
            add_mark(
                marks,
                InlineMarkKind::Emphasis,
                &value.position,
                child_range(&value.children),
            );
            collect_inline_children(&value.children, source, marks);
        }
        Node::Strong(value) => {
            add_mark(
                marks,
                InlineMarkKind::Strong,
                &value.position,
                child_range(&value.children),
            );
            collect_inline_children(&value.children, source, marks);
        }
        Node::Delete(value) => {
            add_mark(
                marks,
                InlineMarkKind::Strikethrough,
                &value.position,
                child_range(&value.children),
            );
            collect_inline_children(&value.children, source, marks);
        }
        Node::InlineCode(value) => add_literal_mark(
            marks,
            InlineMarkKind::Code,
            &value.position,
            source,
            &value.value,
        ),
        Node::InlineMath(value) => add_literal_mark(
            marks,
            InlineMarkKind::InlineMath,
            &value.position,
            source,
            &value.value,
        ),
        Node::Link(value) => {
            add_mark(
                marks,
                InlineMarkKind::Link {
                    destination: value.url.clone(),
                },
                &value.position,
                child_range(&value.children),
            );
            collect_inline_children(&value.children, source, marks);
        }
        Node::Image(value) => add_mark(
            marks,
            InlineMarkKind::Image {
                source: value.url.clone(),
                alt: value.alt.clone(),
            },
            &value.position,
            image_alt_range(&value.position, source, &value.alt),
        ),
        Node::Root(value) => collect_inline_children(&value.children, source, marks),
        Node::Blockquote(value) => collect_inline_children(&value.children, source, marks),
        Node::List(value) => collect_inline_children(&value.children, source, marks),
        Node::ListItem(value) => collect_inline_children(&value.children, source, marks),
        Node::Paragraph(value) => collect_inline_children(&value.children, source, marks),
        Node::Heading(value) => collect_inline_children(&value.children, source, marks),
        Node::Table(value) => collect_inline_children(&value.children, source, marks),
        Node::TableRow(value) => collect_inline_children(&value.children, source, marks),
        Node::TableCell(value) => collect_inline_children(&value.children, source, marks),
        _ => {}
    }
}

fn collect_inline_children(children: &[Node], source: &str, marks: &mut Vec<InlineMark>) {
    for child in children {
        collect_inline_marks(child, source, marks);
    }
}

fn add_mark(
    marks: &mut Vec<InlineMark>,
    kind: InlineMarkKind,
    position: &Option<markdown::unist::Position>,
    content_range: Option<Range<usize>>,
) {
    if let Some(syntax_range) = self::position(position)
        && let Some(range) = content_range
    {
        marks.push(InlineMark {
            kind,
            range,
            syntax_range,
        });
    }
}

fn child_range(children: &[Node]) -> Option<Range<usize>> {
    let first = children.first()?;
    let last = children.last()?;
    Some(node_position(first)?.start.offset..node_position(last)?.end.offset)
}

fn node_position(node: &Node) -> Option<&markdown::unist::Position> {
    match node {
        Node::Text(value) => value.position.as_ref(),
        Node::Emphasis(value) => value.position.as_ref(),
        Node::Strong(value) => value.position.as_ref(),
        Node::Delete(value) => value.position.as_ref(),
        Node::InlineCode(value) => value.position.as_ref(),
        Node::InlineMath(value) => value.position.as_ref(),
        Node::Link(value) => value.position.as_ref(),
        Node::Image(value) => value.position.as_ref(),
        _ => None,
    }
}

fn add_literal_mark(
    marks: &mut Vec<InlineMark>,
    kind: InlineMarkKind,
    position: &Option<markdown::unist::Position>,
    source: &str,
    value: &str,
) {
    let Some(syntax_range) = self::position(position) else {
        return;
    };
    let Some(range) = literal_range(source, &syntax_range, value) else {
        return;
    };
    marks.push(InlineMark {
        kind,
        range,
        syntax_range,
    });
}

fn literal_range(source: &str, syntax_range: &Range<usize>, value: &str) -> Option<Range<usize>> {
    let literal = source.get(syntax_range.clone())?;
    if value.is_empty() {
        return Some(syntax_range.start..syntax_range.start);
    }
    // The parsed `value` comes from the CJK-rewritten text, so a code span
    // holding full-width punctuation carries `一` where the source still has
    // `「` and a plain search finds nothing. Searching the rewritten literal
    // instead is exact: the rewrite preserves byte length, so the offset it
    // yields is valid against the original source.
    let relative_start = match literal.find(value) {
        Some(found) => found,
        None => crate::cjk::with_cjk_friendly_flanking(literal).find(value)?,
    };
    Some(syntax_range.start + relative_start..syntax_range.start + relative_start + value.len())
}

fn image_alt_range(
    position: &Option<markdown::unist::Position>,
    source: &str,
    alt: &str,
) -> Option<Range<usize>> {
    let syntax_range = self::position(position)?;
    literal_range(source, &syntax_range, alt)
}

/// Options controlling document find queries.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct FindOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
}

/// Finds all matching UTF-8 byte ranges in `source`.
pub fn find_matches(source: &str, query: &str, options: &FindOptions) -> Vec<Range<usize>> {
    if query.is_empty() {
        return Vec::new();
    }
    if options.regex {
        let pattern = if options.whole_word {
            format!(r"\b(?:{query})\b")
        } else {
            query.to_owned()
        };
        let re = match regex::RegexBuilder::new(&pattern)
            .case_insensitive(!options.case_sensitive)
            .build()
        {
            Ok(re) => re,
            Err(_) => return Vec::new(),
        };
        re.find_iter(source).map(|m| m.start()..m.end()).collect()
    } else if options.whole_word {
        let escaped = regex::escape(query);
        let pattern = format!(r"\b{escaped}\b");
        let re = match regex::RegexBuilder::new(&pattern)
            .case_insensitive(!options.case_sensitive)
            .build()
        {
            Ok(re) => re,
            Err(_) => return Vec::new(),
        };
        re.find_iter(source).map(|m| m.start()..m.end()).collect()
    } else if options.case_sensitive {
        source
            .match_indices(query)
            .map(|(start, _)| start..start + query.len())
            .collect()
    } else {
        let escaped = regex::escape(query);
        let re = match regex::RegexBuilder::new(&escaped)
            .case_insensitive(true)
            .build()
        {
            Ok(re) => re,
            Err(_) => return Vec::new(),
        };
        re.find_iter(source).map(|m| m.start()..m.end()).collect()
    }
}

/// Replaces a single match range with `replacement`.
pub fn replace_single_match(
    source: &str,
    range: Range<usize>,
    replacement: &str,
) -> Option<SourceEdit> {
    if range.start > range.end || range.end > source.len() {
        return None;
    }
    let after_end = range.start + replacement.len();
    Some(SourceEdit {
        range: range.clone(),
        replacement: replacement.to_owned(),
        selection_after: range.start..after_end,
    })
}

/// Replaces all `matches` with `replacement` in a single transactional edit.
pub fn replace_all_matches(
    source: &str,
    matches: &[Range<usize>],
    replacement: &str,
) -> Option<SourceEdit> {
    if matches.is_empty() {
        return None;
    }
    let first_start = matches.first()?.start;
    let last_end = matches.last()?.end;
    if first_start > last_end || last_end > source.len() {
        return None;
    }

    let mut result = String::new();
    let mut last_offset = first_start;
    for match_range in matches {
        if match_range.start < last_offset || match_range.end > source.len() {
            continue;
        }
        result.push_str(&source[last_offset..match_range.start]);
        result.push_str(replacement);
        last_offset = match_range.end;
    }
    result.push_str(&source[last_offset..last_end]);

    let selection_start = first_start;
    let selection_end = first_start + result.len();
    Some(SourceEdit {
        range: first_start..last_end,
        replacement: result,
        selection_after: selection_start..selection_end,
    })
}

/// Counts lines, characters, and words. Each CJK character counts as one word.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct DocumentMetrics {
    pub words: usize,
    pub lines: usize,
    pub characters: usize,
}

pub fn calculate_document_metrics(markdown: &str) -> DocumentMetrics {
    let lines = if markdown.is_empty() {
        0
    } else {
        markdown.split('\n').count()
    };
    let characters = markdown.chars().count();
    let mut words = 0;
    let mut in_word = false;
    for ch in markdown.chars() {
        if is_cjk(ch) {
            words += 1;
            in_word = false;
        } else if ch.is_alphanumeric() || ch == '\'' || ch == '’' || ch == '-' {
            if !in_word && ch.is_alphanumeric() {
                words += 1;
                in_word = true;
            }
        } else {
            in_word = false;
        }
    }
    DocumentMetrics {
        words,
        lines,
        characters,
    }
}

fn is_cjk(ch: char) -> bool {
    matches!(ch as u32,
        0x4E00..=0x9FFF | // CJK Unified Ideographs
        0x3400..=0x4DBF | // CJK Unified Ideographs Extension A
        0x20000..=0x2A6DF | // Extension B
        0xF900..=0xFAFF | // CJK Compatibility Ideographs
        0x3040..=0x309F | // Hiragana
        0x30A0..=0x30FF | // Katakana
        0xAC00..=0xD7AF   // Hangul Syllables
    )
}
