//! Markdown AST → HTML 发射器。
//!
//! ## 为什么要自己发射
//!
//! `comrak` 内置的 HTML 渲染器无法产出本项目需要的输出：导出 HTML 要保留
//! CodeMirror 风格的 `cm-md-marker` 语法标记（`<span class="cm-md-marker
//! cm-md-marker--bold">**</span>`），还要复刻本项目特有的标题 ID 分配与 legacy 别名规则。
//! 因此 comrak 只用于**解析**，HTML 由这里手写发射，格式逐字节对齐
//! `packages/compiler/src/emitter/html-emitter.ts`。
//!
//! ## 两遍结构
//!
//! 先构建中间表示（IR），在构建过程中按文档顺序分配标题 ID；再发射 HTML。
//! 之所以不直接单遍发射：legacy 别名必须让位给「另一个标题的真实 id」，
//! 而那需要先知道全文档所有真实 id。

use comrak::nodes::{AstNode, ListType, NodeMath, NodeTableRow, NodeValue, TableAlignment};
use comrak::{parse_document, Arena, Options};

use crate::callout::{callout_svg, default_callout_title};
use crate::directive::{split_directives, Segment};
use crate::escape::escape_html;
use crate::highlight::highlight_code;
use crate::math::render_math;
use crate::slug::{generate_legacy_heading_slug, HeadingSlugAllocator};
use crate::RenderOptions;

/// 行内节点。
enum Inline {
    Text(String),
    Bold(Vec<Inline>),
    Italic(Vec<Inline>),
    Strike(Vec<Inline>),
    /// `==highlight==`（Typora / Obsidian 事实标准，comrak 无原生支持）。
    Highlight(Vec<Inline>),
    Code(String),
    Math(String),
    Link {
        href: String,
        title: Option<String>,
        children: Vec<Inline>,
    },
    Image {
        src: String,
        alt: Option<String>,
        title: Option<String>,
    },
    /// 硬换行：保留**原文字面量**。
    ///
    /// TS 侧（marked）在这个配置下不把硬换行转成 `<br>`，而是原样保留
    /// `两个空格 + 换行` 或 `反斜杠 + 换行`。因此构建期就把原文切出来，
    /// 发射时直接输出，才能逐字节对齐。
    RawBreak(String),
}

/// 表格单元格。
struct Cell {
    align: TableAlignment,
    inlines: Vec<Inline>,
}

/// 列表项。
struct ListItem {
    task: Option<bool>,
    blocks: Vec<Block>,
}

/// 块级节点。
enum Block {
    Heading {
        level: u8,
        id: String,
        plain: String,
        inlines: Vec<Inline>,
    },
    Paragraph(Vec<Inline>),
    Code {
        lang: Option<String>,
        code: String,
    },
    Math(String),
    Blockquote(Vec<Block>),
    /// Callout：GFM Alert（`> [!NOTE]`）与 Container Directive（`:::tip`）共用。
    Callout {
        kind: String,
        title: String,
        blocks: Vec<Block>,
    },
    Table {
        header: Vec<Cell>,
        rows: Vec<Vec<Cell>>,
    },
    List {
        ordered: bool,
        /// 文档里存在 GFM 任务列表项（comrak 的 `is_task_list`）。
        is_task_list: bool,
        start: Option<u64>,
        /// 紧凑列表：列表项内的段落不包 `<p>`，与 marked 的 tight 语义一致。
        tight: bool,
        items: Vec<ListItem>,
    },
    ThematicBreak,
    Html(String),
}

/// 构建 comrak 解析选项。
///
/// `cjk_friendly_emphasis` 与 `math_dollars` 是本项目的既有语法能力，必须与
/// TS 侧 `marked-cjk-friendly` + 自定义 math 扩展保持同一语义。
fn build_options() -> Options<'static> {
    let mut options = Options::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.tasklist = true;
    options.extension.autolink = true;
    options.extension.alerts = true;
    options.extension.cjk_friendly_emphasis = true;
    options.extension.math_dollars = true;
    options.extension.front_matter_delimiter = Some("---".to_string());
    options.render.hardbreaks = false;
    options
}

/// 按 comrak 的 `Sourcepos` 切片原文。
///
/// 列号默认按 UTF-8 **字节** 计数，因此这里按字节偏移切片，不能按字符。
struct SourceText<'a> {
    markdown: &'a str,
    line_starts: Vec<usize>,
}

impl<'a> SourceText<'a> {
    fn new(markdown: &'a str) -> Self {
        let mut line_starts = vec![0usize];
        for (index, byte) in markdown.bytes().enumerate() {
            if byte == b'\n' {
                line_starts.push(index + 1);
            }
        }
        Self {
            markdown,
            line_starts,
        }
    }

    /// 把 (行, 列) 转为字节偏移（行列均 1-based）。
    fn offset(&self, position: comrak::nodes::LineColumn) -> usize {
        let line_index = position
            .line
            .saturating_sub(1)
            .min(self.line_starts.len() - 1);
        self.line_starts[line_index] + position.column.saturating_sub(1)
    }

    /// 切出 [start, end] 区间（含 end 位置的字符）。
    fn slice(&self, start: comrak::nodes::LineColumn, end: comrak::nodes::LineColumn) -> &'a str {
        let from = self.offset(start).min(self.markdown.len());
        // end 是「最后一个字符」的位置，而不是 end-exclusive 偏移。
        let to = (self.offset(end) + 1).min(self.markdown.len());
        if from >= to {
            return "";
        }
        self.markdown.get(from..to).unwrap_or("")
    }
}

/// 切出两个 sourcepos 之间的原文，用于还原硬换行的字面量。
fn slice_between(
    source: &SourceText<'_>,
    from: comrak::nodes::LineColumn,
    to: comrak::nodes::LineColumn,
) -> String {
    let start = (source.offset(from) + 1).min(source.markdown.len());
    let end = source.offset(to).min(source.markdown.len());
    if start >= end {
        return String::from("\n");
    }
    source
        .markdown
        .get(start..end)
        .map(str::to_string)
        .unwrap_or_else(|| String::from("\n"))
}

/// 空文档的占位输出（与 TS 侧 `renderStaticHtml` 的早退分支逐字一致）。
const EMPTY_DOCUMENT_HTML: &str =
    "<p style=\"color: var(--theme-muted, #86868b); font-style: italic;\">空文档 (Empty document)</p>";

/// 渲染入口。
pub(crate) fn render(markdown: &str, options: &RenderOptions) -> String {
    // 与 TS 侧一致：空白文档不进入解析器，直接返回占位段落。
    if markdown.trim().is_empty() {
        return EMPTY_DOCUMENT_HTML.to_string();
    }

    let markers = options.markers();
    let mut allocator = HeadingSlugAllocator::default();
    let blocks = build_document(markdown, &mut allocator);

    let real_ids = collect_heading_ids(&blocks);
    let mut emitted_aliases = std::collections::HashSet::new();
    let mut out = String::new();
    for block in &blocks {
        emit_block(block, markers, &real_ids, &mut emitted_aliases, &mut out);
    }
    out
}

/// 按 `:::` 分段构建整个文档。
///
/// 标题 ID 分配器跨片段共享，保证嵌套容器内的标题与外部标题按**文档顺序**竞争
/// 同一套 slug（这是 `nested-heading-uniqueness` 契约的要求）。
fn build_document(markdown: &str, allocator: &mut HeadingSlugAllocator) -> Vec<Block> {
    let mut blocks = Vec::new();
    for segment in split_directives(markdown) {
        match segment {
            Segment::Markdown(text) => {
                if text.trim().is_empty() {
                    continue;
                }
                blocks.extend(parse_markdown_blocks(text, allocator));
            }
            Segment::Directive { kind, title, body } => {
                let inner = build_document(&body, allocator);
                blocks.push(Block::Callout {
                    title: if title.is_empty() {
                        default_callout_title(&kind).to_string()
                    } else {
                        title
                    },
                    kind,
                    blocks: inner,
                });
            }
        }
    }
    blocks
}

/// 用 comrak 解析一段 Markdown 并构建块序列。
fn parse_markdown_blocks(markdown: &str, allocator: &mut HeadingSlugAllocator) -> Vec<Block> {
    let source = SourceText::new(markdown);
    let arena = Arena::new();
    let parsed = parse_document(&arena, markdown, &build_options());
    build_blocks(parsed, allocator, &source)
}

/// 遍历 AST 构建块序列，过程中按文档顺序分配标题 ID。
fn build_blocks<'a>(
    root: &'a AstNode<'a>,
    allocator: &mut HeadingSlugAllocator,
    source: &SourceText<'_>,
) -> Vec<Block> {
    let mut blocks = Vec::new();
    for node in root.children() {
        build_block(node, allocator, source, &mut blocks);
    }
    blocks
}

/// 构建单个块节点（可能向 `out` 追加多个块）。
fn build_block<'a>(
    node: &'a AstNode<'a>,
    allocator: &mut HeadingSlugAllocator,
    source: &SourceText<'_>,
    out: &mut Vec<Block>,
) {
    let value = node.data.borrow().value.clone();
    match value {
        NodeValue::Heading(heading) => {
            let raw = heading_raw_text(node, source);
            let plain = strip_html_tags(&raw).trim().to_string();
            let id = allocator.allocate(&plain);
            out.push(Block::Heading {
                level: heading.level,
                id,
                plain,
                inlines: build_inlines(node, source),
            });
        }
        NodeValue::Paragraph => {
            // 独占一行的 `$$...$$` 在 comrak 里是「只含一个 display math 的段落」，
            // TS 侧则归约为块级数学。这里做同样的提升。
            match sole_display_math(node) {
                DisplayMath::Block(literal) => {
                    out.push(Block::Math(literal));
                    return;
                }
                DisplayMath::SingleLineText(literal) => {
                    // JS 侧（marked 自定义扩展）对单行 `$$x$$` 的处理是：
                    // 既不构成块级数学（math_block 要求 `$$` 后紧跟换行），
                    // 也不构成行内数学（math_inline 要求单个 `$`），
                    // 最终输出为纯文本，且两个 `$$` 之间被插入一个换行。
                    out.push(Block::Paragraph(vec![Inline::Text(format!(
                        "$${literal}\n$$"
                    ))]));
                    return;
                }
                DisplayMath::None => {}
            }
            out.push(Block::Paragraph(build_inlines(node, source)));
        }
        NodeValue::CodeBlock(code) => {
            let lang = code
                .info
                .split_whitespace()
                .next()
                .map(str::to_string)
                .filter(|value| !value.is_empty());
            // comrak 的 CodeBlock literal 含结尾换行，TS 侧（marked）不含，
            // 直接 trim_end 会误删代码自身的空行，因此只去掉一个换行序列。
            let literal = code.literal.as_str();
            let trimmed = literal
                .strip_suffix("\r\n")
                .or_else(|| literal.strip_suffix('\n'))
                .unwrap_or(literal);
            out.push(Block::Code {
                lang,
                code: trimmed.to_string(),
            });
        }
        NodeValue::Math(math) => {
            out.push(Block::Math(math.literal.clone()));
        }
        NodeValue::Alert(alert) => {
            // comrak 的 `alerts` 走 `> [!NOTE]` 语法，与 TS 侧 callout 同源。
            let kind = alert_kind(&alert.alert_type);
            let mut inner = Vec::new();
            for child in node.children() {
                build_block(child, allocator, source, &mut inner);
            }
            out.push(Block::Callout {
                title: alert
                    .title
                    .clone()
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| default_callout_title(&kind).to_string()),
                kind,
                blocks: inner,
            });
        }
        NodeValue::BlockQuote => {
            let mut inner = Vec::new();
            for child in node.children() {
                build_block(child, allocator, source, &mut inner);
            }
            out.push(Block::Blockquote(inner));
        }
        NodeValue::List(list) => {
            let mut items = Vec::new();
            for item in node.children() {
                items.push(build_list_item(item, allocator, source));
            }
            out.push(Block::List {
                ordered: matches!(list.list_type, ListType::Ordered),
                is_task_list: list.is_task_list,
                start: if matches!(list.list_type, ListType::Ordered) && list.start != 1 {
                    Some(list.start as u64)
                } else {
                    None
                },
                tight: list.tight,
                items,
            });
        }
        NodeValue::Table(table) => {
            let alignments = table.alignments.clone();
            let mut header_cells: Vec<Cell> = Vec::new();
            let mut body_rows: Vec<Vec<Cell>> = Vec::new();
            for row in node.children() {
                let is_header = matches!(
                    row.data.borrow().value,
                    NodeValue::TableRow(NodeTableRow { header: true, .. })
                );
                let mut cells = Vec::new();
                for (index, cell) in row.children().enumerate() {
                    cells.push(Cell {
                        align: alignments
                            .get(index)
                            .copied()
                            .unwrap_or(TableAlignment::None),
                        inlines: build_inlines(cell, source),
                    });
                }
                if is_header {
                    header_cells = cells;
                } else {
                    body_rows.push(cells);
                }
            }
            out.push(Block::Table {
                header: header_cells,
                rows: body_rows,
            });
        }
        NodeValue::ThematicBreak(_) => out.push(Block::ThematicBreak),
        NodeValue::HtmlBlock(html) => out.push(Block::Html(html.literal.clone())),
        // FrontMatter 不参与 HTML 输出（与 TS 侧一致：frontmatter 只作为元数据提取）。
        _ => {
            for child in node.children() {
                build_block(child, allocator, source, out);
            }
        }
    }
}

/// 构建列表项。
///
/// comrak 会把**列表项节点自身**的 `NodeValue` 替换为 `TaskItem`（见其 parser 的
/// `grandparent.data_mut().value = NodeValue::TaskItem(..)`），而不是挂一个子节点。
/// 因此任务标记必须在 `node` 自身查，而不是遍历 children。
fn build_list_item<'a>(
    node: &'a AstNode<'a>,
    allocator: &mut HeadingSlugAllocator,
    source: &SourceText<'_>,
) -> ListItem {
    let task = match &node.data.borrow().value {
        NodeValue::TaskItem(item) => Some(item.symbol.is_some()),
        _ => None,
    };

    let mut blocks = Vec::new();
    for child in node.children() {
        build_block(child, allocator, source, &mut blocks);
    }

    ListItem { task, blocks }
}

/// 取标题的**原文**行内文本（含 `**` 等标记，仅剥掉 HTML 标签前的原始切片）。
///
/// 必须用原文而不是渲染后的纯文本：TS 侧的 `data-heading-text` 输出的是
/// `h.text`（marked 的行内源码），保留 `**加粗**` 这类标记；
/// 而 `id` 才会经过 `slugifyHeading` 进一步剥离行内语法。
fn heading_raw_text<'a>(node: &'a AstNode<'a>, source: &SourceText<'_>) -> String {
    let children: Vec<&AstNode<'_>> = node.children().collect();
    let (Some(first), Some(last)) = (children.first(), children.last()) else {
        return String::new();
    };
    let start = first.data.borrow().sourcepos.start;
    let end = last.data.borrow().sourcepos.end;
    source.slice(start, end).to_string()
}

/// 剥离 HTML 标签。
fn strip_html_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut depth = 0usize;
    for ch in text.chars() {
        match ch {
            '<' => depth += 1,
            '>' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out
}

/// 构建行内序列。
fn build_inlines<'a>(node: &'a AstNode<'a>, source: &SourceText<'_>) -> Vec<Inline> {
    fold_highlights(build_raw_inlines(node, source))
}

/// 把行内序列里的 `==...==` 折叠成 [`Inline::Highlight`]。
///
/// 必须**跨兄弟节点**处理：TS 侧 tokenizer 对 `==` 内部重新做 `inlineTokens`，
/// 因此 `==带 **加粗** 的嵌套==` 里，`==带 ` 与 ` 的嵌套==` 是两段 Text、
/// 中间夹着 Strong。只在单个 Text 内配对会漏掉这种嵌套形态。
fn fold_highlights(inlines: Vec<Inline>) -> Vec<Inline> {
    let mut result: Vec<Inline> = Vec::new();
    // 已开启高亮时，收集尚未闭合的内部节点。
    let mut pending: Option<Vec<Inline>> = None;

    for inline in inlines {
        match inline {
            Inline::Text(text) => {
                let mut rest = text.as_str();
                while !rest.is_empty() {
                    let delimiter = rest.find("==");
                    let Some(position) = delimiter else {
                        push_inline(&mut result, &mut pending, Inline::Text(rest.to_string()));
                        rest = "";
                        break;
                    };

                    let before = &rest[..position];
                    let after = &rest[position + 2..];

                    if pending.is_some() {
                        // 闭合：闭合前一个字符必须非空白。
                        if before.ends_with(|ch: char| ch.is_whitespace()) {
                            // 不是有效闭合，把 `==` 当字面量继续。
                            let literal = format!("{before}==");
                            push_inline(&mut result, &mut pending, Inline::Text(literal));
                            rest = after;
                            continue;
                        }
                        if !before.is_empty() {
                            push_inline(
                                &mut result,
                                &mut pending,
                                Inline::Text(before.to_string()),
                            );
                        }
                        let children = pending.take().unwrap_or_default();
                        result.push(Inline::Highlight(children));
                        rest = after;
                        continue;
                    }

                    // 开启：`==` 之后必须是「非空白且非 `=`」。
                    let next_char = after.chars().next();
                    match next_char {
                        Some(ch) if !ch.is_whitespace() && ch != '=' => {
                            if !before.is_empty() {
                                result.push(Inline::Text(before.to_string()));
                            }
                            pending = Some(Vec::new());
                            rest = after;
                        }
                        _ => {
                            let literal = format!("{before}==");
                            result.push(Inline::Text(literal));
                            rest = after;
                        }
                    }
                }
            }
            other => push_inline(&mut result, &mut pending, other),
        }
    }

    // 未闭合：把待定内容原样放回，并把开启的 `==` 还原为字面量。
    if let Some(children) = pending {
        result.push(Inline::Text("==".to_string()));
        result.extend(children);
    }

    merge_adjacent_text(result)
}

/// 把节点压入当前容器：已开启高亮则进 pending，否则进结果。
fn push_inline(result: &mut Vec<Inline>, pending: &mut Option<Vec<Inline>>, inline: Inline) {
    match pending {
        Some(children) => children.push(inline),
        None => result.push(inline),
    }
}

/// 合并相邻文本节点，避免切分产生碎片（影响后续序列化稳定性）。
fn merge_adjacent_text(inlines: Vec<Inline>) -> Vec<Inline> {
    let mut result: Vec<Inline> = Vec::with_capacity(inlines.len());
    for inline in inlines {
        match (result.last_mut(), inline) {
            (Some(Inline::Text(previous)), Inline::Text(next)) => previous.push_str(&next),
            (_, other) => result.push(other),
        }
    }
    result
}

/// 构建未做高亮折叠的行内序列。
fn build_raw_inlines<'a>(node: &'a AstNode<'a>, source: &SourceText<'_>) -> Vec<Inline> {
    let children: Vec<&AstNode<'_>> = node.children().collect();
    let mut inlines = Vec::new();
    for (index, child) in children.iter().enumerate() {
        // 硬换行需要「前一兄弟结束 → 后一兄弟开始」之间的原文，才能还原
        // marked 保留的字面量（`两个空格 + 换行` / `反斜杠 + 换行`）。
        if matches!(child.data.borrow().value, NodeValue::LineBreak) {
            let from = index
                .checked_sub(1)
                .map(|prev| children[prev].data.borrow().sourcepos.end)
                .or_else(|| Some(child.data.borrow().sourcepos.start));
            let to = children
                .get(index + 1)
                .map(|next| next.data.borrow().sourcepos.start)
                .unwrap_or_else(|| child.data.borrow().sourcepos.end);
            let raw = match from {
                Some(from) => slice_between(source, from, to),
                None => String::from("\n"),
            };
            inlines.push(Inline::RawBreak(raw));
            continue;
        }
        build_inline(child, source, &mut inlines);
    }
    inlines
}

fn build_inline<'a>(node: &'a AstNode<'a>, source: &SourceText<'_>, out: &mut Vec<Inline>) {
    let value = node.data.borrow().value.clone();
    match value {
        NodeValue::Text(text) => out.push(Inline::Text(text.to_string())),
        NodeValue::Code(code) => out.push(Inline::Code(code.literal.clone())),
        NodeValue::HtmlInline(html) => {
            // 与 TS 侧一致：**行内** HTML 被当作文本转义（块级 HTML 才原样透传）。
            out.push(Inline::Text(html));
        }
        NodeValue::Strong(_) => out.push(Inline::Bold(build_inlines(node, source))),
        NodeValue::Emph(_) => out.push(Inline::Italic(build_inlines(node, source))),
        NodeValue::Strikethrough(_) => out.push(Inline::Strike(build_inlines(node, source))),
        NodeValue::Link(link) => out.push(Inline::Link {
            href: link.url.clone(),
            title: normalize_title(&link.title),
            children: build_inlines(node, source),
        }),
        NodeValue::Image(link) => out.push(Inline::Image {
            src: link.url.clone(),
            alt: normalize_title(&collect_plain_text(node)),
            title: normalize_title(&link.title),
        }),
        NodeValue::Math(NodeMath { literal, .. }) => out.push(Inline::Math(literal)),
        NodeValue::SoftBreak => out.push(Inline::Text("\n".to_string())),
        _ => {
            for child in node.children() {
                build_inline(child, source, out);
            }
        }
    }
}

/// 空字符串视为「无 title / 无 alt」，与 TS 侧的真值判断一致。
fn normalize_title(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

/// 收集节点的纯文本（用于图片 alt）。
fn collect_plain_text<'a>(node: &'a AstNode<'a>) -> String {
    let mut out = String::new();
    for child in node.children() {
        let value = child.data.borrow().value.clone();
        match value {
            NodeValue::Text(text) => out.push_str(&text),
            NodeValue::Code(code) => out.push_str(&code.literal),
            _ => out.push_str(&collect_plain_text(child)),
        }
    }
    out
}

/// 收集全文档真实标题 ID（含列表项/引用块内的嵌套标题）。
fn collect_heading_ids(blocks: &[Block]) -> std::collections::HashSet<String> {
    let mut ids = std::collections::HashSet::new();
    collect_ids_recursive(blocks, &mut ids);
    ids
}

fn collect_ids_recursive(blocks: &[Block], ids: &mut std::collections::HashSet<String>) {
    for block in blocks {
        match block {
            Block::Heading { id, .. } => {
                ids.insert(id.clone());
            }
            Block::Blockquote(inner) => collect_ids_recursive(inner, ids),
            Block::Callout { blocks, .. } => collect_ids_recursive(blocks, ids),
            Block::List { items, .. } => {
                for item in items {
                    collect_ids_recursive(&item.blocks, ids);
                }
            }
            _ => {}
        }
    }
}

/// 发射行内节点。
fn emit_inlines(inlines: &[Inline], markers: bool, out: &mut String) {
    for inline in inlines {
        emit_inline(inline, markers, out);
    }
}

fn emit_inline(inline: &Inline, markers: bool, out: &mut String) {
    match inline {
        Inline::Text(text) => out.push_str(&escape_html(text)),
        Inline::Code(code) => {
            let escaped = escape_html(code);
            if markers {
                out.push_str("<span class=\"cm-md-marker cm-md-marker--inline-code\">`</span>");
                out.push_str("<code class=\"cm-md-inline cm-md-inline-code\">");
                out.push_str(&escaped);
                out.push_str("</code>");
                out.push_str("<span class=\"cm-md-marker cm-md-marker--inline-code\">`</span>");
            } else {
                out.push_str("<code>");
                out.push_str(&escaped);
                out.push_str("</code>");
            }
        }
        Inline::Bold(children) => emit_wrapped(
            children,
            markers,
            "bold",
            "**",
            "<strong class=\"cm-md-inline cm-md-bold\">",
            "</strong>",
            out,
        ),
        Inline::Italic(children) => emit_wrapped(
            children,
            markers,
            "italic",
            "*",
            "<em class=\"cm-md-inline cm-md-italic\">",
            "</em>",
            out,
        ),
        Inline::Strike(children) => emit_wrapped(
            children,
            markers,
            "strikethrough",
            "~~",
            "<del class=\"cm-md-inline cm-md-strikethrough\">",
            "</del>",
            out,
        ),
        Inline::Highlight(children) => emit_wrapped(
            children,
            markers,
            "highlight",
            "==",
            "<mark class=\"cm-md-inline cm-md-highlight\">",
            "</mark>",
            out,
        ),
        Inline::Link {
            href,
            title,
            children,
        } => {
            out.push_str("<a href=\"");
            out.push_str(&escape_html(href));
            out.push('"');
            if let Some(title) = title {
                out.push_str(" title=\"");
                out.push_str(&escape_html(title));
                out.push('"');
            }
            out.push('>');
            emit_inlines(children, markers, out);
            out.push_str("</a>");
        }
        Inline::Image { src, alt, title } => {
            out.push_str("<img src=\"");
            out.push_str(&escape_html(src));
            out.push('"');
            if let Some(alt) = alt {
                out.push_str(" alt=\"");
                out.push_str(&escape_html(alt));
                out.push('"');
            }
            if let Some(title) = title {
                out.push_str(" title=\"");
                out.push_str(&escape_html(title));
                out.push('"');
            }
            out.push_str(" />");
        }
        Inline::Math(source) => {
            let rendered = render_math(source, false);
            out.push_str("<span class=\"cm-md-math-inline math-inline\">");
            out.push_str(&rendered.html);
            out.push_str("</span>");
        }
        Inline::RawBreak(raw) => out.push_str(&escape_html(raw)),
    }
}

/// 发射带语法标记的包裹型行内节点（加粗/斜体/删除线共用一个模板）。
fn emit_wrapped(
    children: &[Inline],
    markers: bool,
    kind: &str,
    marker: &str,
    open_tag: &str,
    close_tag: &str,
    out: &mut String,
) {
    if markers {
        out.push_str(&format!(
            "<span class=\"cm-md-marker cm-md-marker--{kind}\">{marker}</span>"
        ));
        out.push_str(open_tag);
        emit_inlines(children, markers, out);
        out.push_str(close_tag);
        out.push_str(&format!(
            "<span class=\"cm-md-marker cm-md-marker--{kind}\">{marker}</span>"
        ));
    } else {
        emit_inlines(children, markers, out);
    }
}

/// 发射块级节点。
fn emit_block(
    block: &Block,
    markers: bool,
    real_ids: &std::collections::HashSet<String>,
    emitted_aliases: &mut std::collections::HashSet<String>,
    out: &mut String,
) {
    match block {
        Block::Heading {
            level,
            id,
            plain,
            inlines,
        } => {
            out.push_str(&format!("<h{level} id=\""));
            out.push_str(&escape_html(id));
            out.push_str("\" data-heading-text=\"");
            out.push_str(&escape_html(plain));
            out.push_str("\">");

            // legacy 别名：只在「与自身 id 不同」「不与任何标题真实 id 冲突」
            // 「尚未输出过同名别名」三个条件都成立时输出。
            let legacy = generate_legacy_heading_slug(plain);
            if !legacy.is_empty()
                && legacy != *id
                && !real_ids.contains(&legacy)
                && !emitted_aliases.contains(&legacy)
            {
                emitted_aliases.insert(legacy.clone());
                out.push_str("<a id=\"");
                out.push_str(&escape_html(&legacy));
                out.push_str("\" class=\"heading-anchor-alias\" aria-hidden=\"true\"></a>");
            }

            emit_inlines(inlines, markers, out);
            out.push_str(&format!("</h{level}>\n"));
        }
        Block::Paragraph(inlines) => {
            out.push_str("<p>");
            emit_inlines(inlines, markers, out);
            out.push_str("</p>\n");
        }
        Block::Code { lang, code } => {
            let highlighted = highlight_code(code, lang.as_deref());
            out.push_str("<pre><code class=\"hljs");
            if !highlighted.language.is_empty() {
                out.push_str(" language-");
                out.push_str(&escape_html(&highlighted.language));
            }
            out.push_str("\">");
            out.push_str(&highlighted.html);
            out.push_str("</code></pre>\n");
        }
        Block::Math(source) => {
            let rendered = render_math(source, true);
            out.push_str("<div class=\"cm-md-math-block math-display\">");
            out.push_str(&rendered.html);
            out.push_str("</div>\n");
        }
        Block::Blockquote(inner) => {
            out.push_str("<blockquote>\n");
            for child in inner {
                emit_block(child, markers, real_ids, emitted_aliases, out);
            }
            out.push_str("</blockquote>\n");
        }
        Block::Callout {
            kind,
            title,
            blocks,
        } => {
            let escaped_kind = escape_html(kind);
            out.push_str("<div class=\"cm-callout cm-callout--");
            out.push_str(&escaped_kind);
            out.push_str(
                "\">\n  <div class=\"cm-callout__header\">\n    <span class=\"cm-callout__icon\">",
            );
            out.push_str(callout_svg(kind));
            out.push_str("</span>\n    <strong class=\"cm-callout__title\">");
            out.push_str(&escape_html(title));
            out.push_str("</strong>\n  </div>\n  ");

            if blocks.is_empty() {
                out.push('\n');
            } else {
                let mut inner = String::new();
                for child in blocks {
                    emit_block(child, markers, real_ids, emitted_aliases, &mut inner);
                }
                out.push_str("<div class=\"cm-callout__body\">");
                out.push_str(&inner);
                out.push_str("</div>\n");
            }
            out.push_str("</div>\n");
        }
        Block::Table { header, rows } => {
            out.push_str("<table>\n<thead>\n<tr>\n");
            for cell in header {
                emit_table_cell("th", cell, markers, out);
            }
            out.push_str("</tr>\n</thead>\n<tbody>\n");
            for row in rows {
                out.push_str("<tr>\n");
                for cell in row {
                    emit_table_cell("td", cell, markers, out);
                }
                out.push_str("</tr>\n");
            }
            out.push_str("</tbody>\n</table>\n");
        }
        Block::List {
            ordered,
            is_task_list,
            start,
            tight,
            items,
        } => {
            let tag = if *ordered { "ol" } else { "ul" };
            out.push('<');
            out.push_str(tag);
            if *is_task_list {
                out.push_str(" class=\"contains-task-list\"");
            }
            if let Some(start) = start {
                out.push_str(&format!(" start=\"{start}\""));
            }
            out.push_str(">\n");
            for item in items {
                emit_list_item(item, *tight, markers, real_ids, emitted_aliases, out);
            }
            out.push_str("</");
            out.push_str(tag);
            out.push_str(">\n");
        }
        Block::ThematicBreak => out.push_str("<hr />\n"),
        Block::Html(html) => out.push_str(html),
    }
}

fn emit_table_cell(tag: &str, cell: &Cell, markers: bool, out: &mut String) {
    out.push_str("  <");
    out.push_str(tag);
    let value = match cell.align {
        TableAlignment::Left => "left",
        TableAlignment::Center => "center",
        TableAlignment::Right => "right",
        TableAlignment::None => "",
    };
    if !value.is_empty() {
        out.push_str(" style=\"text-align: ");
        out.push_str(value);
        out.push('"');
    }
    out.push('>');
    emit_inlines(&cell.inlines, markers, out);
    out.push_str("</");
    out.push_str(tag);
    out.push_str(">\n");
}

fn emit_list_item(
    item: &ListItem,
    tight: bool,
    markers: bool,
    real_ids: &std::collections::HashSet<String>,
    emitted_aliases: &mut std::collections::HashSet<String>,
    out: &mut String,
) {
    match item.task {
        Some(checked) => {
            out.push_str("<li class=\"task-list-item\"><input type=\"checkbox\"");
            if checked {
                out.push_str(" checked=\"\" disabled=\"\"");
            } else {
                out.push_str(" disabled=\"\"");
            }
            out.push('>');
            emit_list_item_body(&item.blocks, tight, markers, real_ids, emitted_aliases, out);
            out.push_str("</li>\n");
        }
        None => {
            out.push_str("<li>");
            emit_list_item_body(&item.blocks, tight, markers, real_ids, emitted_aliases, out);
            out.push_str("</li>\n");
        }
    }
}

/// 发射列表项主体。
///
/// 紧凑列表下，段落不包 `<p>`（直接发行内）——这是 GFM tight list 语义，
/// 与 marked 的 tight 行为一致。首段落需要与前面的 `>` 或 `<input>` 紧贴，
/// 因此不额外插空格。
fn emit_list_item_body(
    blocks: &[Block],
    tight: bool,
    markers: bool,
    real_ids: &std::collections::HashSet<String>,
    emitted_aliases: &mut std::collections::HashSet<String>,
    out: &mut String,
) {
    let mut first = true;
    for block in blocks {
        if tight {
            if let Block::Paragraph(inlines) = block {
                // 任务列表项：`<input>` 之后需要一个空格再接正文。
                if first && out.ends_with('>') && !out.ends_with("<li>") {
                    out.push(' ');
                }
                emit_inlines(inlines, markers, out);
                first = false;
                continue;
            }
        }
        emit_block(block, markers, real_ids, emitted_aliases, out);
        first = false;
    }
}

/// comrak AlertType → 本项目 callout 类型字符串。
fn alert_kind(kind: &comrak::nodes::AlertType) -> String {
    use comrak::nodes::AlertType;
    match kind {
        AlertType::Note => "note",
        AlertType::Tip => "tip",
        AlertType::Important => "important",
        AlertType::Warning => "warning",
        AlertType::Caution => "caution",
        // AlertType 是非穷尽枚举，新增类型按 warning 兜底而不是 panic。
        _ => "warning",
    }
    .to_string()
}

/// 若段落只包含一个 display 模式的行内数学，返回其字面量。
///
/// comrak 的 `math_dollars` 把 `$$x$$` 解析为 `NodeValue::Math { display_math: true }`
/// 并挂在 `Paragraph` 下；TS 侧（marked 自定义扩展）则把它当成独立的块级数学 token。
/// 段落里唯一数学节点的归类。
enum DisplayMath {
    /// 跨行的 `$$ ... $$`：块级数学。
    Block(String),
    /// 单行 `$$x$$`：JS 侧降级为纯文本。
    SingleLineText(String),
    /// 不是「只含一个数学节点」的段落。
    None,
}

fn sole_display_math<'a>(node: &'a AstNode<'a>) -> DisplayMath {
    let children: Vec<&AstNode<'_>> = node.children().collect();
    if children.len() != 1 {
        return DisplayMath::None;
    }
    let value = children[0].data.borrow().value.clone();
    let sourcepos = children[0].data.borrow().sourcepos;
    match value {
        // TS 侧的 math_block 扩展要求 `$$` 之后**紧跟换行**（`^\$\$[\r\n]+`），
        // 因此单行 `$$E=mc^2$$` 在 JS 侧只是普通段落文本，不是块级数学。
        // 用「源码是否跨行」来区分这两种形态。
        NodeValue::Math(math) if math.display_math => {
            if sourcepos.start.line != sourcepos.end.line {
                DisplayMath::Block(math.literal)
            } else {
                DisplayMath::SingleLineText(math.literal)
            }
        }
        _ => DisplayMath::None,
    }
}
