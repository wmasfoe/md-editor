//! # Markdown Document File Operations
//!
//! 提供 Markdown 文件的对话框打开、路径打开、代际依序保存（Ordered Save）与原子落盘（Atomic Save）。

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::save_runtime::{
    reject_non_main_attach, reject_non_main_save, AttachSaveRuntimeResult, NativeSaveDestination,
    NativeSaveOrderingToken, NativeSaveResult, SaveCommitGate, SaveCommitResult,
    SavePathResolution, SaveWarning,
};

use super::{
    path_utils::{ensure_markdown_extension, path_to_string},
    tree::allow_asset_directory,
    types::MarkdownDocumentFile,
};

/// 弹出系统原生文件打开对话框，选择并读取 Markdown 文件。
#[tauri::command]
pub(crate) async fn open_markdown_document(
    app: tauri::AppHandle,
) -> Result<Option<MarkdownDocumentFile>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Open Markdown")
        .add_filter("Markdown", &["md", "mdx", "markdown"])
        .blocking_pick_file();

    let Some(file_path) = selected else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|error| format!("Selected file path is not readable: {error}"))?;
    let markdown = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let _ = allow_asset_directory_for_file(&app, &path);

    Ok(Some(MarkdownDocumentFile {
        file_path: path_to_string(&path),
        markdown,
    }))
}

/// 打开指定绝对路径的 Markdown 文档并返回其全文内容。
#[tauri::command]
pub(crate) async fn open_markdown_document_at_path(
    app: tauri::AppHandle,
    path: String,
) -> Result<MarkdownDocumentFile, String> {
    let path = PathBuf::from(path);
    let markdown = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let _ = allow_asset_directory_for_file(&app, &path);

    Ok(MarkdownDocumentFile {
        file_path: path_to_string(&path),
        markdown,
    })
}

/// 附加当前文档运行时到保存闸门（SaveCommitGate），分配单调递增的新 Epoch 与 Token ID。
#[tauri::command]
pub(crate) async fn attach_save_runtime(
    window: WebviewWindow,
    gate: State<'_, SaveCommitGate>,
) -> Result<AttachSaveRuntimeResult, String> {
    if let Some(rejection) = reject_non_main_attach(window.label()) {
        return Ok(rejection);
    }

    let gate = gate.inner().clone();
    match tauri::async_runtime::spawn_blocking(move || gate.attach_blocking()).await {
        Ok(result) => Ok(result),
        Err(error) => Ok(AttachSaveRuntimeResult::Indeterminate {
            error_code: format!("save-runtime-attach-join-failed:{error}"),
        }),
    }
}

/// 严格按生成代际与时钟序列号保存 Markdown 文档（防止乱序覆盖与竞态丢失）。
#[tauri::command]
pub(crate) async fn save_markdown_document_ordered(
    window: WebviewWindow,
    app: tauri::AppHandle,
    gate: State<'_, SaveCommitGate>,
    ordering_token: NativeSaveOrderingToken,
    markdown_lf: String,
    destination: NativeSaveDestination,
) -> Result<NativeSaveResult, String> {
    if let Some(rejection) = reject_non_main_save(window.label(), ordering_token.runtime_sequence) {
        return Ok(rejection);
    }

    let gate = gate.inner().clone();
    let resolver_app = app.clone();
    let runtime_sequence = ordering_token.runtime_sequence;
    match tauri::async_runtime::spawn_blocking(move || {
        gate.run_save_job(
            ordering_token,
            &markdown_lf,
            move || resolve_native_save_destination(&resolver_app, destination),
            move |path, bytes| commit_markdown_save(&app, path, bytes),
        )
    })
    .await
    {
        Ok(result) => Ok(result),
        Err(error) => Ok(NativeSaveResult::indeterminate(
            runtime_sequence,
            format!("save-runtime-helper-join-failed:{error}"),
        )),
    }
}

pub(crate) fn resolve_native_save_destination(
    app: &tauri::AppHandle,
    destination: NativeSaveDestination,
) -> SavePathResolution {
    match destination {
        NativeSaveDestination::CurrentPath { path } => {
            if path.trim().is_empty() {
                return SavePathResolution::Failed {
                    phase: "validation",
                    error_code: "empty-current-path".to_string(),
                };
            }
            SavePathResolution::Selected(ensure_markdown_extension(PathBuf::from(path)))
        }
        NativeSaveDestination::Prompt { suggested_path } => {
            match choose_save_path(app, suggested_path.as_deref()) {
                Ok(Some(path)) => SavePathResolution::Selected(ensure_markdown_extension(path)),
                Ok(None) => SavePathResolution::Cancelled,
                Err(error) => SavePathResolution::Failed {
                    phase: "dialog",
                    error_code: error,
                },
            }
        }
    }
}

pub(crate) fn commit_markdown_save(
    app: &tauri::AppHandle,
    path: &Path,
    bytes: &[u8],
) -> SaveCommitResult {
    commit_markdown_save_with(
        path,
        bytes,
        |file| file.sync_all(),
        |temporary_path, target_path| fs::rename(temporary_path, target_path),
        |committed_path| allow_asset_directory_for_file(app, committed_path),
    )
}

pub(crate) fn commit_markdown_save_with<Sync, Rename, Allow>(
    path: &Path,
    bytes: &[u8],
    sync: Sync,
    rename: Rename,
    allow: Allow,
) -> SaveCommitResult
where
    Sync: FnOnce(&fs::File) -> std::io::Result<()>,
    Rename: FnOnce(&Path, &Path) -> std::io::Result<()>,
    Allow: FnOnce(&Path) -> Result<(), String>,
{
    let Some(parent) = path.parent() else {
        return SaveCommitResult::Failed {
            phase: "validation",
            error_code: "missing-parent-directory".to_string(),
        };
    };
    if let Err(error) = fs::create_dir_all(parent) {
        return SaveCommitResult::Failed {
            phase: "temp-write",
            error_code: format!("create-parent-failed:{error}"),
        };
    }
    let temporary_path = match temporary_save_path(path) {
        Ok(path) => path,
        Err(error) => {
            return SaveCommitResult::Failed {
                phase: "temp-write",
                error_code: error,
            };
        }
    };

    let write_result = (|| {
        let mut temporary_file =
            fs::File::create(&temporary_path).map_err(|error| SaveCommitResult::Failed {
                phase: "temp-write",
                error_code: format!("temp-create-failed:{error}"),
            })?;
        temporary_file
            .write_all(bytes)
            .map_err(|error| SaveCommitResult::Failed {
                phase: "temp-write",
                error_code: format!("temp-write-failed:{error}"),
            })?;
        sync(&temporary_file).map_err(|error| SaveCommitResult::Failed {
            phase: "temp-sync",
            error_code: format!("temp-sync-failed:{error}"),
        })?;
        drop(temporary_file);
        rename(&temporary_path, path).map_err(|error| SaveCommitResult::Failed {
            phase: "rename",
            error_code: format!("atomic-rename-failed:{error}"),
        })?;
        Ok::<(), SaveCommitResult>(())
    })();

    if let Err(result) = write_result {
        let _ = fs::remove_file(&temporary_path);
        return result;
    }

    let warnings = match allow(path) {
        Ok(()) => Vec::new(),
        Err(message) => vec![SaveWarning {
            code: "asset-directory-registration-failed",
            message,
        }],
    };
    SaveCommitResult::Committed {
        file_path: path_to_string(path),
        warnings,
    }
}

pub(crate) fn choose_save_path(
    app: &tauri::AppHandle,
    current_path: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save Markdown")
        .add_filter("Markdown", &["md", "mdx", "markdown"])
        .set_can_create_directories(true);

    if let Some(path) = current_path.map(Path::new) {
        if let Some(parent) = path.parent() {
            dialog = dialog.set_directory(parent);
        }
        if let Some(file_name) = path.file_name() {
            dialog = dialog.set_file_name(file_name.to_string_lossy());
        }
    } else {
        dialog = dialog.set_file_name("Untitled.md");
    }

    dialog
        .blocking_save_file()
        .map(|path| {
            path.into_path()
                .map_err(|error| format!("Selected save path is not writable: {error}"))
        })
        .transpose()
}

pub(crate) fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Cannot resolve parent directory for {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;

    let temporary_path = temporary_save_path(path)?;

    // 先写同级临时文件，再 rename 覆盖目标；写入失败时保留原 Markdown 文件。
    if let Err(error) = fs::write(&temporary_path, bytes) {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!("Failed to write {}: {error}", path.display()));
    }

    if let Err(error) = fs::rename(&temporary_path, path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!("Failed to replace {}: {error}", path.display()));
    }

    Ok(())
}

pub(crate) fn temporary_save_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Cannot resolve parent directory for {}", path.display()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Cannot resolve file name for {}", path.display()))?
        .to_string_lossy();
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Failed to create temporary save path: {error}"))?
        .as_nanos();

    Ok(parent.join(format!(".{file_name}.tmp-{}-{suffix}", std::process::id())))
}

pub(crate) fn allow_asset_directory_for_file(
    app: &tauri::AppHandle,
    path: &Path,
) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };

    allow_asset_directory(app, parent)
}
