//! 枚举工作区内可作为风格样本的 Markdown 文件。

use std::{fs, path::Path, time::UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;
use walkdir::{DirEntry, WalkDir};

use super::scope::{resolve_in_scope, validate_relative_path, StyleLearningScope};
use crate::{
    file_commands::path_utils::{file_tree_relative_path, is_markdown_path, path_to_string},
    folder_watcher::is_ignored_path,
};

/// 超过该大小的文件不作为样本（多为导出产物或数据文件）。
pub(crate) const MAX_SAMPLE_BYTES: u64 = 1024 * 1024;
/// 单次扫描最多返回的样本数，防止超大目录拖慢后台任务。
pub(crate) const MAX_SCANNED_SAMPLES: usize = 5000;

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StyleSampleEntry {
    /// 以 `/` 分隔的工作区相对路径
    pub(crate) rel_path: String,
    pub(crate) sha256: String,
    pub(crate) bytes: u64,
    pub(crate) modified_ms: u64,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StyleSampleScan {
    pub(crate) root_path: String,
    pub(crate) samples: Vec<StyleSampleEntry>,
    /// 是否因达到上限而截断
    pub(crate) truncated: bool,
}

/// 扫描当前工作区。`excluded` 为用户排除的工作区相对路径（文件或目录，按路径前缀匹配）。
#[tauri::command]
pub(crate) async fn scan_style_learning_samples(
    scope: State<'_, StyleLearningScope>,
    expected_root: String,
    excluded: Vec<String>,
) -> Result<StyleSampleScan, String> {
    let root = scope.expect_root(&expected_root)?;
    tauri::async_runtime::spawn_blocking(move || scan_samples(&root, &excluded))
        .await
        .map_err(|error| format!("风格样本扫描任务失败：{error}"))?
}

/// 读取一个样本的文本。只允许读取当前工作区内、未被默认规则排除的 Markdown 文件。
#[tauri::command]
pub(crate) async fn read_style_learning_sample(
    scope: State<'_, StyleLearningScope>,
    expected_root: String,
    rel_path: String,
) -> Result<String, String> {
    let root = scope.expect_root(&expected_root)?;
    tauri::async_runtime::spawn_blocking(move || read_sample(&root, &rel_path))
        .await
        .map_err(|error| format!("风格样本读取任务失败：{error}"))?
}

pub(crate) fn scan_samples(root: &Path, excluded: &[String]) -> Result<StyleSampleScan, String> {
    let excluded = normalize_exclusions(excluded);
    let mut samples = Vec::new();
    let mut truncated = false;

    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || !is_default_excluded_entry(entry));

    for entry in walker {
        // 无权限读取的子目录直接跳过，不中断整个扫描。
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() || !is_markdown_path(entry.path()) {
            continue;
        }
        let Ok(rel_path) = file_tree_relative_path(root, entry.path()) else {
            continue;
        };
        if is_user_excluded(&rel_path, &excluded) || is_template_file(&rel_path) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.len() > MAX_SAMPLE_BYTES {
            continue;
        }
        let Ok(content) = fs::read(entry.path()) else {
            continue;
        };
        if samples.len() >= MAX_SCANNED_SAMPLES {
            truncated = true;
            break;
        }
        samples.push(StyleSampleEntry {
            rel_path,
            sha256: sha256_hex(&content),
            bytes: metadata.len(),
            modified_ms: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |duration| duration.as_millis() as u64),
        });
    }

    samples.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(StyleSampleScan {
        root_path: path_to_string(root),
        samples,
        truncated,
    })
}

pub(crate) fn read_sample(root: &Path, rel_path: &str) -> Result<String, String> {
    let path = resolve_in_scope(root, rel_path)?;
    if !is_markdown_path(&path)
        || is_ignored_path(Path::new(rel_path))
        || is_template_file(rel_path)
    {
        return Err(format!("该文件不能作为风格样本：{rel_path}"));
    }
    if rel_path.split('/').any(|segment| segment.starts_with('.')) {
        return Err(format!("该文件不能作为风格样本：{rel_path}"));
    }
    let metadata = fs::metadata(&path).map_err(|error| format!("读取样本失败：{error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_SAMPLE_BYTES {
        return Err(format!("该文件不能作为风格样本：{rel_path}"));
    }
    fs::read_to_string(&path).map_err(|error| format!("读取样本失败：{error}"))
}

pub(crate) fn sha256_hex(content: &[u8]) -> String {
    let digest = Sha256::digest(content);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 隐藏目录与文件、构建产物与依赖目录、模板目录默认不参与学习。
fn is_default_excluded_entry(entry: &DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    if name.starts_with('.') || is_ignored_path(Path::new(name.as_ref())) {
        return true;
    }
    entry.file_type().is_dir() && is_template_segment(&name)
}

fn is_template_segment(segment: &str) -> bool {
    let lower = segment.to_ascii_lowercase();
    lower == "template" || lower == "templates"
}

/// `*.template.md` 等模板文件，或位于模板目录内的文件。
fn is_template_file(rel_path: &str) -> bool {
    let mut segments = rel_path.split('/').peekable();
    while let Some(segment) = segments.next() {
        if segments.peek().is_some() {
            if is_template_segment(segment) {
                return true;
            }
        } else {
            let lower = segment.to_ascii_lowercase();
            return lower.contains(".template.");
        }
    }
    false
}

/// 只保留合法的相对路径，去掉末尾的 `/`。非法条目直接忽略，不影响其他排除项。
fn normalize_exclusions(excluded: &[String]) -> Vec<String> {
    excluded
        .iter()
        .map(|entry| entry.trim().trim_end_matches('/').to_string())
        .filter(|entry| validate_relative_path(entry).is_ok())
        .collect()
}

/// 路径前缀匹配：排除 `notes` 会同时排除 `notes` 文件与 `notes/` 下的全部内容。
pub(crate) fn is_user_excluded(rel_path: &str, excluded: &[String]) -> bool {
    excluded.iter().any(|entry| {
        rel_path == entry
            || rel_path
                .strip_prefix(entry.as_str())
                .is_some_and(|rest| rest.starts_with('/'))
    })
}
