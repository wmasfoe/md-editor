use inkpoint_editor_core::{BlockKind, InlineFormat, InlineMarkKind, MarkdownDocument};

#[test]
fn block_ranges_use_utf8_bytes_and_slice_original_source() {
    let source = "# 标题\n\n> 第一段\n> 第二段\n\n- [x] 完成\n- 待办\n\n\x60\x60\x60rust\nfn main() {}\n\x60\x60\x60\n";
    let document = MarkdownDocument::new(source);
    let blocks = document.blocks().unwrap();

    assert_eq!(blocks[0].kind, BlockKind::Heading { level: 1 });
    assert_eq!(&source[blocks[0].range.clone()], "# 标题");
    assert_eq!(blocks[0].range.start, 0);

    let quote = blocks
        .iter()
        .find(|block| block.kind == BlockKind::Blockquote)
        .unwrap();
    assert_eq!(&source[quote.range.clone()], "> 第一段\n> 第二段");
    assert_eq!(quote.children.len(), 1);

    let list = blocks
        .iter()
        .find(|block| matches!(block.kind, BlockKind::List { .. }))
        .unwrap();
    assert!(matches!(
        list.children[0].kind,
        BlockKind::ListItem {
            checked: Some(true)
        }
    ));

    let code = blocks
        .iter()
        .find(|block| matches!(block.kind, BlockKind::Code { .. }))
        .unwrap();
    let BlockKind::Code {
        language: Some(range),
    } = &code.kind
    else {
        panic!("language range")
    };
    assert_eq!(&source[range.clone()], "rust");
}

/// A fence info string holding full-width punctuation still resolves.
///
/// Same root cause as the code-span mark: the info string is parsed from the
/// CJK-rewritten text, so ` ```「rust」 ` arrives carrying `一` and a plain
/// search in the original source found nothing. The language then silently
/// became `None`. Measured before the fix: `None` for the punctuated fence,
/// `Some("rust")` for the plain one.
#[test]
fn a_fence_info_string_with_cjk_punctuation_resolves() {
    let source = "```「rust」\ncode\n```\n";
    let blocks = MarkdownDocument::new(source).blocks().unwrap();
    let code = blocks
        .iter()
        .find(|block| matches!(block.kind, BlockKind::Code { .. }))
        .expect("the fence is a code block");
    let BlockKind::Code {
        language: Some(range),
    } = &code.kind
    else {
        panic!("the punctuated info string must resolve to a range");
    };
    assert_eq!(
        &source[range.clone()],
        "「rust」",
        "the range addresses the user's own bytes, punctuation intact"
    );
}

#[test]
fn markdown_source_round_trips_exactly_without_ast_serialization() {
    let source = "---\r\ntitle: exact\r\n---\r\n\r\n## Heading ##  \r\n\r\nText  \r\nline  \r\n\r\n<Table attr='x'>\r\n";
    let document = MarkdownDocument::new(source);
    assert_eq!(document.source(), source);
    assert_eq!(document.clone().into_source(), source);
    assert!(document.blocks().is_ok());
}

#[test]
fn block_projection_accepts_mdx_gfm_math_and_yaml_frontmatter() {
    let source = "---\ntitle: demo\n---\n\n<Callout>{value}</Callout>\n\n| a | b |\n| - | - |\n| x | y |\n\n$math$\n";
    let document = MarkdownDocument::new(source);
    let blocks = document.blocks().unwrap();

    assert!(
        blocks
            .iter()
            .any(|block| block.kind == BlockKind::Frontmatter)
    );
    assert!(blocks.iter().any(|block| block.kind == BlockKind::Table));
    assert!(blocks.iter().any(|block| block.kind == BlockKind::Html));
    assert!(
        blocks
            .iter()
            .all(|block| source.is_char_boundary(block.range.start)
                && source.is_char_boundary(block.range.end))
    );
}

#[test]
fn table_projection_excludes_delimiters_and_preserves_padding_and_inline_source() {
    let source = "|  **bold** \\| x  | |\n| --- | --- |\n| *y* |  z |\n";
    let blocks = MarkdownDocument::new(source).blocks().unwrap();
    let table = blocks
        .iter()
        .find(|block| block.kind == BlockKind::Table)
        .unwrap();
    assert_eq!(table.children.len(), 2);
    let header = &table.children[0];
    assert_eq!(header.kind, BlockKind::TableRow);
    assert_eq!(&source[header.range.clone()], "|  **bold** \\| x  | |");
    assert_eq!(header.children.len(), 2);
    assert_eq!(header.children[0].kind, BlockKind::TableCell);
    assert_eq!(
        &source[header.children[0].range.clone()],
        "  **bold** \\| x  "
    );
    assert_eq!(
        &source[header.children[0].content_range.clone()],
        "**bold** \\| x"
    );
    assert_eq!(&source[header.children[1].range.clone()], " ");
    assert!(header.children[1].content_range.is_empty());

    let body = &table.children[1];
    assert_eq!(&source[body.children[0].content_range.clone()], "*y*");
    assert_eq!(&source[body.children[1].content_range.clone()], "z");
    assert!(body.children.iter().all(|cell| {
        source.is_char_boundary(cell.range.start)
            && source.is_char_boundary(cell.range.end)
            && source.is_char_boundary(cell.content_range.start)
            && source.is_char_boundary(cell.content_range.end)
    }));
}

#[test]
fn heading_content_range_excludes_heading_markers_and_closing_hashes() {
    let source = "### **标题** ###\n\nBody\n";
    let heading = MarkdownDocument::new(source).blocks().unwrap().remove(0);

    assert_eq!(heading.kind, BlockKind::Heading { level: 3 });
    assert_eq!(&source[heading.range.clone()], "### **标题** ###");
    assert_eq!(&source[heading.content_range.clone()], "**标题**");
}

#[test]
fn table_projection_supports_rows_without_outer_delimiters() {
    let source = "A | B\n--- | ---\nC | D\n";
    let table = MarkdownDocument::new(source)
        .blocks()
        .unwrap()
        .into_iter()
        .find(|block| block.kind == BlockKind::Table)
        .unwrap();

    assert_eq!(table.children.len(), 2);
    assert_eq!(table.children[0].children.len(), 2);
    assert_eq!(
        &source[table.children[0].children[0].content_range.clone()],
        "A"
    );
    assert_eq!(
        &source[table.children[0].children[1].content_range.clone()],
        "B"
    );
    assert_eq!(
        &source[table.children[1].children[0].content_range.clone()],
        "C"
    );
}

#[test]
fn inline_marks_separate_content_syntax_and_nested_ranges() {
    let source = "中文 **加粗 _强调_** 与 [链接](https://example.test) ~~删除~~ \x60代码\x60";
    let marks = MarkdownDocument::new(source).inline_marks().unwrap();

    let strong = marks
        .iter()
        .find(|mark| mark.kind == InlineMarkKind::Strong)
        .unwrap();
    assert_eq!(&source[strong.range.clone()], "加粗 _强调_");
    assert_eq!(&source[strong.syntax_range.clone()], "**加粗 _强调_**");
    let emphasis = marks
        .iter()
        .find(|mark| mark.kind == InlineMarkKind::Emphasis)
        .unwrap();
    assert_eq!(&source[emphasis.range.clone()], "强调");
    let link = marks
        .iter()
        .find(|mark| matches!(mark.kind, InlineMarkKind::Link { .. }))
        .unwrap();
    assert_eq!(&source[link.range.clone()], "链接");
    assert_eq!(
        &source[link.syntax_range.clone()],
        "[链接](https://example.test)"
    );
}

/// A code span holding full-width punctuation still gets its mark.
///
/// The regression this pins: the parsed literal comes from the CJK-rewritten
/// text, so a span holding `「a」` carries `一a一`. Searching the original for
/// that value found nothing and the mark was dropped, which made the span stop
/// being treated as code — measured before the fix as zero code marks for
/// `` `「a」` `` while `` `a` `` produced one.
#[test]
fn a_code_span_with_cjk_punctuation_keeps_its_mark() {
    for source in ["值 `「a」` 结束", "值 `、` 结束", "值 `**「x」**` 结束"] {
        let marks = MarkdownDocument::new(source).inline_marks().unwrap();
        let code = marks
            .iter()
            .find(|mark| mark.kind == InlineMarkKind::Code)
            .unwrap_or_else(|| panic!("no code mark for {source:?}"));

        // The mark must address the original bytes, punctuation intact.
        let content = &source[code.range.clone()];
        assert!(
            content.contains('「') || content.contains('、'),
            "the mark keeps the source punctuation for {source:?}, got {content:?}"
        );
        assert!(
            source[code.syntax_range.clone()].starts_with('`'),
            "the syntax range still covers the backticks for {source:?}"
        );
    }
}

#[test]
fn markdown_commands_preserve_surrounding_source_and_check_utf8_ranges() {
    let document = MarkdownDocument::new("# 原题\n\n中文 body  \n");
    assert!(document.wrap_selection(3..4, "**", "**").is_err());

    let heading = document.set_heading(0..0, 2).unwrap();
    let document = document.apply(&heading).unwrap();
    assert_eq!(document.source(), "## 原题\n\n中文 body  \n");

    let paragraph_start = document.source().find("中文").unwrap();
    let list = document
        .toggle_line_prefix(paragraph_start..paragraph_start, "- ")
        .unwrap();
    let document = document.apply(&list).unwrap();
    assert_eq!(document.source(), "## 原题\n\n- 中文 body  \n");
}

#[test]
fn inline_format_toggle_round_trips_a_utf8_selection_and_empty_caret() {
    let document = MarkdownDocument::new("开头 中文 📝");
    let start = document.source().find("中文").unwrap();
    for format in [
        InlineFormat::Bold,
        InlineFormat::Italic,
        InlineFormat::Code,
        InlineFormat::Strikethrough,
    ] {
        for selection in [start..start, start..start + "中文".len()] {
            let edit = document
                .toggle_inline_mark(selection.clone(), format)
                .unwrap();
            let wrapped = document.apply(&edit).unwrap();
            assert_ne!(wrapped, document);
            let undo = wrapped
                .toggle_inline_mark(edit.selection_after, format)
                .unwrap();
            assert_eq!(undo.selection_after, selection);
            assert_eq!(wrapped.apply(&undo).unwrap(), document);
        }
    }
}

#[test]
fn inline_format_toggle_preserves_nested_inner_marks() {
    let document = MarkdownDocument::new("**bold _emphasis_**");
    for range in [0..document.source().len(), 2..17] {
        let edit = document
            .toggle_inline_mark(range, InlineFormat::Bold)
            .unwrap();
        assert_eq!(document.apply(&edit).unwrap().source(), "bold _emphasis_");
    }
}

#[test]
fn find_matches_respects_options() {
    use inkpoint_editor_core::{FindOptions, find_matches};
    let text = "Hello world! hello, HELLO WORLD.";

    // Case insensitive
    let matches = find_matches(text, "hello", &FindOptions::default());
    assert_eq!(matches.len(), 3);

    // Case sensitive
    let matches = find_matches(
        text,
        "hello",
        &FindOptions {
            case_sensitive: true,
            whole_word: false,
            regex: false,
        },
    );
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0], 13..18);

    // Whole word
    let text2 = "cat category concatenate cat";
    let matches = find_matches(
        text2,
        "cat",
        &FindOptions {
            case_sensitive: false,
            whole_word: true,
            regex: false,
        },
    );
    assert_eq!(matches.len(), 2);
    assert_eq!(matches[0], 0..3);
    assert_eq!(matches[1], 25..28);

    // Regex
    let matches = find_matches(
        text,
        r"h\w+o",
        &FindOptions {
            case_sensitive: false,
            whole_word: false,
            regex: true,
        },
    );
    assert_eq!(matches.len(), 3);
}

#[test]
fn replace_single_and_all_matches() {
    use inkpoint_editor_core::{
        FindOptions, MarkdownDocument, find_matches, replace_all_matches, replace_single_match,
    };
    let doc = MarkdownDocument::new("foo bar foo baz foo");
    let matches = find_matches(doc.source(), "foo", &FindOptions::default());
    assert_eq!(matches.len(), 3);

    // Single replace
    let edit = replace_single_match(doc.source(), matches[1].clone(), "qux").unwrap();
    let updated = doc.apply(&edit).unwrap();
    assert_eq!(updated.source(), "foo bar qux baz foo");

    // Replace all
    let edit_all = replace_all_matches(doc.source(), &matches, "qux").unwrap();
    let updated_all = doc.apply(&edit_all).unwrap();
    assert_eq!(updated_all.source(), "qux bar qux baz qux");
}

#[test]
fn document_metrics_calculation() {
    use inkpoint_editor_core::calculate_document_metrics;
    let markdown =
        "# Title\n\nThis is a test of English words.\n\n这是中文测试：包含标点与 English 混合。";
    let metrics = calculate_document_metrics(markdown);
    assert_eq!(metrics.lines, 5);
    assert!(metrics.characters > 30);
    assert!(metrics.words > 10);
}

/// One parse must produce exactly what two separate parses produced.
///
/// `blocks_and_inline_marks` exists only to avoid building the same AST twice,
/// so the whole point is that nothing about the products may change. Comparing
/// against the single-product methods is the assertion that keeps this a pure
/// optimization: if either walk ever diverges, this fails instead of silently
/// rendering a document that differs from what the parse reported.
#[test]
fn shared_parse_matches_the_individual_products() {
    let sources = [
        "# 标题\n\n段落 **加粗** 与 [链接](https://example.test)\n",
        "| 左 | 右 |\n| --- | --- |\n| 甲 | 乙 |\n",
        "> 引用\n> 续行\n\n- 一\n- 二\n\n```rust\nfn main() {}\n```\n",
        "中文 **加粗 _强调_** 与 `「全角」` 结束\n",
        "纯文本，没有任何语法。\n",
        "",
    ];
    for source in sources {
        let document = MarkdownDocument::new(source);
        let (blocks, marks) = document.blocks_and_inline_marks().unwrap();
        assert_eq!(
            blocks,
            document.blocks().unwrap(),
            "blocks differ for {source:?}"
        );
        assert_eq!(
            marks,
            document.inline_marks().unwrap(),
            "marks differ for {source:?}"
        );
    }
}
