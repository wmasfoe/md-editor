//! 单次片段渲染入口（供 desktop 集成测试调用真实 Rust 渲染）。
use std::io::Read;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let value: serde_json::Value = serde_json::from_str(&input)?;
    let markdown = value["markdown"].as_str().unwrap_or_default();
    let include_markers = value["includeMarkers"].as_bool();
    let options = md_render::RenderOptions { include_markers };
    print!("{}", md_render::render_html(markdown, &options));
    Ok(())
}
