//! `render-fixtures` —— 差分测试专用的批量渲染入口。
//!
//! 约定（见 `scripts/render-diff/README.md`）：
//! - stdin：`{ "fixtures": [{ "id": "…", "markdown": "…" }] }`
//! - stdout：`{ "results": { "<id>": "<html>" } }`
//!
//! 一次进程调用渲染全部语料，避免逐条启动 cargo 的开销。

use std::io::{Read, Write};

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct Fixture {
    id: String,
    markdown: String,
}

#[derive(Debug, Deserialize)]
struct Request {
    fixtures: Vec<Fixture>,
}

#[derive(Debug, Serialize)]
struct Response {
    /// `renderStaticHtml` 对应的片段输出。
    results: std::collections::BTreeMap<String, String>,
    /// `renderStaticDocument` 对应的完整文档输出。
    documents: std::collections::BTreeMap<String, String>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;

    let request: Request = serde_json::from_str(&input)?;
    let options = md_render::RenderOptions::default();

    let mut results = std::collections::BTreeMap::new();
    let mut documents = std::collections::BTreeMap::new();
    for fixture in request.fixtures {
        results.insert(
            fixture.id.clone(),
            md_render::render_html(&fixture.markdown, &options),
        );
        documents.insert(
            fixture.id,
            md_render::render_document(&fixture.markdown, &md_render::DocumentOptions::default()),
        );
    }

    let response = Response { results, documents };
    let stdout = std::io::stdout();
    let mut handle = stdout.lock();
    serde_json::to_writer(&mut handle, &response)?;
    handle.flush()?;
    Ok(())
}
