//! 解析前预处理：把 comrak 会「吃掉」但 TS 侧保留为可见文本的语法保护起来。
//!
//! ## 为什么需要这一层
//!
//! 三处差异无法在 emitter 里修，因为 comrak 在**解析阶段**就丢弃了信息：
//!
//! 1. **引用定义行**：`[foo]: https://example.com`
//!    TS（marked）把它当普通段落输出 `<p>[foo]: …</p>`；comrak 把它消费为
//!    链接定义，不产生任何节点。
//! 2. **未知标签的 HTML 块**：`<use_when>\n- a\n</use_when>`
//!    TS 用 `^<[^\n>]+>\n` 判定，任意标签都整块透传；comrak 只认 CommonMark 的
//!    blockTags 白名单（`div`/`p`/`ul`…），未知小写标签退化成段落并被转义。
//! 3. **BOM 后的首个块**：`\u{FEFF}# Title`
//!    TS 把 BOM 当普通字符，整行成为段落；comrak 跳过 BOM 并把 `# Title`
//!    识别为标题。
//!
//! ## 手法
//!
//! 把需要「按纯文本保留」的片段替换成**不含块级标记**的占位行，
//! 解析完成后在渲染阶段还原为原始字面量。占位符使用 Unicode 私用区字符
//! （`U+E000` 起），Markdown 不会赋予它们语义，也不会出现在正常文档里。

/// 块级占位符载体标签。
///
/// 必须用 **CommonMark 认可的块级标签**，comrak 才会把它当作 HtmlBlock 原样透传；
/// 否则占位符会落进段落并被包上 `<p>`（实测）。
/// 该字符串在最终 HTML 里会被完整替换掉，不会泄漏给用户。
const PLACEHOLDER_CARRIER: &str = "div";

/// 行内占位符前缀（Unicode 私用区）。
///
/// 用于需要保留在**段落内部**的字面量（BOM 首行、引用定义行）：
/// TS 侧把它们输出为 `<p>…</p>`，因此占位符必须能被 `<p>` 包裹。
const INLINE_PLACEHOLDER_PREFIX: char = '\u{E000}';

/// 占位符还原项。
pub struct RestoreItem {
    /// 占位符本身。
    pub placeholder: String,
    /// 原始字面量。
    pub literal: String,
    /// `true` 时按**纯文本**还原（做 HTML 转义）；`false` 时按**原始 HTML** 还原。
    pub escape: bool,
    /// 还原时是否吞掉占位符**前**的换行。
    ///
    /// 用于闭标签行（`</x_tag>`）：marked 把它粘到上一行内容末尾，不换行。
    pub consume_leading_newline: bool,
    /// 还原时是否吞掉占位符**后**的换行。
    ///
    /// 用于文档末尾的整块 HTML（marked 的 html token 不含末尾换行）。
    pub consume_trailing_newline: bool,
}

/// 预处理结果。
pub struct Preprocessed {
    /// 交给 comrak 的文本。
    pub markdown: String,
    /// 占位符 → 原始字面量（渲染时按出现顺序还原）。
    pub restore: Vec<RestoreItem>,
}

/// 复刻 TS 对「相邻单行 `$$x$$` 块 + 空行」的怪异切分。
///
/// marked 的 `math_block` 扩展 `start()` 命中第一行末尾的 `$$`，跨过空行去匹配
/// 第二行的开头 `$$`，因此 `$$a$$\n\n$$b$$` 被切成：
/// `<p>$$a</p>` + 空块级公式 + `<p>b\n$$</p>`。
///
/// 只在该精确形态下改写，其余 `$$` 用法不受影响。
fn rewrite_adjacent_single_line_blocks(markdown: &str) -> String {
    // 快速路径：不包含该形态时原样返回，避免重建字符串改变尾换行语义。
    if !markdown.contains("$$") {
        return markdown.to_string();
    }
    let lines: Vec<&str> = markdown.lines().collect();
    let mut changed = false;
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut index = 0usize;

    while index < lines.len() {
        let line = lines[index];
        let trimmed = line.trim();
        // 形态：`$$内容$$`（单行、非空、整行独占）
        let is_single = trimmed.len() > 4
            && trimmed.starts_with("$$")
            && trimmed.ends_with("$$")
            && !trimmed[2..trimmed.len() - 2].contains("$$");
        if is_single && index + 2 < lines.len() && lines[index + 1].trim().is_empty() {
            let next = lines[index + 2].trim();
            let next_is_single = next.len() > 4
                && next.starts_with("$$")
                && next.ends_with("$$")
                && !next[2..next.len() - 2].contains("$$");
            if next_is_single {
                // 切成三段：`$$a` / 空块 / `b$$`
                let first = &trimmed[..trimmed.len() - 2];
                let second = &next[2..];
                // 还原 TS 的三段结构：
                //   <p>$$a</p> / 空块级公式 / <p>b\n$$</p>
                // 空块级公式需要 `$$` 与 `$$` 之间隔一个空行（`$$\n\n$$`），
                // comrak 才会给出空 MathBlock；`b` 与 `$$` 之间不能有空行，
                // 才能落在同一段落里形成软换行。
                out.push(first.to_string());
                out.push(String::new());
                out.push("$$".to_string());
                out.push(String::new());
                out.push("$$".to_string());
                out.push(String::new());
                // 结尾的 `$$` 在 TS 侧是**段落内的文本**（软换行后跟字面 `$$`）。
                // 若直接写 `$$` 独占一行，comrak 会识别为块级公式，
                // 因此这里用固定标记，由 preprocess 替换为行内占位符。
                let second_trimmed = second.trim_end_matches("$$");
                out.push(second_trimmed.to_string());
                out.push(QUAD_TAIL_MARKER.to_string());
                changed = true;
                index += 3;
                continue;
            }
        }
        out.push(line.to_string());
        index += 1;
    }

    if !changed {
        return markdown.to_string();
    }
    let mut result = out.join("\n");
    // `lines()` 会丢弃末尾换行，这里按原文补回，保持 has_newline 语义不变。
    if original_ends_with_newline(markdown) && !result.ends_with('\n') {
        result.push('\n');
    }
    result
}

/// 「相邻单行 `$$x$$` 块」改写时用于标记「段落内的字面 `$$`」。
const QUAD_TAIL_MARKER: &str = "\u{E001}QUAD_TAIL\u{E001}";

/// 原文是否以换行结尾。
fn original_ends_with_newline(text: &str) -> bool {
    text.ends_with('\n')
}

/// 预处理 Markdown。
pub fn preprocess(original: &str) -> Preprocessed {
    let mut restore: Vec<RestoreItem> = Vec::new();
    let mut definitions: Vec<String> = Vec::new();
    let mut counter = 0usize;

    // 先做「相邻单行 `$$x$$` 块」改写，再把改写标记换成行内占位符
    // （它必须作为普通文本参与解析）。
    let rewritten = rewrite_adjacent_single_line_blocks(original);
    let rewritten = if rewritten.contains(QUAD_TAIL_MARKER) {
        let placeholder = inline_placeholder_for(&mut counter);
        restore.push(restore_item(placeholder.clone(), "$$".to_string(), true));
        rewritten.replace(QUAD_TAIL_MARKER, &placeholder)
    } else {
        rewritten
    };
    let markdown: &str = &rewritten;

    let mut out = String::with_capacity(markdown.len());
    let lines: Vec<&str> = markdown.split_inclusive('\n').collect();
    let mut skip_until = 0usize;
    // 当前所处的代码围栏（marker 字符, 长度）。`None` 表示不在围栏内。
    let mut open_fence: Option<(char, usize)> = None;

    for (index, line) in lines.iter().copied().enumerate() {
        if index < skip_until {
            continue;
        }
        let body = line.strip_suffix('\n').unwrap_or(line);
        let body = body.strip_suffix('\r').unwrap_or(body);
        let has_newline = line.ends_with('\n');

        // ---- 0) 代码围栏：原样透传，绝不做占位替换 ----
        //
        // 否则围栏内的 `<div ...>` 之类的字面量会被误判为「未知标签 HTML 块」
        // 并替换成占位符，导致代码块内容被破坏（实测会把代码替换成 `<div data-mdph=…>`）。
        if let Some((marker, length)) = open_fence {
            if is_closing_fence(body, marker, length) {
                open_fence = None;
            }
            out.push_str(body);
            if has_newline {
                out.push('\n');
            }
            continue;
        }
        if let Some((marker, length)) = opening_fence(body) {
            open_fence = Some((marker, length));
            out.push_str(body);
            if has_newline {
                out.push('\n');
            }
            continue;
        }

        // ---- 0.5) 伪 frontmatter ----
        //
        // comrak 会把 `---\n\n---` 当作 frontmatter（内容为空）并整体吞掉；
        // TS（marked 的前置检查）要求 frontmatter 内容非空且不含空行，
        // 因此该形态在 TS 侧是两条分隔线。用块级占位符还原为 `<hr />`。
        if index == 0
            && body.trim() == "---"
            && lines.get(1).map(|l| l.trim().is_empty()) == Some(true)
        {
            let placeholder = placeholder_for(&mut counter);
            restore.push(restore_item(
                placeholder.clone(),
                "<hr />\n".to_string(),
                false,
            ));
            out.push_str(&placeholder);
            if has_newline {
                out.push('\n');
            }
            continue;
        }

        // ---- 1) BOM 起始行：整行按纯文本保留 ----
        // 只处理文档首行的 BOM；其余位置 comrak 不会特殊对待。
        if index == 0 && body.starts_with('\u{FEFF}') {
            let placeholder = inline_placeholder_for(&mut counter);
            restore.push(restore_item(placeholder.clone(), body.to_string(), true));
            out.push_str(&placeholder);
            if has_newline {
                out.push('\n');
            }
            continue;
        }

        // ---- 2) 引用定义行 ----
        //
        // 双重需求：
        // - TS 侧把该行**作为可见文本**输出（`<p>[foo]: url</p>`），所以原文必须保留；
        // - 但 `[foo]` 引用仍要能解析成链接，而 comrak 依赖定义行才能解析。
        //
        // 因此这里把原文换成占位符（渲染时还原为可见文本），
        // 同时收集定义，稍后**在文末追加一份副本**供 comrak 消费。
        // 副本位于文档末尾，其自身不会产生可见输出（定义不渲染）。
        if is_reference_definition(body) {
            // 双重需求：
            // - TS 把该行**原位**输出为可见文本（`<p>[foo]: url</p>`）；
            // - 但 `[foo]` 仍要能解析为链接，而 comrak 需要定义行参与解析。
            //
            // 解法：原位同时放两样东西——
            //   1) 一个 HTML 注释形式的定义副本（供 comrak 解析引用，渲染时不可见）
            //   2) 一个行内占位符（渲染时还原为该行的可见文本）
            // 顺序上注释在前，保证定义先生效。
            let placeholder = inline_placeholder_for(&mut counter);
            // 段落文本的尾换行由后续内容决定：只有本行是文档最后一行时
            // TS 才保留它（`[foo]: /u\n` → `<p>[foo]: /u\n</p>`）。
            let is_last_line = lines
                .iter()
                .skip(index + 1)
                .all(|rest| rest.trim().is_empty());
            let literal = if has_newline && is_last_line {
                format!("{body}\n")
            } else {
                body.to_string()
            };
            restore.push(restore_item(placeholder.clone(), literal, true));
            // 原位只留占位符（渲染为可见文本）；
            // 定义副本收集到 definitions，稍后统一放到文档开头供 comrak 解析。
            definitions.push(body.trim().to_string());
            out.push_str(&placeholder);
            if has_newline {
                out.push('\n');
            }
            continue;
        }

        // ---- 2.2) 脚注定义行 ----
        //
        // comrak 即使未启用 `footnotes` 也会把 `[^1]: …` 消费为定义（不产生输出），
        // 而 TS（marked）把它当普通段落文本。这里保护为占位符。
        if is_footnote_definition(body) {
            let placeholder = inline_placeholder_for(&mut counter);
            let is_last_line = lines
                .iter()
                .skip(index + 1)
                .all(|rest| rest.trim().is_empty());
            let literal = if has_newline && is_last_line {
                format!("{body}\n")
            } else {
                body.to_string()
            };
            restore.push(restore_item(placeholder.clone(), literal, true));
            out.push_str(&placeholder);
            if has_newline {
                out.push('\n');
            }
            continue;
        }

        // ---- 2.5) 未知标签的独立闭标签行 ----
        //
        // marked 把 `</x_tag>` 粘到上一行内容末尾（实测 `<li>item</x_tag></li>`），
        // comrak 会转义成 `&lt;/x_tag&gt;` 并单独成段。这里把闭标签行保护成占位符，
        // 由调用方在还原时直接拼接（不带换行）。
        if let Some(tag) = standalone_closing_tag(body) {
            // 上一行的性质决定闭标签的归属（marked 的惰性续行语义）：
            // - 空行 / 文档开头 → 独立的 HTML 块
            // - 列表项行 → 粘到该列表项内容末尾（`<li>b</op></li>`）
            // - 普通段落行 → 属于该段落，由 comrak 转义（与 marked 一致）
            let previous_line = index
                .checked_sub(1)
                .and_then(|prev| lines.get(prev))
                .map(|prev| {
                    let prev = prev.strip_suffix('\n').unwrap_or(prev);
                    prev.strip_suffix('\r').unwrap_or(prev).to_string()
                });
            let preceded_by_blank = previous_line
                .as_deref()
                .map(|prev| prev.trim().is_empty())
                .unwrap_or(true);
            let preceded_by_list_item = previous_line
                .as_deref()
                .map(is_list_item_line)
                .unwrap_or(false);
            // 上一行是 HTML 注释（`<!-- … -->`）时，闭标签仍算独立块。
            // marked 对注释后的闭标签不转义（实测 `<!-- END -->\n</op>`）。
            let preceded_by_html_comment = previous_line
                .as_deref()
                .map(|prev| {
                    let trimmed = prev.trim();
                    trimmed.starts_with("<!--") && trimmed.ends_with("-->")
                })
                .unwrap_or(false);

            if !is_commonmark_block_tag(&tag)
                && (preceded_by_blank || preceded_by_list_item || preceded_by_html_comment)
            {
                // 用**块级**占位符：单独成行的闭标签会被 comrak 当作段落包进 `<p>`，
                // 用块级载体可避免该包裹（实测 `<p></op></p>`）。
                let placeholder = placeholder_for(&mut counter);
                let item = restore_item(placeholder.clone(), body.to_string(), false);
                restore.push(item);

                // 紧跟列表项时不用占位符：块级占位符会被 comrak 算进 `<li>`，
                // 还原后变成 `<li>item&lt;div data-mdph…&gt;</li>`（实测泄漏）。
                // 改为回退换行、把闭标签作为**同一行的行内文本**追加，
                // comrak 会把它保留在该列表项内，位置与 marked 一致。
                if preceded_by_list_item {
                    if out.ends_with('\n') {
                        out.pop();
                    }
                    // 用**行内**占位符：它会作为普通文本留在该行，
                    // 还原时按原始 HTML 输出（不转义），与 marked 一致。
                    let inline = inline_placeholder_for(&mut counter);
                    restore.push(restore_item(inline.clone(), body.to_string(), false));
                    out.push_str(&inline);
                    if has_newline {
                        out.push('\n');
                    }
                    continue;
                }

                out.push_str(&placeholder);
                if has_newline {
                    out.push('\n');
                }
                continue;
            }
        }

        // ---- 3) 未知标签的 HTML 块 ----
        //
        // TS（marked）用 `^<[^\n>]+>\n` 判定，任意标签都整块透传；
        // comrak 只认 CommonMark 的 blockTags 白名单，未知小写标签会退化成段落
        // 并被转义（`<use_when>` → `&lt;use_when&gt;`），且会破坏块内列表。
        //
        // 这里把整块（到下一个空行为止）保护成占位符，渲染时按**原始 HTML** 还原。
        if let Some(tag) = standalone_opening_tag(body) {
            if !is_commonmark_block_tag(&tag) {
                // 收集到空行为止（marked 的 html block 语义）。
                //
                // 含空行的容器型块（`<guidance_schema_contract>` … `</…>`）**不**走
                // 保护路径：把它整段当纯文本会丢失内部的列表/加粗解析（实测会把
                // AGENTS.md 的 schema 段落变成一大段原文）。这类块交给 comrak 处理，
                // 其行为与 marked 的差异另行评估。
                let mut block = String::from(body);
                let mut cursor = index + 1;
                let mut has_blank_line = false;
                while cursor < lines.len() {
                    let candidate = lines[cursor].strip_suffix('\n').unwrap_or(lines[cursor]);
                    let candidate = candidate.strip_suffix('\r').unwrap_or(candidate);
                    if candidate.trim().is_empty() {
                        has_blank_line = true;
                        break;
                    }
                    block.push('\n');
                    block.push_str(candidate);
                    cursor += 1;
                }

                if has_blank_line {
                    // 含空行的块：marked 只把**开标签行**原样透传，块内 Markdown
                    // 照常解析（标题/列表/围栏都正常）。因此这里只保护开标签行，
                    // 后续内容交回正常流程。
                    let placeholder = placeholder_for(&mut counter);
                    // 开标签行：literal 不含换行，且**必须保留**其后的换行
                    // （块内 Markdown 从下一行开始）。
                    restore.push(restore_item(placeholder.clone(), body.to_string(), false));
                    out.push_str(&placeholder);
                    if has_newline {
                        out.push('\n');
                    }
                    continue;
                }

                let placeholder = placeholder_for(&mut counter);
                // 文档末尾的整块：是否保留尾换行取决于**源码**是否有尾换行
                // （marked 的 html token 保留块内换行，块尾是否带换行跟随源码）。
                let is_last_block = lines.iter().skip(cursor).all(|rest| rest.trim().is_empty());
                // 注意：不能用 `has_newline`（那是**开标签行**的换行），
                // 必须看整块**最后一行**是否带换行。
                let block_ends_with_newline = lines
                    .get(cursor.saturating_sub(1))
                    .map(|last| last.ends_with('\n'))
                    .unwrap_or(false);
                let keep_trailing = is_last_block && block_ends_with_newline;
                let literal = if keep_trailing {
                    block
                } else if is_last_block {
                    block.strip_suffix('\n').unwrap_or(&block).to_string()
                } else {
                    block
                };
                let mut item = restore_item(placeholder.clone(), literal, false);
                // 仅当 literal 已去尾换行时，才需要吞掉占位符后的换行。
                item.consume_trailing_newline = is_last_block && !block_ends_with_newline;
                restore.push(item);
                out.push_str(&placeholder);
                if has_newline {
                    out.push('\n');
                }
                skip_until = cursor;
                continue;
            }
        }

        out.push_str(body);
        if has_newline {
            out.push('\n');
        }
    }

    // 定义副本以 HTML 注释形式放在**文档开头**：comrak 能解析引用，
    // 渲染后由 restore_placeholders 清除，不产生可见内容。
    let markdown = if definitions.is_empty() {
        out
    } else {
        let mut combined = String::with_capacity(out.len() + definitions.len() * 48);
        // 定义行必须是「裸」的才能被 comrak 解析为链接定义（放进 HTML 注释无效）。
        // 放在文档最前、后面紧跟占位符（中间不空行），comrak 会消费掉定义、
        // 只渲染占位符，因此不产生可见文本。
        for definition in &definitions {
            combined.push_str(definition);
            combined.push('\n');
        }
        // 定义行后若紧跟表格/HTML，comrak 会把定义行当成段落。
        // 用 HTML 注释隔开（会被 restore_placeholders 清除），
        // 既保证定义被消费、又不产生可见文本。
        combined.push_str("<!--md-def-sep-->");
        combined.push('\n');
        combined.push_str(&out);
        combined
    };

    Preprocessed { markdown, restore }
}

/// 构造还原项。
fn restore_item(placeholder: String, literal: String, escape: bool) -> RestoreItem {
    RestoreItem {
        placeholder,
        literal,
        escape,
        consume_leading_newline: false,
        consume_trailing_newline: false,
    }
}

/// 生成占位符。
///
/// 用私用区字符加十进制序号，且不含 Markdown 元字符，保证解析后仍是同一个
/// 纯文本节点。
fn placeholder_for(counter: &mut usize) -> String {
    let id = *counter;
    *counter += 1;
    format!("<{PLACEHOLDER_CARRIER} data-mdph=\"{id}\"></{PLACEHOLDER_CARRIER}>")
}

/// 行内占位符（会被 `<p>` 包裹，还原后仍留在段落内）。
fn inline_placeholder_for(counter: &mut usize) -> String {
    let id = *counter;
    *counter += 1;
    format!("{INLINE_PLACEHOLDER_PREFIX}{id}{INLINE_PLACEHOLDER_PREFIX}")
}

/// 是否为引用定义行（`[label]: url`）。
///
/// 对齐 marked 的 `def` 规则：行首最多 3 个空格 + `[label]:` + 非空目标。
/// 注意 TS 侧**保留**这些行作为可见文本，因此这里只是把它们保护成占位符，
/// 最终仍原样输出。
fn is_reference_definition(line: &str) -> bool {
    let trimmed = line.trim_start();
    let indent = line.len() - trimmed.len();
    if indent > 3 || !trimmed.starts_with('[') {
        return false;
    }
    let Some(close) = trimmed.find("]:") else {
        return false;
    };
    let label = &trimmed[1..close];
    // 标签非空，且**不是脚注定义**（`[^1]:`）。
    // 脚注定义 comrak 不消费，会按普通段落输出，与 marked 一致，无需保护。
    if label.is_empty() || label.starts_with('^') {
        return false;
    }
    let rest = trimmed[close + 2..].trim_start();
    !rest.is_empty()
}

/// 若整行只有一个开标签（`<tagname ...>` 后除空白外无内容），返回标签名。
///
/// 对齐 marked 的 `^<[^\n>]+>\n` 判定：开标签必须独占一行。
fn standalone_opening_tag(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with('<') || trimmed.starts_with("</") || trimmed.starts_with("<!--") {
        return None;
    }
    let rest = &trimmed[1..];

    let name_len = rest
        .char_indices()
        .take_while(|(_, ch)| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .map(|(index, ch)| index + ch.len_utf8())
        .last()?;
    if name_len == 0 {
        return None;
    }
    let name = &rest[..name_len];
    let after = &rest[name_len..];
    let bytes = after.as_bytes();
    let mut cursor = 0usize;

    loop {
        // 结束标记：`>` 或 `/>`，其后只能是空白
        if bytes.get(cursor) == Some(&b'>') {
            return after[cursor + 1..]
                .trim()
                .is_empty()
                .then(|| name.to_ascii_lowercase());
        }
        if bytes.get(cursor) == Some(&b'/') && bytes.get(cursor + 1) == Some(&b'>') {
            return after[cursor + 2..]
                .trim()
                .is_empty()
                .then(|| name.to_ascii_lowercase());
        }

        // 属性之间必须有空白分隔
        if !matches!(bytes.get(cursor), Some(b' ') | Some(b'\t')) {
            return None;
        }
        while matches!(bytes.get(cursor), Some(b' ') | Some(b'\t')) {
            cursor += 1;
        }
        if bytes.get(cursor) == Some(&b'>')
            || (bytes.get(cursor) == Some(&b'/') && bytes.get(cursor + 1) == Some(&b'>'))
        {
            continue;
        }

        // 属性名：`[a-zA-Z:_][\w.:-]*`
        match bytes.get(cursor) {
            Some(ch) if ch.is_ascii_alphabetic() || *ch == b'_' || *ch == b':' => cursor += 1,
            _ => return None,
        }
        while matches!(
            bytes.get(cursor),
            Some(ch) if ch.is_ascii_alphanumeric() || *ch == b'_' || *ch == b'.' || *ch == b':' || *ch == b'-'
        ) {
            cursor += 1;
        }

        // 可选 `= value`
        let mut probe = cursor;
        while matches!(bytes.get(probe), Some(b' ') | Some(b'\t')) {
            probe += 1;
        }
        if bytes.get(probe) != Some(&b'=') {
            cursor = probe;
            continue;
        }
        probe += 1;
        while matches!(bytes.get(probe), Some(b' ') | Some(b'\t')) {
            probe += 1;
        }
        match bytes.get(probe) {
            Some(&quote @ (b'"' | b'\'')) => {
                probe += 1;
                while let Some(ch) = bytes.get(probe) {
                    if *ch == quote {
                        break;
                    }
                    if *ch == b'\n' {
                        return None;
                    }
                    probe += 1;
                }
                if bytes.get(probe) != Some(&quote) {
                    return None;
                }
                probe += 1;
            }
            Some(ch)
                if !matches!(ch, b'"' | b'\'' | b'`' | b'<' | b'>' | b'=')
                    && !ch.is_ascii_whitespace() =>
            {
                // 裸值：不允许含引号/反引号/尖括号/等号/空白。
                // 含 `"` 时 marked 不把它当 HTML 块（如 `{["a","b"]}`）。
                while let Some(ch) = bytes.get(probe) {
                    if matches!(ch, b'"' | b'\'' | b'`' | b'<' | b'>' | b'=')
                        || ch.is_ascii_whitespace()
                    {
                        break;
                    }
                    probe += 1;
                }
            }
            _ => return None,
        }
        cursor = probe;
    }
}

/// CommonMark 的 HTML 块标签白名单（comrak 内置识别的集合）。
///
/// 与 marked 的 `blockTags` 一致。白名单内的标签交给 comrak 原生处理；
/// 白名单外的标签走本模块的保护路径，以保证与 TS 侧行为一致。
const COMMONMARK_BLOCK_TAGS: &[&str] = &[
    "address",
    "article",
    "aside",
    "base",
    "basefont",
    "blockquote",
    "body",
    "caption",
    "center",
    "col",
    "colgroup",
    "dd",
    "details",
    "dialog",
    "dir",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "frame",
    "frameset",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "html",
    "iframe",
    "legend",
    "li",
    "link",
    "main",
    "menu",
    "menuitem",
    "meta",
    "nav",
    "noframes",
    "ol",
    "optgroup",
    "option",
    "p",
    "param",
    "search",
    "section",
    "summary",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "title",
    "tr",
    "track",
    "ul",
];

/// 是否为 CommonMark 认可的块级 HTML 标签。
fn is_commonmark_block_tag(tag: &str) -> bool {
    COMMONMARK_BLOCK_TAGS.contains(&tag)
}

/// 识别开启围栏行，返回（marker 字符, 长度）。
fn opening_fence(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start();
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let length = trimmed.chars().take_while(|ch| *ch == marker).count();
    if length < 3 {
        return None;
    }
    // 反引号围栏的 info string 不能含反引号
    if marker == '`' && trimmed[length..].contains('`') {
        return None;
    }
    Some((marker, length))
}

/// 是否为闭合围栏行。
fn is_closing_fence(line: &str, marker: char, length: usize) -> bool {
    let trimmed = line.trim();
    let run = trimmed.chars().take_while(|ch| *ch == marker).count();
    run >= length && trimmed.chars().skip(run).all(char::is_whitespace)
}

/// 若整行只有一个闭标签（`</tagname>`），返回标签名。
fn standalone_closing_tag(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let rest = trimmed.strip_prefix("</")?;
    let name_len = rest
        .char_indices()
        .take_while(|(_, ch)| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .map(|(index, ch)| index + ch.len_utf8())
        .last()?;
    if name_len == 0 {
        return None;
    }
    let after = rest[name_len..].trim();
    if after != ">" {
        return None;
    }
    Some(rest[..name_len].to_ascii_lowercase())
}

/// 是否为列表项起始行（`- item` / `1. item` / `  - item`）。
fn is_list_item_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    let rest = if let Some(rest) = trimmed.strip_prefix("- ") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("* ") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("+ ") {
        rest
    } else {
        // 有序列表：数字 + `.` 或 `)` + 空格
        let digits = trimmed.chars().take_while(char::is_ascii_digit).count();
        if digits == 0 {
            return false;
        }
        let after = &trimmed[digits..];
        if let Some(rest) = after.strip_prefix(". ") {
            rest
        } else if let Some(rest) = after.strip_prefix(") ") {
            rest
        } else {
            return false;
        }
    };
    !rest.trim().is_empty()
}

/// 是否为脚注定义行（`[^label]: …`）。
fn is_footnote_definition(line: &str) -> bool {
    let trimmed = line.trim_start();
    let indent = line.len() - trimmed.len();
    if indent > 3 {
        return false;
    }
    let Some(rest) = trimmed.strip_prefix("[^") else {
        return false;
    };
    let Some(close) = rest.find("]:") else {
        return false;
    };
    close > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protects_reference_definition_lines() {
        let result = preprocess("[foo]: https://example.com\n\n[foo]\n");

        // 原文位置被占位符替换（保证该行作为可见文本渲染）。
        assert_eq!(result.restore.len(), 1);
        assert_eq!(result.restore[0].literal, "[foo]: https://example.com");

        // 但定义副本会追加到**文档开头**，让 comrak 仍能把 `[foo]` 解析成链接。
        // 这是双重需求：可见文本 + 引用可解析。
        assert!(
            result.markdown.starts_with("[foo]: https://example.com"),
            "定义副本应在文档开头，实际：{:?}",
            result.markdown
        );
        // 占位符出现在副本之后（即原位置）。
        let after_copy = &result.markdown["[foo]: https://example.com".len()..];
        assert!(after_copy.contains(&result.restore[0].placeholder));
    }

    #[test]
    fn protects_bom_first_line() {
        let result = preprocess("\u{FEFF}# Title\n\nbody\n");
        assert!(!result.markdown.contains("# Title"));
        assert_eq!(result.restore[0].literal, "\u{FEFF}# Title");
    }

    #[test]
    fn leaves_normal_content_untouched() {
        let md = "# 标题\n\n正文 **加粗**\n";
        let result = preprocess(md);
        assert_eq!(result.markdown, md);
        assert!(result.restore.is_empty());
    }

    #[test]
    fn does_not_treat_links_as_definitions() {
        // `[foo](url)` 是行内链接，不是定义
        assert!(!is_reference_definition("[foo](https://example.com)"));
        assert!(!is_reference_definition("[foo]:"));
        assert!(is_reference_definition("[foo]: https://example.com"));
        assert!(is_reference_definition("   [a b]: /path"));
    }
}

#[cfg(test)]
mod tag_tests {
    use super::standalone_opening_tag;

    #[test]
    fn rejects_attribute_values_containing_quotes() {
        // marked 的裸属性值不允许含 `"`，因此这不是 HTML 块
        assert_eq!(standalone_opening_tag("<Tabs items={[\"a\",\"b\"]}>"), None);
    }

    #[test]
    fn accepts_simple_bare_and_quoted_values() {
        assert_eq!(standalone_opening_tag("<Tabs a={1}>"), Some("tabs".into()));
        assert_eq!(
            standalone_opening_tag("<Tabs a=\"b\">"),
            Some("tabs".into())
        );
        assert_eq!(
            standalone_opening_tag("<use_when>"),
            Some("use_when".into())
        );
    }
}
