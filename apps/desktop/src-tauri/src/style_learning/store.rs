//! 风格学习本地数据：应用数据目录下的两份版本化 JSON 文档。
//!
//! 文档结构由 `@md-editor/ai` 定义，这里只校验版本并负责原子落盘：
//! - `profile`：画像、样本统计与采纳 AI 段 hash（“清除风格学习数据”删除它）；
//! - `exclusions`：用户排除列表（清除学习数据时保留，可单独清空）。

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::Deserialize;
use serde_json::Value;

use crate::settings::app_data_dir;

/// 当前支持的文档版本。版本不符时视为空文档，由 TS 侧重新学习。
pub(crate) const STYLE_LEARNING_DOCUMENT_VERSION: u64 = 1;
/// 单份文档大小上限，防止异常数据无限增长。
pub(crate) const MAX_DOCUMENT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum StyleLearningDocumentKind {
    Profile,
    Exclusions,
}

impl StyleLearningDocumentKind {
    fn file_name(self) -> &'static str {
        match self {
            Self::Profile => "profile.json",
            Self::Exclusions => "exclusions.json",
        }
    }
}

#[tauri::command]
pub(crate) fn load_style_learning_document(
    kind: StyleLearningDocumentKind,
) -> Result<Option<Value>, String> {
    Ok(load_document(&storage_dir()?, kind))
}

/// 保存文档。`expected_revision` 为调用方读取时看到的 `revision`（文件不存在时为 0），
/// 与磁盘上当前的 `revision` 不一致时拒绝写入并返回 [`STALE_DOCUMENT_ERROR`]，
/// 调用方应重新读取、合并自己的修改后再保存。写入成功后返回新的 revision。
#[tauri::command]
pub(crate) fn save_style_learning_document(
    kind: StyleLearningDocumentKind,
    document: Value,
    expected_revision: u64,
) -> Result<u64, String> {
    let _guard = WRITE_LOCK
        .lock()
        .map_err(|_| "风格学习数据写锁已损坏。".to_string())?;
    save_document_if_current(&storage_dir()?, kind, document, expected_revision)
}

#[tauri::command]
pub(crate) fn clear_style_learning_document(kind: StyleLearningDocumentKind) -> Result<(), String> {
    let _guard = WRITE_LOCK
        .lock()
        .map_err(|_| "风格学习数据写锁已损坏。".to_string())?;
    clear_document(&storage_dir()?, kind)
}

/// 所有窗口的写入经同一把锁串行化，保证“比较 revision → 写入”是原子的。
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 读取到的文档已过期（其他窗口或学习轮次先写入了新版本）。
pub(crate) const STALE_DOCUMENT_ERROR: &str = "style-learning-stale";

/// 文档当前的 revision；文件缺失、损坏或版本不符时为 0。
pub(crate) fn current_revision(dir: &Path, kind: StyleLearningDocumentKind) -> u64 {
    load_document(dir, kind)
        .and_then(|document| document.get("revision").and_then(Value::as_u64))
        .unwrap_or(0)
}

/// 比较并写入：revision 一致时写入 `expected + 1`，否则返回 [`STALE_DOCUMENT_ERROR`]。
pub(crate) fn save_document_if_current(
    dir: &Path,
    kind: StyleLearningDocumentKind,
    mut document: Value,
    expected_revision: u64,
) -> Result<u64, String> {
    if current_revision(dir, kind) != expected_revision {
        return Err(STALE_DOCUMENT_ERROR.to_string());
    }
    let next = expected_revision + 1;
    let object = document
        .as_object_mut()
        .ok_or_else(|| "风格学习数据必须是对象。".to_string())?;
    object.insert("revision".to_string(), Value::from(next));
    save_document(dir, kind, &document)?;
    Ok(next)
}

fn storage_dir() -> Result<PathBuf, String> {
    app_data_dir()
        .map(|directory| directory.join("style-learning"))
        .ok_or_else(|| "Cannot resolve app data directory".to_string())
}

/// 读取文档；文件缺失、损坏或版本不符时返回 `None`，调用方按空文档处理。
pub(crate) fn load_document(dir: &Path, kind: StyleLearningDocumentKind) -> Option<Value> {
    let bytes = fs::read(dir.join(kind.file_name())).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    has_supported_version(&value).then_some(value)
}

/// 原子写入：先写完整的临时文件再 rename，中断时旧文件保持完整。
pub(crate) fn save_document(
    dir: &Path,
    kind: StyleLearningDocumentKind,
    document: &Value,
) -> Result<(), String> {
    if !has_supported_version(document) {
        return Err(format!(
            "风格学习数据必须是 version 为 {STYLE_LEARNING_DOCUMENT_VERSION} 的对象。"
        ));
    }
    let bytes = serde_json::to_vec(document).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err("风格学习数据超过大小上限。".to_string());
    }
    fs::create_dir_all(dir).map_err(|error| format!("无法创建风格学习数据目录：{error}"))?;
    let target = dir.join(kind.file_name());
    let temporary = target.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|error| format!("写入风格学习数据失败：{error}"))?;
    fs::rename(&temporary, &target).map_err(|error| format!("写入风格学习数据失败：{error}"))
}

/// 删除文档及可能残留的临时文件；文件本就不存在时视为成功。
pub(crate) fn clear_document(dir: &Path, kind: StyleLearningDocumentKind) -> Result<(), String> {
    let target = dir.join(kind.file_name());
    for path in [target.with_extension("json.tmp"), target] {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("清除风格学习数据失败：{error}")),
        }
    }
    Ok(())
}

fn has_supported_version(value: &Value) -> bool {
    value.get("version").and_then(Value::as_u64) == Some(STYLE_LEARNING_DOCUMENT_VERSION)
}
