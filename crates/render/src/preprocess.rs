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
    // 已见过的定义 label（用于复刻 marked「重复定义只保留第一条可见文本」的行为）。
    let mut seen_definitions: std::collections::HashSet<String> = std::collections::HashSet::new();
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
        // TS（marked 侧的前置检查）判定 frontmatter 需要同时满足：
        // 1. 闭合 `---` 与开围栏之间**内容非空**（`---\n---` 不是 frontmatter）；
        // 2. 闭合 `---` 之后必须跟换行（`---\ntitle: x\n---` 结尾无换行时不是）。
        //
        // comrak 的条件更宽松，会把这两种形态都当 frontmatter 吞掉。
        // 因此这里识别「不满足 TS 条件」的情形，把开围栏保护成 `<hr />`，
        // 让 comrak 看不到 frontmatter。
        if index == 0 && pseudo_frontmatter(&lines) {
            let placeholder = placeholder_for(&mut counter);
            restore.push(restore_item(
                placeholder.clone(),
                "<hr />\n".to_string(),
                false,
            ));
            out.push_str(&placeholder);
            // 后续若是 `---` 或段落，必须用空行终止这个块级占位符，
            // 否则 comrak 会把它们并进同一个 HtmlBlock（实测 `---\n---` 被吞）。
            out.push_str("\n\n");
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

        // ---- 2) 引用定义行（`[label]: dest` 与脚注写法 `[^label]: dest` 同构）----
        //
        // 三重需求：
        // - marked 把整条定义（含写在下一行的 dest / title）消费成一个 `def` token，
        //   而 TS 的渲染管线没有 `def` 分支，token 落进「默认按段落渲染」的分支，
        //   于是**定义原文成为可见段落**——原文必须原位保留；
        // - `[label]` 引用仍要解析成链接，而 comrak 依赖定义行才能解析——
        //   因此定义副本要注入文首（定义本身不产生可见输出）；
        // - comrak 会把定义行彻底吞掉，所以原位必须换成占位符，否则可见文本消失。
        //
        // 另有三个 marked 细节必须复刻：
        // 1. 重复 label（小写 + 折叠空白后比较）整行丢弃，但它的换行会留在上一条
        //    定义的可见文本里（marked 的 `blockTokens` 在丢弃时仍推进源码位置）；
        // 2. 定义段落独占一个块，后面紧跟内容时另起段落；
        // 3. 脚注写法在 marked 里就是普通链接定义（label 为 `^1`），因此两种写法走
        //    同一条分支，`[^1]` / `[^1][]` / 大小写差异全部交给 comrak 按引用链接解析。
        let (prefix, content) = split_container_prefix(body);
        let next_line =
            definition_continuation(lines.get(index + 1).copied().map(strip_line_ending));
        if let Some(head) = parse_definition(content, next_line) {
            let mut covered = 1 + head.extra_lines;
            // label 已登记：marked 整行丢弃，不产生任何可见文本
            // （与「紧邻的重复定义」不同，它连换行也不会留下）。
            if !seen_definitions.insert(head.label.clone()) {
                skip_until = index + covered;
                continue;
            }
            let mut visible = definition_visible_text(&lines, index, content, head.extra_lines);
            if definition_keeps_trailing_newline(&lines, index + covered - 1) {
                visible.push('\n');
            }
            // 紧随其后的重复定义行：marked 丢弃其文本，只保留换行。
            while let Some(duplicate) =
                duplicate_definition_at(&lines, index + covered, &seen_definitions)
            {
                covered += 1 + duplicate.extra_lines;
                let newlines = duplicate.extra_lines
                    + usize::from(definition_keeps_trailing_newline(
                        &lines,
                        index + covered - 1,
                    ));
                for _ in 0..newlines {
                    visible.push('\n');
                }
            }
            // 定义副本：去掉缩进与尾部空白的裸定义行（容器前缀会让 comrak 生成
            // 额外的空 blockquote / 空列表项，因此副本必须是顶层裸定义）。
            definitions.push(visible.trim().to_string());
            let placeholder = inline_placeholder_for(&mut counter);
            restore.push(restore_item(placeholder.clone(), visible, true));
            out.push_str(prefix);
            out.push_str(&placeholder);
            if lines
                .get(index + covered - 1)
                .is_some_and(|line| line.ends_with('\n'))
            {
                out.push('\n');
            }
            // 定义段落独占一个块：紧跟普通内容（含缩进续行、下一条定义）时补一个
            // 空行，否则 comrak 会把占位符和后续内容并成同一个段落。
            // 容器内的定义行（`- [b]: /u`）不能补空行：那会改变列表的紧密性。
            if prefix.is_empty() && definition_followed_by_content(&lines, index + covered - 1) {
                out.push('\n');
            }
            skip_until = index + covered;
            continue;
        }

        // ---- 2.01) 「像定义但目标为空」的行 ----
        //
        // `[^1]: ` / `[b]:` 这类行 marked 不认（`def` 要求目标非空），退化成普通段落
        // 文本；comrak 同样拒绝，但会**吞掉行尾空白**（`[^1]: ` → `[^1]:`），
        // 因此整行保护成字面量。
        if incomplete_definition_line(content) {
            let placeholder = inline_placeholder_for(&mut counter);
            restore.push(restore_item(placeholder.clone(), content.to_string(), true));
            out.push_str(prefix);
            out.push_str(&placeholder);
            if has_newline {
                out.push('\n');
            }
            continue;
        }

        // ---- 2.05) 折叠式 alert 标记 ----
        //
        // `> [!NOTE]-` 这类写法：TS 的正则要求 `]` 之后只能是行尾或「空白 + 标题」，
        // 因此 TS 侧退化为普通引用块并保留字面 `[!NOTE]-`；
        // comrak 的 alerts 更宽松会识别为 callout。
        // 这里把 `!` 换成行内占位符，打断 comrak 的 alert 识别。
        let has_following_content = lines
            .iter()
            .skip(index + 1)
            .any(|rest| !rest.trim().is_empty());
        if let Some(marker_offset) = inline_alert_marker_offset(body, has_following_content) {
            let placeholder = inline_placeholder_for(&mut counter);
            restore.push(restore_item(placeholder.clone(), "!".to_string(), true));
            out.push_str(&body[..marker_offset]);
            out.push_str(&placeholder);
            out.push_str(&body[marker_offset + 1..]);
            if has_newline {
                out.push('\n');
            }
            continue;
        }

        // ---- 2.1) 裸有序列表标记 ----
        //
        // marked 把裸 `1.`（后面没有任何字符，连空格都没有）当作空的有序列表项，
        // comrak 则要求标记后必须有分隔空白。补一个空格让它与 TS 一致。
        if is_bare_ordered_marker(body) {
            out.push_str(body);
            out.push(' ');
            if has_newline {
                out.push('\n');
            }
            continue;
        }

        // ---- 2.15) 空复选框列表项 ----
        //
        // marked 的任务列表判定是 `^\[[ xX]\] +\S`：复选框后**必须**还有非空白内容。
        // 因此 `- [ ]`（内容为空）在 TS 侧只是普通列表项，`[ ]` 是可见文本；
        // comrak 的 tasklist 扩展则会把它识别成空的任务项。
        // 这里把复选框保护成行内占位符，让它退化为普通文本。
        if let Some(caps) = match_empty_checkbox_item(body) {
            let (prefix, marker_text) = caps;
            let placeholder = inline_placeholder_for(&mut counter);
            restore.push(restore_item(placeholder.clone(), marker_text, true));
            out.push_str(&prefix);
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
        // frontmatter 必须在**文档最开头**，否则 comrak 不再识别它
        // （实测 `---\n\n---\n\n[foo]: /u` 因定义副本前置而退化成两条分隔线）。
        // 因此定义副本插入到 frontmatter 块之后。
        let (frontmatter, body) = split_leading_frontmatter(&out);
        combined.push_str(frontmatter);
        // 定义行必须是「裸」的才能被 comrak 解析为链接定义（放进 HTML 注释无效）。
        for definition in &definitions {
            combined.push_str(definition);
            combined.push('\n');
        }
        // 定义行后若紧跟表格/HTML，comrak 会把定义行当成段落。
        // 用 HTML 注释隔开（会被 restore_placeholders 清除）。
        combined.push_str("<!--md-def-sep-->");
        combined.push('\n');
        combined.push_str(body);
        combined
    };

    let markdown = protect_table_delimiters(&markdown);

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
/// 剥离行首的容器标记（引用块 `>` 与列表标记），返回（前缀, 剩余内容）。
///
/// 容器内的定义行（`> [foo]: /u`、`- [foo]: /u`）在 TS 侧同样是**可见文本**，
/// 因此判定定义前必须先剥掉这些前缀，输出时再把前缀接回去。
fn split_container_prefix(line: &str) -> (&str, &str) {
    let mut rest = line;
    loop {
        let trimmed = rest.trim_start();
        let lead = rest.len() - trimmed.len();
        // 引用块标记
        if let Some(after) = trimmed.strip_prefix('>') {
            let after = after.strip_prefix([' ', '\t']).unwrap_or(after);
            rest = after;
            continue;
        }
        // 列表标记（`- ` / `* ` / `+ ` / `1. `）
        let bullet_len = if trimmed.starts_with("- ")
            || trimmed.starts_with("* ")
            || trimmed.starts_with("+ ")
        {
            Some(2)
        } else {
            let digits = trimmed.chars().take_while(char::is_ascii_digit).count();
            if digits > 0
                && (trimmed[digits..].starts_with(". ") || trimmed[digits..].starts_with(") "))
            {
                Some(digits + 2)
            } else {
                None
            }
        };
        if let Some(len) = bullet_len {
            // 只有 lead 很小（顶层容器）时才剥；嵌套缩进交给调用方
            let _ = lead;
            rest = &trimmed[len..];
            continue;
        }
        return (line.split_at(line.len() - rest.len()).0, rest);
    }
}

/// 一条引用定义的解析结果（对齐 marked 的 `def` 规则）。
struct DefinitionHead {
    /// 规范化 label（小写 + 折叠空白），与 marked 的 `tag` 一致。
    ///
    /// `[^1]` 这类脚注写法在 marked 里就是普通标签 `^1`，因此一并规范化。
    label: String,
    /// 该定义额外占用的后续行数（dest 或 title 写在下一行时为 1）。
    extra_lines: usize,
}

/// 解析 `[label]: dest "title"`，容忍 dest / title 写在下一行。
///
/// `content` 是去掉容器标记后的行内容，`next` 是下一行的内容（容器标记已去掉）。
/// 返回 `None` 表示 marked 不会把这一行当定义（目标是空、缺引号的 title、
/// 行尾还有多余文字等），此时该行只是普通段落文本。
fn parse_definition(content: &str, next: Option<&str>) -> Option<DefinitionHead> {
    // 定义可以跨行，因此把两行拼起来按游标扫描。
    let joined;
    let text: &str = match next {
        Some(next) => {
            joined = format!("{content}\n{next}");
            &joined
        }
        None => content,
    };

    // 行首缩进最多 3 个空格，然后是 `[label]:`
    let trimmed = text.trim_start_matches([' ', '\t']);
    if text.len() - trimmed.len() > 3 {
        return None;
    }
    let after_bracket = trimmed.strip_prefix('[')?;
    let close = after_bracket.find(']')?;
    let raw_label = &after_bracket[..close];
    if raw_label.is_empty() {
        return None;
    }
    let mut rest = after_bracket[close + 1..].strip_prefix(':')?;
    let mut lines = 1usize;

    // 目标：`<dest>` 或裸 token；缺少目标时 marked 不认这是定义。
    rest = rest.trim_start_matches([' ', '\t']);
    if rest.starts_with('\n') {
        rest = skip_to_next_line(rest);
        lines += 1;
    }
    let after_dest = if let Some(inner) = rest.strip_prefix('<') {
        let end = inner.find('>')?;
        if end == 0 {
            return None;
        }
        &inner[end + 1..]
    } else {
        let length = rest
            .find(|c: char| c.is_whitespace() || c == '>')
            .unwrap_or(rest.len());
        if length == 0 {
            return None;
        }
        &rest[length..]
    };

    // 之后只能是行尾，或「空白 + title」（title 也可以写在下一行）。
    rest = after_dest.trim_start_matches([' ', '\t']);
    if !rest.is_empty() && !rest.starts_with('\n') {
        // 同一行的 title 必须一路占到行尾
        rest = parse_definition_title(rest)?;
        rest = rest.trim_start_matches([' ', '\t']);
        if !rest.is_empty() && !rest.starts_with('\n') {
            return None;
        }
        return Some(DefinitionHead {
            label: normalize_definition_label(raw_label),
            extra_lines: lines - 1,
        });
    }
    // 行尾：下一行可能只是 title
    if let Some(next_line) = rest.strip_prefix('\n') {
        let candidate = next_line.trim_start_matches([' ', '\t']);
        if parse_definition_title(candidate).is_some_and(|after| after.trim().is_empty()) {
            lines += 1;
        }
    }
    Some(DefinitionHead {
        label: normalize_definition_label(raw_label),
        extra_lines: lines - 1,
    })
}

/// 解析引号 / 括号形式的 title，返回其后的剩余文本。
fn parse_definition_title(text: &str) -> Option<&str> {
    let mut chars = text.char_indices();
    let (_, open) = chars.next()?;
    let close = match open {
        '"' => '"',
        '\'' => '\'',
        '(' => ')',
        _ => return None,
    };
    let mut escaped = false;
    for (index, ch) in chars {
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' if close != ')' => escaped = true,
            // marked 的括号式 title 不允许嵌套
            '(' if close == ')' => return None,
            ch if ch == close => return Some(&text[index + ch.len_utf8()..]),
            _ => {}
        }
    }
    None
}

/// 跳过换行与下一行的缩进。
fn skip_to_next_line(rest: &str) -> &str {
    let after = rest.strip_prefix('\n').unwrap_or(rest);
    after.trim_start_matches([' ', '\t'])
}

/// 规范化定义 label，与 marked 的 `tag` 一致：小写 + 折叠内部空白。
///
/// 这是「重复定义」与「引用解析」共用的 key：`[^A]: /u` 与 `[^a]` 必须命中同一条。
fn normalize_definition_label(raw: &str) -> String {
    raw.to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// 去掉行尾换行与 CR。
fn strip_line_ending(line: &str) -> &str {
    let line = line.strip_suffix('\n').unwrap_or(line);
    line.strip_suffix('\r').unwrap_or(line)
}

/// 取「定义续行」的内容：容器标记变化说明那是另一块内容，不算续行。
fn definition_continuation(line: Option<&str>) -> Option<&str> {
    let line = line?;
    let (prefix, content) = split_container_prefix(line);
    prefix.is_empty().then_some(content)
}

/// 定义覆盖的源码行拼成的可见原文（保留缩进，行间用 `\n` 连接）。
fn definition_visible_text(
    lines: &[&str],
    index: usize,
    content: &str,
    extra_lines: usize,
) -> String {
    let mut visible = String::from(content);
    for offset in 1..=extra_lines {
        let line = lines
            .get(index + offset)
            .copied()
            .map(strip_line_ending)
            .unwrap_or("");
        visible.push('\n');
        visible.push_str(split_container_prefix(line).1);
    }
    visible
}

/// directive / callout 的闭围栏行（`:::`）。
///
/// 容器体在 TS 侧是 **trim 之后**再交给 marked 解析的，因此体末尾不会留下换行。
fn is_directive_closing_fence(line: &str) -> bool {
    let trimmed = line.trim_end_matches([' ', '\t']);
    trimmed.len() >= 3 && trimmed.chars().all(|ch| ch == ':')
}

/// 定义行之后是否紧跟「普通内容」——既不是空行，也不是容器闭围栏。
///
/// 这两个边界决定了定义原文要不要带尾换行，以及要不要另起段落：
/// 空行会被 lexer 切成独立的空白 token（换行不进定义原文），
/// 而 directive / callout 的容器体是 trim 后再解析的（同理不留换行）。
fn definition_followed_by_content(lines: &[&str], index: usize) -> bool {
    match lines.get(index + 1) {
        Some(next) => {
            let next = strip_line_ending(next);
            !next.trim().is_empty() && !is_directive_closing_fence(next)
        }
        None => false,
    }
}

/// 定义行的可见文本是否带尾换行。
///
/// marked 的 `def` token 原文包含紧随其后的换行，只有后面是空行 / 容器闭围栏时
/// 例外，因此 `[b]: /u\n\n` 的可见文本是 `[b]: /u`，
/// 而 `[b]: /u\n正文` 与 `[b]: /u\n`（文档末尾）都是 `[b]: /u\n`。
fn definition_keeps_trailing_newline(lines: &[&str], index: usize) -> bool {
    let Some(line) = lines.get(index) else {
        return false;
    };
    line.ends_with('\n')
        && (lines.get(index + 1).is_none() || definition_followed_by_content(lines, index))
}

/// 「像定义但目标为空」的行（`[^1]: ` / `[b]:   `）。
///
/// marked 的 `def` 要求目标非空，因此这些行退化成普通段落文本；comrak 同样拒绝，
/// 但会**吞掉行尾空白**（`[^1]: ` → `[^1]:`），与 TS 的可见文本不一致。
/// 因此调用方把整行保护成字面量。
fn incomplete_definition_line(content: &str) -> bool {
    let trimmed_end = content.trim_end_matches([' ', '\t']);
    // 行尾没有空白：comrak 与 marked 结果一致，无需保护
    if trimmed_end.len() == content.len() {
        return false;
    }
    let trimmed = trimmed_end.trim_start_matches([' ', '\t']);
    if trimmed_end.len() - trimmed.len() > 3 {
        return false;
    }
    let Some(rest) = trimmed.strip_prefix('[') else {
        return false;
    };
    let Some(close) = rest.find(']') else {
        return false;
    };
    rest[close + 1..].trim_matches([' ', '\t']) == ":"
}

/// 取 `index` 处「label 已登记」的重复定义行。
fn duplicate_definition_at(
    lines: &[&str],
    index: usize,
    seen: &std::collections::HashSet<String>,
) -> Option<DefinitionHead> {
    let (_, content) = split_container_prefix(strip_line_ending(lines.get(index).copied()?));
    let next_line = definition_continuation(lines.get(index + 1).copied().map(strip_line_ending));
    let head = parse_definition(content, next_line)?;
    seen.contains(&head.label).then_some(head)
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
        assert!(parse_definition("[foo](https://example.com)", None).is_none());
        assert!(parse_definition("[foo]:", None).is_none());
        assert!(parse_definition("[foo]: https://example.com", None).is_some());
        assert!(parse_definition("   [a b]: /path", None).is_some());
        // `[b]: /u v` 的尾巴不是合法的 title，marked 不当定义
        assert!(parse_definition("[b]: /u v", None).is_none());
    }

    #[test]
    fn parses_definitions_that_span_two_lines() {
        // 目标在下一行
        let head = parse_definition("[b]:", Some("/u")).expect("跨行目标应识别为定义");
        assert_eq!(head.label, "b");
        assert_eq!(head.extra_lines, 1);

        // title 在下一行
        let head = parse_definition("[b]: /u", Some("   \"multi line title\""))
            .expect("跨行 title 应识别为定义");
        assert_eq!(head.extra_lines, 1);

        // 同一行的 title
        let head = parse_definition("[b]: /u (t)", None).expect("同行 title 应识别为定义");
        assert_eq!(head.extra_lines, 0);
    }

    #[test]
    fn normalizes_definition_labels_like_marked() {
        // 重复定义判定与引用解析共用同一个 key：小写 + 折叠空白
        assert_eq!(normalize_definition_label("^A"), "^a");
        assert_eq!(normalize_definition_label("a   b"), "a b");
    }

    #[test]
    fn keeps_definition_visible_text_with_indent() {
        // title 写在下一行：可见文本保留原始缩进，且整条定义成为可见段落
        let result = preprocess("[b]: /u\n   \"multi line title\"\n");
        assert_eq!(result.restore.len(), 1);
        assert_eq!(
            result.restore[0].literal,
            "[b]: /u\n   \"multi line title\"\n"
        );
        // 注入给 comrak 的副本必须带 title，否则 `[a][b]` 少了 title 属性
        assert!(
            result.markdown.contains("[b]: /u\n   \"multi line title\""),
            "定义副本应保留 title，实际：{:?}",
            result.markdown
        );
    }

    #[test]
    fn drops_duplicate_definitions_but_keeps_their_newline() {
        // 重复 label 整行丢弃，换行留在上一条定义的可见文本里
        let result = preprocess("[b]: /u\n[b]: /v\n");
        assert_eq!(result.restore.len(), 1);
        assert_eq!(result.restore[0].literal, "[b]: /u\n\n");
        // 只有第一条被注入给 comrak
        assert!(!result.markdown.contains("[b]: /v"));

        // 中间隔着空行时，重复定义整行消失（不留下可见文本）
        let result = preprocess("[b]: /u\n\n[b]: /v\n");
        assert_eq!(result.restore.len(), 1);
        assert_eq!(result.restore[0].literal, "[b]: /u");
        assert!(!result.markdown.contains("[b]: /v"));
    }

    #[test]
    fn separates_definition_paragraph_from_following_block() {
        // 定义段落独占一个块：后面的四空格续行在 TS 侧是缩进代码块
        let result = preprocess("[^1]: /u\n    续行内容\n");
        assert_eq!(result.restore[0].literal, "[^1]: /u\n");
        assert!(
            result.markdown.contains(&format!(
                "{}\n\n    续行内容",
                result.restore[0].placeholder
            )),
            "定义段落与续行之间应补空行，实际：{:?}",
            result.markdown
        );
    }

    #[test]
    fn protects_incomplete_definition_lines() {
        // `[^1]: ` 目标是空：marked 当普通段落（保留行尾空格），comrak 会吞掉空白
        let result = preprocess("[^1]: \n");
        assert_eq!(result.restore.len(), 1);
        assert_eq!(result.restore[0].literal, "[^1]: ");
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

/// 匹配「列表项只有空复选框」的形态，返回（行前缀, 复选框文本）。
///
/// 例：`- [ ]`、`  - [x] `、`1. [ ]`。marked 要求复选框后必须有非空白内容，
/// 因此这些在 TS 侧不是任务项。
fn match_empty_checkbox_item(line: &str) -> Option<(String, String)> {
    let trimmed_end = line.trim_end();
    let trimmed = trimmed_end.trim_start();
    // 定位列表标记（含缩进）
    let indent = trimmed_end.len() - trimmed.len();
    let prefix_len =
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
            2
        } else {
            let digits = trimmed.chars().take_while(char::is_ascii_digit).count();
            if digits > 0
                && (trimmed[digits..].starts_with(". ") || trimmed[digits..].starts_with(") "))
            {
                digits + 2
            } else {
                return None;
            }
        };
    let after_marker = &trimmed[prefix_len..];
    // 复选框本身必须是**唯一**内容
    let marker_text = after_marker.trim_end();
    if marker_text != "[ ]" && marker_text != "[x]" && marker_text != "[X]" {
        return None;
    }
    Some((
        trimmed_end[..indent + prefix_len].to_string(),
        marker_text.to_string(),
    ))
}

/// 文档开头的 `---…---` 是否**不满足** TS 的 frontmatter 条件。
///
/// 对应两种情形：
/// - 闭合 `---` 紧接开围栏（内容为空）：`---\n---`
/// - 闭合 `---` 位于文档末尾且无尾随换行：`---\ntitle: x\n---`
fn pseudo_frontmatter(lines: &[&str]) -> bool {
    let Some(first) = lines.first() else {
        return false;
    };
    if first.trim_end_matches(['\n', '\r']) != "---" {
        return false;
    }
    // 找闭合行
    for (offset, raw) in lines.iter().enumerate().skip(1) {
        let line = raw.trim_end_matches(['\n', '\r']);
        if line == "---" {
            // 情形 1：闭合紧接开围栏
            if offset == 1 {
                return true;
            }
            // 情形 2：闭合是最后一行且没有尾随换行
            let is_last = offset + 1 == lines.len();
            if is_last && !raw.ends_with('\n') {
                return true;
            }
            return false;
        }
    }
    false
}

/// 是否为「裸有序列表标记」（`1.` / `2)`，其后没有任何字符）。
fn is_bare_ordered_marker(line: &str) -> bool {
    let trimmed = line.trim_start();
    let indent = line.len() - trimmed.len();
    if indent > 3 {
        return false;
    }
    let digits = trimmed.chars().take_while(char::is_ascii_digit).count();
    if digits == 0 {
        return false;
    }
    let after = &trimmed[digits..];
    after == "." || after == ")"
}

/// 切出文档开头的 frontmatter 块（含结尾换行），返回（frontmatter, 其余内容）。
///
/// 不是 frontmatter 时返回（空串, 全文）。
fn split_leading_frontmatter(markdown: &str) -> (&str, &str) {
    if !markdown.starts_with("---\n") {
        return ("", markdown);
    }
    let mut offset = 4;
    while offset <= markdown.len() {
        let line_end = markdown[offset..]
            .find('\n')
            .map(|index| offset + index)
            .unwrap_or(markdown.len());
        if markdown[offset..line_end].trim_end_matches('\r') == "---" {
            let end = (line_end + 1).min(markdown.len());
            return markdown.split_at(end);
        }
        if line_end >= markdown.len() {
            break;
        }
        offset = line_end + 1;
    }
    ("", markdown)
}

/// 定位行内 `[!TYPE]` 标记里的 `!`，仅当 `]` 之后是非空白字符时返回其字节偏移。
///
/// TS 的 callout 正则要求 `]` 之后是行尾或「空白 + 标题」；
/// `> [!NOTE]-` 不满足，因此不能交给 comrak 的 alerts 扩展识别。
fn inline_alert_marker_offset(line: &str, has_following_content: bool) -> Option<usize> {
    let trimmed = line.trim_start();
    let indent = line.len() - trimmed.len();
    // 允许引用块前缀
    let (prefix_len, content) = {
        let mut rest = trimmed;
        let mut consumed = 0usize;
        loop {
            let t = rest.trim_start();
            let lead = rest.len() - t.len();
            match t.strip_prefix('>') {
                Some(after) => {
                    let after = after.strip_prefix([' ', '\t']).unwrap_or(after);
                    consumed += lead + 1 + (t.len() - 1 - after.len());
                    rest = after;
                }
                None => break,
            }
        }
        (indent + consumed, rest)
    };
    if !content.starts_with("[!") {
        return None;
    }
    let after = &content[2..];
    // comrak 对类型名大小写不敏感，TS 的正则带 `i` 标志同样不敏感；
    // 只认全大写会漏掉 `> [!note]-` 这类写法（实测 Rust 会误判成 callout）。
    let type_len = after.chars().take_while(char::is_ascii_alphabetic).count();
    if type_len == 0 {
        return None;
    }
    let known = [
        "note",
        "tip",
        "important",
        "warning",
        "caution",
        "info",
        "danger",
    ];
    if !known.contains(&after[..type_len].to_ascii_lowercase().as_str()) {
        return None;
    }
    let rest = &after[type_len..];
    if !rest.starts_with(']') {
        return None;
    }
    let after_close = &rest[1..];

    // TS 正则：`(?:[ \t]+([^\r\n]+))?` —— `]` 之后只能是
    //   (a) 行尾（无标题）
    //   (b) 空白 + **至少一个**非换行字符（标题）
    // 因此「空白后直接行尾」和「非空白非行尾字符」都不成立。
    if after_close.is_empty() {
        return None;
    }
    if after_close.starts_with([' ', '\t']) {
        if !after_close.trim().is_empty() {
            return None;
        }
        // 尾随空白全是空白字符时，只有**恰好一个**才不是 callout。
        // TS 正则的标题捕获是 `/^(?:[ \t]+([^\r\n]+))?/`：单个空白后没有字符可捕获，
        // 整个可选组匹配失败；两个及以上时第一个空白充当"标题"，反而能匹配成功。
        // 实测 `> [!NOTE] ` → 引用块，`> [!NOTE]  `（两个空格）→ callout。
        if after_close.chars().count() == 1 {
            // 单个尾随空白只有在「后面真的还有内容」时才让标题捕获失败；
            // 文档末尾（哪怕带一个换行）会被抹掉，仍然是 callout。
            return has_following_content.then_some(prefix_len + 1);
        }
        return None;
    }
    Some(prefix_len + 1)
}

/// 给「没有首尾竖线」的表格分隔行补上竖线。
///
/// comrak 的块起始判定把「列表」排在「表格」之前：`a | b` 的下一行若是 `- | -`，
/// 这一行会先被吃成列表项，`handle_table` 再也看不到它，整张表格退化成
/// 「段落 + 列表」。marked 则正确识别为表格。
///
/// 分隔行写成 `| - | - |` 时行首不再是 `- ` 列表标记，comrak 就能走到表格分支；
/// 而按 GFM，首尾竖线只是可选的边界分隔符，两种写法**列数完全相同**，
/// 因此这个改写不改变任何输出语义。
///
/// 判定要求「与上一行的单元格数一致」，避免把普通列表/分隔线误当成分隔行。
fn protect_table_delimiters(markdown: &str) -> String {
    let lines: Vec<&str> = markdown.split('\n').collect();
    let mut out = String::with_capacity(markdown.len() + lines.len());

    for (index, line) in lines.iter().enumerate() {
        let previous = index.checked_sub(1).map(|i| lines[i]).unwrap_or("");
        let replaced = if line.trim_start().starts_with('|') {
            None
        } else {
            table_delimiter_with_pipes(line, previous)
        };
        out.push_str(replaced.as_deref().unwrap_or(line));
        if index + 1 < lines.len() {
            out.push('\n');
        }
    }
    out
}

/// 若该行是「列数与上一行一致」的表格分隔行，返回补上首尾竖线的版本。
fn table_delimiter_with_pipes(line: &str, previous: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() || !trimmed.contains('-') || !previous.contains('|') {
        return None;
    }
    // 只处理由 `|`、`-`、`:`、空白组成的行
    if !trimmed
        .chars()
        .all(|c| matches!(c, '|' | '-' | ':' | ' ' | '\t'))
    {
        return None;
    }
    let cells = split_table_cells(trimmed);
    if cells.len() < 1 || cells.len() != split_table_cells(previous.trim()).len() {
        return None;
    }
    for cell in &cells {
        let cell = cell.trim();
        let core = cell.trim_matches(':');
        if core.is_empty() || !core.chars().all(|c| c == '-') {
            return None;
        }
    }
    let leading = line.len() - line.trim_start().len();
    Some(format!("{}|{}|", " ".repeat(leading), trimmed))
}

/// 按未转义的 `|` 切分表格行，并丢弃首尾竖线产生的空片段。
fn split_table_cells(line: &str) -> Vec<String> {
    let mut cells: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut escaped = false;
    for ch in line.chars() {
        match ch {
            '\\' if !escaped => {
                escaped = true;
                current.push(ch);
            }
            '|' if !escaped => {
                cells.push(std::mem::take(&mut current));
            }
            _ => {
                escaped = false;
                current.push(ch);
            }
        }
    }
    cells.push(current);
    if cells.first().map(|c| c.trim().is_empty()).unwrap_or(false) {
        cells.remove(0);
    }
    if cells.last().map(|c| c.trim().is_empty()).unwrap_or(false) {
        cells.pop();
    }
    cells
}
