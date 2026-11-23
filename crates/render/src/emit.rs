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

use comrak::nodes::{AstNode, ListType, NodeTableRow, NodeValue, TableAlignment};
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
    /// 任务标记的原始字符（`x` / `X` / 空格）。
    ///
    /// 松散列表需要把它还原成字面量 `[x] `——marked 只在 tight 列表里剥掉前缀。
    task_symbol: Option<char>,
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
    Html {
        literal: String,
        /// 源码中本块结束行与下一块起始行之间是否**没有空行**。
        ///
        /// marked 的 html token 保留块内换行；块与块之间是否保留换行取决于源码间距：
        /// - 无空行分隔 → 保留换行（`<!-- c -->\n<pre>…`）
        /// - 有空行分隔 → 去掉换行（`<!-- c --><pre>…`）
        ///
        /// comrak 的 HtmlBlock literal 总是带尾换行，因此必须用源码间距来决定去留。
        tight_to_next: bool,
    },
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
    // GFM 裸链接：`name@version` 这类也会被识别为 mailto 链接（与 marked 一致）。
    options.extension.alerts = true;
    options.extension.cjk_friendly_emphasis = true;
    options.extension.math_dollars = true;
    // 独立成行的 `$$` 块（含跨空行）需要 block 变体；仅开 `math_dollars` 时
    // comrak 会把 `$$\na\n\nb\n$$` 拆成两个段落。
    options.extension.math_dollars_block = true;
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

    // 解析前把「comrak 会吃掉、但 TS 侧保留为可见文本」的片段保护起来
    // （引用定义行、BOM 首行）。详见 preprocess.rs。
    let preprocessed = crate::preprocess::preprocess(markdown);

    let mut allocator = HeadingSlugAllocator::default();
    let blocks = build_document(&preprocessed.markdown, &mut allocator);

    let real_ids = collect_heading_ids(&blocks);
    let mut emitted_aliases = std::collections::HashSet::new();
    let mut out = String::new();
    for block in blocks.iter() {
        emit_block(block, markers, &real_ids, &mut emitted_aliases, &mut out);
    }

    let restored = restore_placeholders(out, &preprocessed.restore);
    replicate_quad_dollar(&restored)
}

/// 把占位符还原为原始字面量。
///
/// 占位符会被转义吗？不会——它由私用区字符与 ASCII 数字组成，
/// `escape_html` 不触碰它们，因此可以直接按字面量替换。
/// 复刻 TS 对行内 `$$$$` 的怪异切分。
///
/// marked 的 `math_block` 扩展 `start()` 命中行内的 `$$`，把文本切成
/// `$` + `$` + `$$`（各占一行）。这是 TS 侧的既有行为，为字节级一致必须复刻。
/// 只作用于**段落文本**，不影响代码块与已有公式。
fn replicate_quad_dollar(html: &str) -> String {
    // TS 输出 `a $$$$ b` → `a \n$\n$\n$$ b`：`$$$$` 前的空格保留，
    // 且第一个 `$` 之前插入换行。
    html.replace("$$$$", "\n$\n$\n$$")
}

fn restore_placeholders(mut html: String, restore: &[crate::preprocess::RestoreItem]) -> String {
    // 定义副本注释只服务于 comrak 的引用解析，不能出现在输出里。
    // 它独占一行（comrak 当作 HtmlBlock），移除后会残留一个换行，需一并清掉。
    while let Some(start) = html.find("<!--md-def:") {
        match html[start..].find("-->") {
            Some(offset) => {
                let end = start + offset + 3;
                let mut strip_to = end;
                if html[end..].starts_with('\n') {
                    strip_to += 1;
                }
                html.replace_range(start..strip_to, "");
            }
            None => break,
        }
    }

    for item in restore {
        let replacement = if item.escape {
            crate::escape::escape_html(&item.literal)
        } else {
            // 未知标签的 HTML 块：TS 侧原样透传，不做转义。
            item.literal.clone()
        };
        // 按 item 声明的换行消费策略替换。
        //
        // comrak 会把占位符（块级 HTML）包在前后换行之间；是否保留这些换行
        // 取决于被保护片段的类型（开标签行保留、闭标签行吞前、文档末尾整块吞后）。
        let mut pattern = String::new();
        if item.consume_leading_newline {
            pattern.push('\n');
        }
        pattern.push_str(&item.placeholder);
        if item.consume_trailing_newline {
            pattern.push('\n');
        }

        if html.contains(&pattern) {
            html = html.replace(&pattern, &replacement);
        } else {
            html = html.replace(&item.placeholder, &replacement);
        }
    }
    html
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
            Segment::Directive {
                kind,
                title,
                body,
                in_list_item,
            } => {
                let inner = build_document(&body, allocator);
                let callout = Block::Callout {
                    title: if title.is_empty() {
                        default_callout_title(&kind).to_string()
                    } else {
                        title
                    },
                    kind,
                    blocks: inner,
                };
                if in_list_item {
                    // `- :::note` 写在列表项内：TS 输出 `<ul><li><callout></li></ul>`。
                    blocks.push(Block::List {
                        ordered: false,
                        is_task_list: false,
                        start: None,
                        tight: true,
                        items: vec![ListItem {
                            task: None,
                            task_symbol: None,
                            blocks: vec![callout],
                        }],
                    });
                } else {
                    blocks.push(callout);
                }
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
            // 段落内可能有**多个** display math（相邻 `$$..$$` 块被 comrak 合并进
            // 同一个 Paragraph）。TS 侧把它们各自识别为独立块级公式。
            let display_literals = collect_display_maths(node);
            if !display_literals.is_empty() {
                for literal in display_literals {
                    out.push(Block::Math(literal));
                }
                return;
            }

            match sole_display_math(node) {
                DisplayMath::Block(literal) => {
                    // 空内容（`$$\n$$`）在 TS 侧退化为普通段落文本，不是块级公式。
                    if literal.trim().is_empty() {
                        let position = node.data.borrow().sourcepos;
                        let raw = source.slice(position.start, position.end);
                        out.push(Block::Paragraph(vec![Inline::Text(raw.to_string())]));
                    } else {
                        out.push(Block::Math(literal));
                    }
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
            // TS 侧用 marked 的 `c.lang`，它是**整个** info string（去首尾空白），
            // 不是第一个词。因此 ` ```js title="demo.js" ` 的 lang 是
            // `js title="demo.js"`：别名解析失败 → 不高亮、语言标识原样保留。
            let lang = {
                let trimmed = code.info.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            };
            // comrak 的 CodeBlock literal 含结尾换行，TS 侧（marked）不含，
            // 直接 trim_end 会误删代码自身的空行，因此只去掉一个换行序列。
            let literal = code.literal.as_str();
            // TS（marked 的 `c.text`）**保留**源码的结尾换行；comrak 的 literal
            // 也带一个尾换行。两者只在「源码无尾换行」时不同，因此按源码判断。
            // 围栏代码块：TS（marked）的 `c.text` **不含**尾换行，而 comrak 的 literal
            // 带一个 → 去掉。
            // 缩进代码块：TS 保留源码的尾换行，comrak 也给带换行的 literal → 保留。
            let trimmed = if code.fenced {
                // 围栏代码块：TS 的 `c.text` 不含尾换行
                literal
                    .strip_suffix("\r\n")
                    .or_else(|| literal.strip_suffix('\n'))
                    .unwrap_or(literal)
                    .to_string()
            } else {
                // 缩进代码块：comrak 的 literal 恒带尾换行，但 TS（marked `c.text`）
                // **只在它是文档最后一个块时**才保留（中间块由后续块自身分隔）。
                let position = node.data.borrow().sourcepos;
                let is_last_block = source
                    .markdown
                    .lines()
                    .skip(position.end.line)
                    .all(|line| line.trim().is_empty());
                // 还需源码本身以换行结尾（fixture 的缩进块虽在末尾但源码无尾换行）。
                let source_has_trailing_newline = source.markdown.ends_with('\n');
                if is_last_block && source_has_trailing_newline {
                    literal.to_string()
                } else {
                    literal
                        .strip_suffix("\r\n")
                        .or_else(|| literal.strip_suffix('\n'))
                        .unwrap_or(literal)
                        .to_string()
                }
            };
            out.push(Block::Code {
                lang,
                code: trimmed.to_string(),
            });
        }
        NodeValue::MathBlock(math) => {
            // `math_dollars_block` 开启后，独立成行的 `$$ … $$`（含跨空行）
            // 由 comrak 直接给成块级节点。
            //
            // 空内容有两种形态，TS 侧行为不同：
            // - `$$\n$$`（紧邻）→ 普通段落文本
            // - `$$\n\n$$`（隔空行）→ 空的块级公式容器
            let position = node.data.borrow().sourcepos;
            let raw = source.slice(position.start, position.end);
            if math.literal.trim().is_empty() && !raw.contains("\n\n") {
                out.push(Block::Paragraph(vec![Inline::Text(raw.to_string())]));
            } else {
                out.push(Block::Math(math.literal.clone()));
            }
        }
        NodeValue::Math(math) => {
            // 跨行的 `$$ ... $$` 是块级数学；单行 `$$x$$` 在不同容器下语义不同
            // （段落/引用块 → 字面量，列表项 → 行内数学），因此交给段落路径处理。
            let position = node.data.borrow().sourcepos;
            if position.start.line == position.end.line {
                out.push(Block::Paragraph(vec![Inline::Math(math.literal.clone())]));
            } else {
                out.push(Block::Math(math.literal.clone()));
            }
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
        NodeValue::HtmlBlock(html) => {
            // comrak 的 HtmlBlock literal 与 marked 的 html token 只在**一种**情形
            // 下不同：块后面还有内容时，comrak 保留尾部换行而 marked 去掉。
            //
            // 实测（`<div>\nx\n</div>` + 各种尾部）：
            // - 后面有内容（段落/标题/代码块）→ TS 去掉尾换行，comrak 保留
            // - 是文档最后一块（后面只有空行或什么都没有）→ 两者一致
            //
            // 因此这里只在「后面确实还有块」时去掉一个换行。
            // 是否去掉尾部换行。实测 marked 的完整规则：
            //
            // | 本块之后的源码 | 是否保留尾换行 |
            // |---|---|
            // | 什么都没有（文档到本块即止） | 保留 |
            // | 直接紧跟下一行内容（无空行） | **保留**（`<!-- c -->\n<pre>`） |
            // | 隔一个及以上空行 | 去掉 |
            //
            // 因此「去掉」的条件是：后面仍有内容 **且** 中间存在空行。
            let end_line = node.data.borrow().sourcepos.end.line;
            let remaining: Vec<&str> = source.markdown.lines().skip(end_line).collect();
            let has_next_block = !remaining.is_empty()
                && remaining.first().map(|line| line.trim().is_empty()) == Some(true);
            out.push(Block::Html {
                literal: html.literal.clone(),
                tight_to_next: has_next_block,
            });
        }
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
    let (task, task_symbol) = match &node.data.borrow().value {
        NodeValue::TaskItem(item) => (Some(item.symbol.is_some()), item.symbol),
        _ => (None, None),
    };

    let mut blocks = Vec::new();
    for child in node.children() {
        build_block(child, allocator, source, &mut blocks);
    }

    ListItem {
        task,
        task_symbol,
        blocks,
    }
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
///
/// 语义严格对齐 TS 侧的 `text.replace(/<[^>]+>/g, "")`：**成对**移除 `<` 到最近
/// `>` 之间的片段，且 `<` 后必须至少有一个非 `>` 字符；找不到闭合 `>` 时保留 `<`。
///
/// 不能用「深度计数器」实现：标题里出现孤立 `<`（如 `# 性能 < 10ms 的场景`）会让
/// 计数器永久停在 >0，把标题剩余文本整段吞掉，导致 id 与 `data-heading-text`
/// 双双被截断（实测：TS `性能-10ms-的场景` vs Rust `性能`）。
fn strip_html_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut index = 0usize;

    while index < text.len() {
        if !text[index..].starts_with('<') {
            let ch = text[index..].chars().next().unwrap_or_default();
            out.push(ch);
            index += ch.len_utf8();
            continue;
        }
        match text[index + 1..].find('>') {
            Some(offset) if offset > 0 => index = index + 1 + offset + 1,
            _ => {
                out.push('<');
                index += 1;
            }
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
    let mut atoms: Vec<Atom> = Vec::new();
    for inline in inlines {
        match inline {
            Inline::Text(text) => {
                let mut rest = text.as_str();
                while let Some(position) = rest.find("==") {
                    let before = &rest[..position];
                    if !before.is_empty() {
                        atoms.push(Atom::Text(before.to_string()));
                    }
                    atoms.push(Atom::Delim);
                    rest = &rest[position + 2..];
                }
                if !rest.is_empty() {
                    atoms.push(Atom::Text(rest.to_string()));
                }
            }
            other => atoms.push(Atom::Node(other)),
        }
    }

    // 预先计算每个位置「下一个原子是否可作为高亮起始」，因为 atoms 会被消费。
    let openable: Vec<bool> = atoms
        .iter()
        .enumerate()
        .map(|(index, _)| {
            atoms
                .get(index + 1)
                .map(atom_starts_highlightable)
                .unwrap_or(false)
        })
        .collect();

    let mut result: Vec<Inline> = Vec::new();
    let mut pending: Option<Vec<Inline>> = None;

    for (index, atom) in atoms.into_iter().enumerate() {
        match atom {
            Atom::Delim => {
                if let Some(children) = pending.as_ref() {
                    // 闭合条件：`==` 前一个字符必须非空白（CommonMark 侧翼规则）。
                    let can_close = children
                        .last()
                        .map(inline_ends_with_non_whitespace)
                        .unwrap_or(false);
                    if can_close {
                        let children = pending.take().unwrap_or_default();
                        result.push(Inline::Highlight(children));
                    } else {
                        push_inline(&mut result, &mut pending, Inline::Text("==".to_string()));
                    }
                } else {
                    // 开启条件：`==` 之后必须是非空白、非 `=`。
                    let can_open = openable.get(index).copied().unwrap_or(false);
                    if can_open {
                        pending = Some(Vec::new());
                    } else {
                        result.push(Inline::Text("==".to_string()));
                    }
                }
            }
            Atom::Text(text) => push_inline(&mut result, &mut pending, Inline::Text(text)),
            Atom::Node(node) => push_inline(&mut result, &mut pending, node),
        }
    }

    // 未闭合：把待定内容原样放回，并把开启的 `==` 还原为字面量。
    if let Some(children) = pending {
        result.push(Inline::Text("==".to_string()));
        result.extend(children);
    }

    merge_adjacent_text(result)
}

/// 折叠 `==highlight==` 用的原子。
///
/// Text 在 `==` 处切分，其余节点保持完整。
///
/// 必须展平到原子级：`==**粗体**==` 里 `==` 是一个**独立的 Text 节点**
/// （comrak 把 `**` 解析成 Strong 兄弟节点），只看 Text 内部无法判断
/// 「`==` 之后是否紧跟非空白内容」。
enum Atom {
    Text(String),
    Delim,
    Node(Inline),
}

/// 原子是否可以作为高亮内容的起始（`==` 之后）。
///
/// - Text：首字符非空白、非 `=`
/// - 其它节点（Strong/Emph/Code/Link/Math/Image）：源码里首字符是 `*`、`` ` ``、
///   `[`、`$`、`!` 等，均为非空白非 `=`，因此总是可以
fn atom_starts_highlightable(atom: &Atom) -> bool {
    match atom {
        Atom::Text(text) => text
            .chars()
            .next()
            .map(|ch| !ch.is_whitespace() && ch != '=')
            .unwrap_or(false),
        Atom::Delim => false,
        Atom::Node(_) => true,
    }
}

/// 行内节点是否以非空白结尾（用于 `==` 的闭合判定）。
fn inline_ends_with_non_whitespace(inline: &Inline) -> bool {
    match inline {
        Inline::Text(text) => text
            .chars()
            .last()
            .map(|ch| !ch.is_whitespace())
            .unwrap_or(false),
        // 其它节点以 `*`、`` ` ``、`]` 等非空白字符结尾
        _ => true,
    }
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
        NodeValue::Text(text) => {
            // comrak 会把 `&copy;` 解码成 `©`、`&amp;` 解码成 `&`；TS 侧不解码实体
            // （`&copy;` 输出 `&amp;copy;`，页面上显示字面量 `&copy;`）。
            // 可见文本不同属于字节级差异，因此按 sourcepos 回查源码原文。
            let position = node.data.borrow().sourcepos;
            let raw = source.slice(position.start, position.end);
            let value = if raw.is_empty() {
                text.to_string()
            } else {
                // 原文上只做「反斜杠转义还原」，**不做**实体解码：
                // - TS（marked）把 `\*` 还原为 `*`，但把 `&copy;` 保留为字面量；
                // - comrak 反过来（不保留反斜杠、但解码实体）。
                // 因此取原文 + 仅解转义，两边行为才对得上。
                unescape_backslashes(raw)
            };
            out.push(Inline::Text(value));
        }
        NodeValue::Code(code) => {
            // CommonMark 5.2：内容**同时**以空格开头和结尾、且不全为空格时，
            // 首尾各去掉一个空格。
            //
            // comrak 的 literal 已按 CommonMark 5.2 处理完首尾空格规则
            // （内容同时以空格开头和结尾且不全为空格时各去一个），
            // 与 marked 在该规则上一致。不要再剥一层，否则会少一个空格。
            out.push(Inline::Code(code.literal.clone()));
        }
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
        NodeValue::Image(link) => {
            // TS 的 `token.alt` 是**原始行内文本**（保留 `*`、`**` 等标记），
            // 而 collect_plain_text 会剥掉它们。这里按 sourcepos 取原文。
            let position = node.data.borrow().sourcepos;
            let raw = source.slice(position.start, position.end);
            let alt = raw
                .strip_prefix("![")
                .and_then(|rest| rest.find("]").map(|close| &rest[..close]))
                .map(str::to_string)
                .unwrap_or_else(|| collect_plain_text(node));
            out.push(Inline::Image {
                src: link.url.clone(),
                alt: normalize_title(&alt),
                title: normalize_title(&link.title),
            })
        }
        NodeValue::Math(math) => {
            let position = node.data.borrow().sourcepos;
            // 列表项内的单行 `$$x$$` 走**行内数学**路径（TS 侧实测：
            // `- a $$b$$ c` → `a $<katex>$ c`）；其余上下文（段落/引用块）把它
            // 当字面量输出并插入换行。这是 marked 块级分词器在不同容器下的差异。
            // TS 的 math_inline 规则：`/^\$([^$\r\n]+?)\$/` —— 不跨行、内容非空、
            // 首尾非空白。跨行的 `$…$` 在 TS 侧只是普通文本。
            if !math.display_math {
                let is_valid_inline = position.start.line == position.end.line
                    && !math.literal.trim().is_empty()
                    && !math.literal.starts_with(char::is_whitespace)
                    && !math.literal.ends_with(char::is_whitespace);
                if !is_valid_inline {
                    let raw = source.slice(position.start, position.end);
                    out.push(Inline::Text(raw.to_string()));
                } else {
                    // 用原文按 TS 的 math_inline 规则重新求内容与闭合位置。
                    //
                    // TS 的正则是 `/^\$([^$\r\n]+?)\$/`：遇到第一个 `$` 就闭合。
                    // `$\$5$` 因此内容是 `\`（渲染为 katex-error），闭合在第二个 `$`。
                    // comrak 的 Math 节点只覆盖 `$\$`，剩余 `5$` 是兄弟 Text，
                    // 必须在这里一并消费掉，否则会丢文本。
                    // comrak 的 Math 节点覆盖整个 `$...$`，但 literal 是**解码后**的
                    // （`\$5` 里的反斜杠被保留、`$` 也被吞进 literal）。TS 的规则是
                    // 遇到第一个 `$` 就闭合，因此要从**原文**重新求内容。
                    let raw = source.slice(position.start, position.end);
                    let body = raw.strip_prefix('$').unwrap_or(raw);
                    let content = body.split('$').next().unwrap_or(body);
                    out.push(Inline::Math(content.to_string()));

                    // TS 在第一个 `$` 处闭合，其后的内容（如 `$\$5$` 里的 `5$`）
                    // 是普通文本。comrak 的 Math 节点覆盖了整个 `$...$`，
                    // 因此这里要把闭合位置之后的部分补回为文本。
                    let consumed = 1 + content.len() + 1; // `$` + content + `$`
                    if consumed < raw.len() {
                        out.push(Inline::Text(raw[consumed..].to_string()));
                    }
                }
                return;
            }

            // 空内容（`$$\n$$`）在 TS 侧退化为普通段落文本。
            if math.literal.trim().is_empty() {
                let raw = source.slice(position.start, position.end);
                out.push(Inline::Text(raw.to_string()));
                return;
            }

            let single_line_display = position.start.line == position.end.line;

            if single_line_display {
                // 单行 `$$x$$`：comrak 识别为 display math，但 TS 侧的块级 math_block
                // 扩展要求 `$$` 后紧跟换行，因此单行形态在不同容器下退化方式不同：
                // - 列表项内 → `$` + 行内数学 + `$`
                // - 段落 / 引用块 → 字面量 `\n$$body\n$$`
                let raw = source.slice(position.start, position.end);
                let body = raw
                    .strip_prefix("$$")
                    .and_then(|rest| rest.strip_suffix("$$"))
                    .unwrap_or(raw);

                if in_list_item(node) {
                    out.push(Inline::Text("$".to_string()));
                    out.push(Inline::Math(body.to_string()));
                    out.push(Inline::Text("$".to_string()));
                } else {
                    out.push(Inline::Text(format!("\n$${body}\n$$")));
                }
            } else {
                out.push(Inline::Math(math.literal));
            }
        }
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
    emit_inlines_with(inlines, markers, out, false);
}

/// 发射行内序列，`inside_link` 表示当前处于 `<a>` 内部。
///
/// 链接内**不得**再生成 `<a>`（HTML 不允许嵌套锚点，且 marked 也不会这样做）。
fn emit_inlines_with(inlines: &[Inline], markers: bool, out: &mut String, inside_link: bool) {
    for inline in inlines {
        emit_inline(inline, markers, out, inside_link);
    }
}

fn emit_inline(inline: &Inline, markers: bool, out: &mut String, inside_link: bool) {
    match inline {
        Inline::Text(text) => {
            if inside_link {
                out.push_str(&escape_html(text));
            } else {
                emit_text_with_autolinks(text, out);
            }
        }
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
        Inline::Bold(children) => emit_wrapped_ctx(
            children,
            markers,
            inside_link,
            &WrapSpec {
                kind: "bold",
                marker: "**",
                marked_open: "<strong class=\"cm-md-inline cm-md-bold\">",
                marked_close: "</strong>",
                bare_tag: "strong",
            },
            out,
        ),
        Inline::Italic(children) => emit_wrapped_ctx(
            children,
            markers,
            inside_link,
            &WrapSpec {
                kind: "italic",
                marker: "*",
                marked_open: "<em class=\"cm-md-inline cm-md-italic\">",
                marked_close: "</em>",
                bare_tag: "em",
            },
            out,
        ),
        Inline::Strike(children) => emit_wrapped_ctx(
            children,
            markers,
            inside_link,
            &WrapSpec {
                kind: "strikethrough",
                marker: "~~",
                marked_open: "<del class=\"cm-md-inline cm-md-strikethrough\">",
                marked_close: "</del>",
                bare_tag: "del",
            },
            out,
        ),
        Inline::Highlight(children) => emit_wrapped_ctx(
            children,
            markers,
            inside_link,
            &WrapSpec {
                kind: "highlight",
                marker: "==",
                marked_open: "<mark class=\"cm-md-inline cm-md-highlight\">",
                marked_close: "</mark>",
                bare_tag: "mark",
            },
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
            emit_inlines_with(children, markers, out, true);
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

/// 发射带语法标记的包裹型行内节点（加粗/斜体/删除线/高亮共用一个模板）。
///
/// `markers` 只决定是否额外输出 `cm-md-marker` 语法标记 span，**绝不**决定是否
/// 输出语义标签本身。导出路径统一使用 `include_markers: false`（干净 HTML），
/// 若在这里连带丢掉 `<strong>` / `<em>` / `<del>` / `<mark>`，导出结果会丢失全部
/// 行内强调——与 TS 侧 `return `<strong>${inner}</strong>`` 的行为直接冲突。
/// 包裹型行内节点的输出规格。
struct WrapSpec {
    /// `cm-md-marker--{kind}` 里的种类名。
    kind: &'static str,
    /// 语法标记字面量（`**` / `*` / `~~` / `==`）。
    marker: &'static str,
    /// 带标记模式的完整开标签（含 `cm-md-inline` 类名）。
    marked_open: &'static str,
    /// 带标记模式的闭标签。
    marked_close: &'static str,
    /// 干净模式的裸语义标签名（`strong` / `em` / `del` / `mark`）。
    bare_tag: &'static str,
}

/// 带链接上下文的包裹型发射。
fn emit_wrapped_ctx(
    children: &[Inline],
    markers: bool,
    inside_link: bool,
    spec: &WrapSpec,
    out: &mut String,
) {
    let WrapSpec {
        kind,
        marker,
        marked_open,
        marked_close,
        bare_tag,
    } = *spec;

    if markers {
        out.push_str(&format!(
            "<span class=\"cm-md-marker cm-md-marker--{kind}\">{marker}</span>"
        ));
        out.push_str(marked_open);
        emit_inlines_with(children, markers, out, inside_link);
        out.push_str(marked_close);
        out.push_str(&format!(
            "<span class=\"cm-md-marker cm-md-marker--{kind}\">{marker}</span>"
        ));
    } else {
        // 干净 HTML：只去掉标记 span，语义标签照常输出。
        out.push('<');
        out.push_str(bare_tag);
        out.push('>');
        emit_inlines_with(children, markers, out, inside_link);
        out.push_str("</");
        out.push_str(bare_tag);
        out.push('>');
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
        Block::Code { lang, code, .. } => {
            let highlighted = highlight_code(code, lang.as_deref());
            out.push_str("<pre><code class=\"hljs");
            if !highlighted.language.is_empty() {
                out.push_str(" language-");
                out.push_str(&escape_html(&highlighted.language));
            }
            out.push_str("\">");
            out.push_str(&highlighted.html);
            // highlight.js 会吞掉代码末尾的换行。缩进代码块在 TS 侧保留尾换行，
            // 因此这里按 literal 是否以换行结尾补回。
            // 缩进代码块的尾换行由顶层循环按「是否末块」统一处理。
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
        Block::Html {
            literal,
            tight_to_next: has_next_block,
        } => {
            // 后面还有块时去掉一个尾部换行（marked 的 html token 不含末尾换行）；
            // 是文档最后一块时原样输出（此时 comrak 与 marked 已一致）。
            if *has_next_block {
                let trimmed = literal
                    .strip_suffix("\r\n")
                    .or_else(|| literal.strip_suffix('\n'))
                    .unwrap_or(literal);
                out.push_str(trimmed);
            } else {
                out.push_str(literal);
            }
        }
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

            if tight {
                emit_list_item_body(&item.blocks, tight, markers, real_ids, emitted_aliases, out);
            } else {
                // 松散列表：marked 保留 `[x] ` 字面量，并在 `<input>` 后留一个空格。
                out.push(' ');
                let symbol = item.task_symbol.unwrap_or(if checked { 'x' } else { ' ' });
                let mut emitted_literal = false;
                for block in &item.blocks {
                    if let Block::Paragraph(inlines) = block {
                        if !emitted_literal {
                            out.push_str("<p>[");
                            out.push(symbol);
                            out.push_str("] ");
                            emit_inlines(inlines, markers, out);
                            out.push_str("</p>\n");
                            emitted_literal = true;
                            continue;
                        }
                    }
                    emit_block(block, markers, real_ids, emitted_aliases, out);
                }
            }
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

/// 还原反斜杠转义（`\*` → `*`），但保留实体字面量（`&copy;` 不动）。
///
/// CommonMark 规定反斜杠可转义的 ASCII 标点集合有限；其余位置的反斜杠按字面保留。
fn unescape_backslashes(text: &str) -> String {
    const ESCAPABLE: &str = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(&next) = chars.peek() {
                if ESCAPABLE.contains(next) {
                    out.push(next);
                    chars.next();
                    continue;
                }
            }
        }
        out.push(ch);
    }

    out
}

/// 发射文本节点，并把 GFM 裸邮箱自动链接为 `<a href="mailto:…">`。
///
/// ## 为什么需要
///
/// comrak 的 `autolink` 扩展只识别「域名含 `.` 且 TLD 为字母」的邮箱
/// （`a@b.c`、`user@example.com`），而 marked 的 GFM url 规则更宽松：
/// 只要 `@` 后含 `.` 且两段非空就成立，因此 `sanitize-html@2.17.6`、
/// `@scope/pkg@1.0.0` 里的 `pkg@1.0.0` 都会被链接。
///
/// 真实文档（CHANGELOG、安全评审）里大量出现 `name@version` 形式，
/// 不一致会让同一份文档在桌面导出与移动端渲染出不同内容。
fn emit_text_with_autolinks(text: &str, out: &mut String) {
    let bytes = text.as_bytes();
    let mut cursor = 0usize;
    let mut plain_start = 0usize;

    while let Some(offset) = text[cursor..].find('@') {
        let at = cursor + offset;

        // 向左取本地部分：字母/数字/`.`/`_`/`+`/`-`
        let mut local_start = at;
        while local_start > 0 {
            let ch = bytes[local_start - 1];
            if ch.is_ascii_alphanumeric() || matches!(ch, b'.' | b'_' | b'+' | b'-') {
                local_start -= 1;
            } else {
                break;
            }
        }

        // 向右取域名部分：同样字符集
        let mut domain_end = at + 1;
        while domain_end < bytes.len() {
            let ch = bytes[domain_end];
            if ch.is_ascii_alphanumeric() || matches!(ch, b'.' | b'_' | b'+' | b'-') {
                domain_end += 1;
            } else {
                break;
            }
        }

        let local = &text[local_start..at];
        let domain = &text[at + 1..domain_end];

        // marked 的判定：两侧非空，且域名含 `.`、`.` 两侧都非空。
        let valid = !local.is_empty()
            && !domain.is_empty()
            && domain.contains('.')
            && !domain.starts_with('.')
            && !domain.ends_with('.')
            && !local.ends_with('.');

        if !valid {
            cursor = at + 1;
            continue;
        }

        if plain_start < local_start {
            out.push_str(&escape_html(&text[plain_start..local_start]));
        }
        let address = &text[local_start..domain_end];
        out.push_str("<a href=\"mailto:");
        out.push_str(&escape_html(address));
        out.push_str("\">");
        out.push_str(&escape_html(address));
        out.push_str("</a>");

        cursor = domain_end;
        plain_start = domain_end;
    }

    if plain_start < text.len() {
        out.push_str(&escape_html(&text[plain_start..]));
    }
}

/// 节点是否位于列表项内。
///
/// marked 对 `$$x$$`（单行 display math）在不同容器下的处理不同：
/// - 列表项内 → 退化为 `$` + 行内数学 + `$`
/// - 段落 / 引用块 → 作为字面量输出并插入换行
fn in_list_item<'a>(node: &'a AstNode<'a>) -> bool {
    let mut current = node.parent();
    while let Some(parent) = current {
        let value = parent.data.borrow().value.clone();
        if matches!(value, NodeValue::Item(_) | NodeValue::TaskItem(_)) {
            return true;
        }
        current = parent.parent();
    }
    false
}

/// 收集段落内所有 display math 的字面量（用于「相邻块级公式被合并」的场景）。
///
/// 仅当段落**只由** display math 与空白文本构成时才返回；否则返回空，
/// 让调用方走普通段落路径（例如 `文字 $$x$$ 文字` 里的 display math 应保留在段落内）。
fn collect_display_maths<'a>(node: &'a AstNode<'a>) -> Vec<String> {
    let children: Vec<&AstNode<'_>> = node.children().collect();
    if children.len() < 2 {
        return Vec::new();
    }

    let mut literals = Vec::new();
    for child in &children {
        let value = child.data.borrow().value.clone();
        match value {
            NodeValue::Math(math) if math.display_math => literals.push(math.literal),
            // 允许公式之间的空白文本（comrak 会插入换行文本节点）
            NodeValue::Text(text) if text.trim().is_empty() => {}
            NodeValue::LineBreak | NodeValue::SoftBreak => {}
            _ => return Vec::new(),
        }
    }
    literals
}
