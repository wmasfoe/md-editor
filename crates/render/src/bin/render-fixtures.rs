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
    /// `renderStaticHtml({includeMarkers: true})` 对应的片段输出（编辑器所见）。
    results: std::collections::BTreeMap<String, String>,
    /// `renderStaticHtml({includeMarkers: false})` 对应的片段输出。
    ///
    /// 这是**桌面导出的实际模式**（`export-controller` 三个入口都传 false）。
    /// 历史上这个模式没被差分测试覆盖，导致 `<strong>` 等语义标签被静默丢掉。
    clean_results: std::collections::BTreeMap<String, String>,
    /// `renderStaticDocument` 对应的完整文档输出。
    documents: std::collections::BTreeMap<String, String>,
    /// 宿主管线：片段（clean 模式）经 `wrap_document_fragment` 包装后的文档。
    ///
    /// 对应桌面 `render_markdown_fragment(false)` → 后处理 →
    /// `render_markdown_document_from_fragment(fragment, css, title)` 的真实路径。
    host_documents: std::collections::BTreeMap<String, String>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;

    let request: Request = serde_json::from_str(&input)?;
    let options = md_render::RenderOptions::default();

    let clean_options = md_render::RenderOptions {
        include_markers: Some(false),
    };

    let mut results = std::collections::BTreeMap::new();
    let mut clean_results = std::collections::BTreeMap::new();
    let mut documents = std::collections::BTreeMap::new();
    let mut host_documents = std::collections::BTreeMap::new();

    for fixture in request.fixtures {
        results.insert(
            fixture.id.clone(),
            md_render::render_html(&fixture.markdown, &options),
        );

        let clean = md_render::render_html(&fixture.markdown, &clean_options);
        clean_results.insert(fixture.id.clone(), clean.clone());

        documents.insert(
            fixture.id.clone(),
            md_render::render_document(&fixture.markdown, &md_render::DocumentOptions::default()),
        );

        // 宿主管线：clean 片段 + 从正文提取的标题 → 包装。
        let title = md_render::extract_document_title(&fixture.markdown)
            .unwrap_or_else(|| "Untitled".to_string());
        host_documents.insert(
            fixture.id,
            md_render::wrap_document_fragment(&clean, "", &title),
        );
    }

    let response = Response {
        results,
        clean_results,
        documents,
        host_documents,
    };
    let stdout = std::io::stdout();
    let mut handle = stdout.lock();
    serde_json::to_writer(&mut handle, &response)?;
    handle.flush()?;
    Ok(())
}
