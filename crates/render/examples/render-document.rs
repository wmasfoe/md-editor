//! 单次文档包装入口（对应宿主管线）。
//!
//! stdin：`{ "fragment": "…", "customCss": "…", "title": "…" }`
//! stdout：包装后的完整文档（纯文本）

use std::io::Read;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let value: serde_json::Value = serde_json::from_str(&input)?;
    let fragment = value["fragment"].as_str().unwrap_or_default();
    let custom_css = value["customCss"].as_str().unwrap_or_default();
    let title = value["title"].as_str().unwrap_or("Untitled");
    print!(
        "{}",
        md_render::wrap_document_fragment(fragment, custom_css, title)
    );
    Ok(())
}
