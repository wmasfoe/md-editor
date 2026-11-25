use gpui_kit::base::text::editor_host::BlockNode;
use inkpoint_editor_typeset::TypesetDocument;

#[test]
fn code_hit_addresses_the_body_even_when_it_starts_with_the_language() {
    let source = "~~~rust\r\nrust &amp; 中\r\nsecond\r\n~~~";
    let document = TypesetDocument::parse(source).unwrap();
    let leaf = document.leaf_key(0).unwrap();
    let BlockNode::CodeBlock(code) = &document.blocks()[0] else {
        panic!("expected a code block");
    };
    let display = code.code();
    let first = source.find("\r\n").unwrap() + 2;
    let second = source.find("second").unwrap();
    assert_eq!(document.source_offset(leaf, 0), Some(first));
    assert_eq!(
        document.source_offset(leaf, display.find("second").unwrap()),
        Some(second)
    );
    assert_eq!(
        document.source_offset(leaf, display.len()),
        Some(second + "second".len())
    );
}

#[test]
fn character_references_preserve_their_source_range() {
    let source = "C & friends; &amp; next &acE;x &#x4E2D;中";
    let document = TypesetDocument::parse(source).unwrap();
    let leaf = document.leaf_key(0).unwrap();
    assert_eq!(document.source_offset(leaf, "C & ".len()), Some(4));
    let after_amp = "C & friends; &".len();
    assert_eq!(
        document.source_offset_before(leaf, after_amp),
        source.find("&amp;").map(|start| start + "&amp;".len())
    );
    let before_x = "C & friends; & next ∾̳".len();
    assert_eq!(
        document.source_offset(leaf, before_x),
        source.find(";x").map(|start| start + 1)
    );
    assert_eq!(
        document.source_offset(leaf, "C & friends; & next ∾̳x 中".len()),
        source.rfind('中')
    );
}

#[test]
fn raw_projection_keeps_fences_and_utf8_offsets() {
    let source = "\x60\x60\x60text\r\n中<strong>\r\n";
    let document = TypesetDocument::plain_source(source);
    assert_eq!(document.source(), source);
    let second = document.leaf_key(1).unwrap();
    assert_eq!(document.source_offset(second, "中".len()), source.find('<'));
    assert_eq!(document.leaf_at(source.len()), document.leaf_key(2));
}

#[test]
fn soft_break_keeps_following_text_mapped_to_its_own_line() {
    let source = "first\r\n第二行";
    let document = TypesetDocument::parse(source).unwrap();
    let leaf = document.leaf_key(0).unwrap();
    let BlockNode::Paragraph(paragraph) = &document.blocks()[0] else {
        panic!("expected a paragraph");
    };
    let display: String = paragraph
        .children()
        .iter()
        .map(|child| child.text())
        .collect();
    assert_eq!(
        document.source_offset(leaf, display.find('第').unwrap()),
        source.find('第')
    );
}
