//! # Local AI Model Storage & Status
//!
//! 负责本地已下载模型文件的检测、目录结构管理、SHA-256 完整性验证以及元数据持久化。

use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Emitter, State};

use super::manifest::{
    build_catalog_from_remote, fetch_remote_manifest, resolve_all_manifests, resolve_manifest,
    LocalAiFileSpec, LocalAiModelManifest, LITE_MODEL_ID, PRO_MODEL_ID, STANDARD_MODEL_ID,
};
use crate::{local_ai_runtime::LocalAiRuntimeState, settings};

pub(crate) const LOCAL_AI_MODEL_PROGRESS_EVENT: &str = "local-ai-model-progress";
pub(crate) const DOWNLOAD_TEMP_FILE_NAME: &str = "download.tmp";

/// 本地 AI 模型的当前运行时状态。
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAiModelStatus {
    pub(crate) model_id: String,
    pub(crate) display_name: String,
    pub(crate) description: String,
    pub(crate) tier: String,
    pub(crate) is_recommended: bool,
    pub(crate) version: Option<String>,
    pub(crate) latest_version: String,
    pub(crate) has_update: bool,
    pub(crate) is_available_tier: bool,
    pub(crate) status: String,
    pub(crate) downloaded_bytes: u64,
    pub(crate) total_bytes: u64,
    pub(crate) path: Option<String>,
    pub(crate) error: Option<String>,
}

impl LocalAiModelStatus {
    pub(crate) fn is_available(&self) -> bool {
        self.status == "available"
    }
}

/// 已安装且可直接启动/推理的本地 AI 模型文件与适配器路径。
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LocalAiModelFile {
    pub(crate) model_id: String,
    pub(crate) display_name: String,
    pub(crate) version: String,
    pub(crate) base_path: PathBuf,
    pub(crate) gec_adapter_path: Option<PathBuf>,
    pub(crate) completion_adapter_path: Option<PathBuf>,
    pub(crate) distill_adapter_path: Option<PathBuf>,
    pub(crate) context_size: u32,
    pub(crate) default_max_tokens: u16,
}

#[derive(Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistedLocalAiModelManifest {
    pub(crate) id: String,
    pub(crate) display_name: String,
    pub(crate) version: String,
    #[serde(default)]
    pub(crate) base_filename: Option<String>,
    #[serde(default)]
    pub(crate) base_sha256: Option<String>,
    #[serde(default)]
    pub(crate) gec_filename: Option<String>,
    #[serde(default)]
    pub(crate) gec_sha256: Option<String>,
    #[serde(default)]
    pub(crate) completion_filename: Option<String>,
    #[serde(default)]
    pub(crate) completion_sha256: Option<String>,
    #[serde(default)]
    pub(crate) distill_filename: Option<String>,
    #[serde(default)]
    pub(crate) distill_sha256: Option<String>,
    #[serde(default)]
    pub(crate) total_size_bytes: u64,
    #[serde(default)]
    pub(crate) filename: Option<String>,
    #[serde(default)]
    pub(crate) size_bytes: Option<u64>,
    #[serde(default)]
    pub(crate) sha256: Option<String>,
}

/// 查询单个本地模型的安装/下载/更新状态。
#[tauri::command]
pub(crate) fn get_local_ai_model_status(
    model_id: Option<String>,
) -> Result<LocalAiModelStatus, String> {
    let manifest = resolve_manifest(model_id.as_deref())?;
    Ok(read_model_status(&manifest))
}

/// 获取当前所有已知本地模型的安装状态集合。
#[tauri::command]
pub(crate) fn get_all_local_ai_models_status() -> Result<Vec<LocalAiModelStatus>, String> {
    Ok(resolve_all_manifests()
        .into_iter()
        .map(|manifest| read_model_status(&manifest))
        .collect())
}

/// 联网检查远端是否存在更新的模型版本，返回最新清单的状态列表。
#[tauri::command]
pub(crate) async fn check_local_ai_model_updates() -> Result<Vec<LocalAiModelStatus>, String> {
    let remote_res = tauri::async_runtime::spawn_blocking(fetch_remote_manifest).await;
    match remote_res {
        Ok(Ok(remote)) => {
            let manifests = build_catalog_from_remote(&remote);
            Ok(manifests.iter().map(read_model_status).collect())
        }
        _ => get_all_local_ai_models_status(),
    }
}

/// 删除已下载的本地模型文件及目录，释放磁盘空间。
#[tauri::command]
pub(crate) fn delete_local_ai_model(
    app: AppHandle,
    runtime: State<'_, LocalAiRuntimeState>,
    model_id: Option<String>,
) -> Result<LocalAiModelStatus, String> {
    let manifest = resolve_manifest(model_id.as_deref())?;

    // 如果当前正在运行该模型，先优雅停止进程
    if let Ok(mut manager) = runtime.manager().lock() {
        manager.stop_runtime_if_model(&manifest.id);
    }

    let directory = model_directory(&manifest)?;
    if directory.exists() {
        fs::remove_dir_all(&directory).map_err(|error| {
            format!(
                "Failed to delete local AI model {}: {error}",
                directory.display()
            )
        })?;
    }
    let status = read_model_status(&manifest);
    emit_status(&app, status.clone());
    Ok(status)
}

/// 获取就绪可用的本地模型文件结构体。
pub(crate) fn get_available_local_ai_model(
    model_id: Option<&str>,
) -> Result<LocalAiModelFile, String> {
    let manifest = resolve_manifest(model_id)?;
    if !manifest.is_available {
        return Err(format!("{} 尚未发布，敬请期待。", manifest.display_name));
    }
    let status = read_model_status(&manifest);
    if !status.is_available() {
        return Err(local_model_unavailable_message(&status));
    }

    let directory = model_directory(&manifest)?;
    let base_path = directory.join("base.gguf");
    if base_path.is_file() {
        let gec_path = directory.join("gec.gguf");
        let comp_path = directory.join("completion.gguf");
        let dist_path = directory.join("distill.gguf");

        return Ok(LocalAiModelFile {
            model_id: manifest.id.to_string(),
            display_name: manifest.display_name.to_string(),
            version: status.version.unwrap_or_else(|| manifest.version.clone()),
            base_path,
            gec_adapter_path: if gec_path.is_file() {
                Some(gec_path)
            } else {
                None
            },
            completion_adapter_path: if comp_path.is_file() {
                Some(comp_path)
            } else {
                None
            },
            distill_adapter_path: if dist_path.is_file() {
                Some(dist_path)
            } else {
                None
            },
            context_size: manifest.context_size,
            default_max_tokens: manifest.default_max_tokens,
        });
    }

    let legacy_path = directory.join("model.gguf");
    if legacy_path.is_file() {
        return Ok(LocalAiModelFile {
            model_id: manifest.id.to_string(),
            display_name: manifest.display_name.to_string(),
            version: status.version.unwrap_or_else(|| manifest.version.clone()),
            base_path: legacy_path,
            gec_adapter_path: None,
            completion_adapter_path: None,
            distill_adapter_path: None,
            context_size: manifest.context_size,
            default_max_tokens: manifest.default_max_tokens,
        });
    }

    Err("本地模型文件不存在，请先下载。".to_string())
}

/// 检查本地已存在的组件是否与目标规格匹配（SHA256 一致且尺寸相符），支持毫秒级无损复用。
pub(crate) fn can_reuse_local_component(
    local_path: &Path,
    spec: &LocalAiFileSpec,
    persisted_sha: Option<&str>,
) -> bool {
    if !local_path.is_file() {
        return false;
    }

    let Ok(metadata) = local_path.metadata() else {
        return false;
    };

    if metadata.len() != spec.size_bytes || spec.sha256.trim().is_empty() {
        return false;
    }

    // 1. 优先比对本地 manifest.json 记录的 SHA256（已在落盘时校验通过，0 开销快速命中）
    if let Some(sha) = persisted_sha {
        if !sha.is_empty() && sha.eq_ignore_ascii_case(&spec.sha256) {
            return true;
        }
    }

    // 2. 若 persisted 未记录或不匹配，现场计算本地文件 SHA256 兜底校验
    if let Ok(actual_sha) = compute_sha256_hex(local_path) {
        if actual_sha.eq_ignore_ascii_case(&spec.sha256) {
            return true;
        }
    }

    false
}

/// 将复用的本地组件置入 staging 目录（优先硬链接，回退复制）。
pub(crate) fn stage_reused_component(source: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        let _ = fs::remove_file(dest);
    }
    if fs::hard_link(source, dest).is_err() {
        fs::copy(source, dest).map_err(|e| {
            format!(
                "复用本地组件失败（{} -> {}）：{e}",
                source.display(),
                dest.display()
            )
        })?;
    }
    Ok(())
}

pub(crate) fn compute_sha256_hex(path: &Path) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        compute_sha256_hex_windows(path)
    }

    #[cfg(not(target_os = "windows"))]
    {
        compute_sha256_hex_unix(path)
    }
}

#[cfg(target_os = "windows")]
fn compute_sha256_hex_windows(path: &Path) -> Result<String, String> {
    let output = Command::new("certutil")
        .arg("-hashfile")
        .arg(path)
        .arg("SHA256")
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            extract_first_hex_hash(&text)
                .ok_or_else(|| "无法解析 Windows SHA256 输出。".to_string())
        }
        Ok(output) => Err(format!(
            "读取本地模型校验值失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        )),
        Err(error) => Err(format!("读取本地模型校验值失败：{error}")),
    }
}

#[cfg(not(target_os = "windows"))]
fn compute_sha256_hex_unix(path: &Path) -> Result<String, String> {
    for command in ["shasum", "sha256sum", "openssl"] {
        let output = match command {
            "shasum" => Command::new("shasum")
                .arg("-a")
                .arg("256")
                .arg(path)
                .output(),
            "sha256sum" => Command::new("sha256sum").arg(path).output(),
            "openssl" => Command::new("openssl")
                .arg("dgst")
                .arg("-sha256")
                .arg(path)
                .output(),
            _ => continue,
        };

        match output {
            Ok(output) if output.status.success() => {
                let text = String::from_utf8_lossy(&output.stdout);
                if let Some(hash) = extract_first_hex_hash(&text) {
                    return Ok(hash);
                }
            }
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("读取本地模型校验值失败：{error}")),
        }
    }

    Err("无法计算本地模型 SHA256 校验值。".to_string())
}

pub(crate) fn extract_first_hex_hash(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|token| token.len() == 64 && token.chars().all(|c| c.is_ascii_hexdigit()))
        .map(|token| token.to_ascii_lowercase())
}

pub(crate) fn read_model_status(manifest: &LocalAiModelManifest) -> LocalAiModelStatus {
    let total_bytes = manifest.total_download_bytes();
    if !manifest.is_available {
        return build_status(manifest, "not-downloaded", 0, total_bytes, None, None, None);
    }

    let Ok(directory) = model_directory(manifest) else {
        return build_status(
            manifest,
            "failed",
            0,
            total_bytes,
            None,
            None,
            Some("无法解析本地模型目录。".to_string()),
        );
    };

    let manifest_path = directory.join("manifest.json");
    let staging_dir = directory.join("staging.tmp");
    let legacy_temp = directory.join(DOWNLOAD_TEMP_FILE_NAME);

    // 1. 尝试从已持久化的 manifest.json 读取
    if manifest_path.is_file() {
        if let Ok(json) = fs::read_to_string(&manifest_path) {
            if let Ok(persisted) = serde_json::from_str::<PersistedLocalAiModelManifest>(&json) {
                if let Some(base_file) = &persisted.base_filename {
                    let base_path = directory.join(base_file);
                    if base_path.is_file() {
                        let mut downloaded = base_path.metadata().map(|m| m.len()).unwrap_or(0);
                        if let Some(gec) = &persisted.gec_filename {
                            let p = directory.join(gec);
                            if p.is_file() {
                                downloaded += p.metadata().map(|m| m.len()).unwrap_or(0);
                            }
                        }
                        if let Some(comp) = &persisted.completion_filename {
                            let p = directory.join(comp);
                            if p.is_file() {
                                downloaded += p.metadata().map(|m| m.len()).unwrap_or(0);
                            }
                        }
                        if let Some(dist) = &persisted.distill_filename {
                            let p = directory.join(dist);
                            if p.is_file() {
                                downloaded += p.metadata().map(|m| m.len()).unwrap_or(0);
                            }
                        }

                        return build_status(
                            manifest,
                            "available",
                            downloaded,
                            total_bytes.max(downloaded),
                            Some(base_path),
                            Some(persisted.version),
                            None,
                        );
                    }
                } else if let Some(filename) = &persisted.filename {
                    let single_path = directory.join(filename);
                    if single_path.is_file() {
                        let downloaded = single_path.metadata().map(|m| m.len()).unwrap_or(0);
                        return build_status(
                            manifest,
                            "available",
                            downloaded,
                            total_bytes.max(downloaded),
                            Some(single_path),
                            Some(persisted.version),
                            None,
                        );
                    }
                }
            }
        }
    }

    // 2. 检查本地是否有已就绪的文件（base.gguf 或 model.gguf）
    let base_path = directory.join("base.gguf");
    if base_path.is_file() {
        let mut downloaded = base_path.metadata().map(|m| m.len()).unwrap_or(0);
        for tag in &["gec.gguf", "completion.gguf", "distill.gguf"] {
            let p = directory.join(tag);
            if p.is_file() {
                downloaded += p.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
        return build_status(
            manifest,
            "available",
            downloaded,
            total_bytes.max(downloaded),
            Some(base_path),
            Some(manifest.version.clone()),
            None,
        );
    }

    let legacy_model_path = directory.join("model.gguf");
    if legacy_model_path.is_file() {
        let downloaded = legacy_model_path.metadata().map(|m| m.len()).unwrap_or(0);
        return build_status(
            manifest,
            "available",
            downloaded,
            total_bytes.max(downloaded),
            Some(legacy_model_path),
            Some("v1.0.0".to_string()),
            None,
        );
    }

    // 3. 检查是否有未完成的临时文件
    if staging_dir.is_dir() || legacy_temp.is_file() {
        return build_status(
            manifest,
            "failed",
            0,
            total_bytes,
            None,
            None,
            Some("上次下载未完成，请重试。".to_string()),
        );
    }

    build_status(manifest, "not-downloaded", 0, total_bytes, None, None, None)
}

pub(crate) fn write_model_metadata(manifest: &LocalAiModelManifest) -> Result<(), String> {
    let directory = model_directory(manifest)?;
    let metadata = if !manifest.adapters.is_empty() {
        PersistedLocalAiModelManifest {
            id: manifest.id.to_string(),
            display_name: manifest.display_name.to_string(),
            version: manifest.version.clone(),
            base_filename: Some("base.gguf".to_string()),
            base_sha256: Some(manifest.sha256.clone()),
            gec_filename: manifest
                .adapters
                .iter()
                .find(|(t, _)| t == "gec")
                .map(|_| "gec.gguf".to_string()),
            gec_sha256: manifest
                .adapters
                .iter()
                .find(|(t, _)| t == "gec")
                .map(|(_, a)| a.sha256.clone()),
            completion_filename: manifest
                .adapters
                .iter()
                .find(|(t, _)| t == "completion")
                .map(|_| "completion.gguf".to_string()),
            completion_sha256: manifest
                .adapters
                .iter()
                .find(|(t, _)| t == "completion")
                .map(|(_, a)| a.sha256.clone()),
            distill_filename: manifest
                .adapters
                .iter()
                .find(|(t, _)| t == "distill")
                .map(|_| "distill.gguf".to_string()),
            distill_sha256: manifest
                .adapters
                .iter()
                .find(|(t, _)| t == "distill")
                .map(|(_, a)| a.sha256.clone()),
            total_size_bytes: manifest.total_download_bytes(),
            filename: None,
            size_bytes: None,
            sha256: None,
        }
    } else {
        PersistedLocalAiModelManifest {
            id: manifest.id.clone(),
            display_name: manifest.display_name.clone(),
            version: manifest.version.clone(),
            base_filename: None,
            base_sha256: None,
            gec_filename: None,
            gec_sha256: None,
            completion_filename: None,
            completion_sha256: None,
            distill_filename: None,
            distill_sha256: None,
            total_size_bytes: manifest.size_bytes,
            filename: Some(manifest.filename.clone()),
            size_bytes: Some(manifest.size_bytes),
            sha256: Some(manifest.sha256.clone()),
        }
    };
    let manifest_json = serde_json::to_string_pretty(&metadata)
        .map_err(|error| format!("Failed to serialize local AI model manifest: {error}"))?;
    fs::write(directory.join("manifest.json"), manifest_json)
        .map_err(|error| format!("Failed to write local AI model manifest: {error}"))?;
    fs::write(directory.join("model.gguf.sha256"), &manifest.sha256)
        .map_err(|error| format!("Failed to write local AI model checksum: {error}"))
}

pub(crate) fn normalize_version(v: &str) -> &str {
    v.trim().trim_start_matches('v').trim_start_matches('V')
}

pub(crate) fn manifest_tier(model_id: &str) -> String {
    match model_id {
        LITE_MODEL_ID => "lite".to_string(),
        STANDARD_MODEL_ID => "standard".to_string(),
        PRO_MODEL_ID => "pro".to_string(),
        _ => "standard".to_string(),
    }
}

pub(crate) fn build_status(
    manifest: &LocalAiModelManifest,
    status: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
    path: Option<PathBuf>,
    current_version: Option<String>,
    error: Option<String>,
) -> LocalAiModelStatus {
    let is_available_status = status == "available";
    let has_update = current_version
        .as_deref()
        .is_some_and(|cv| normalize_version(cv) != normalize_version(&manifest.version));

    LocalAiModelStatus {
        model_id: manifest.id.clone(),
        display_name: manifest.display_name.clone(),
        description: manifest.description.clone(),
        tier: manifest_tier(&manifest.id),
        is_recommended: manifest.is_recommended,
        version: if is_available_status {
            current_version.or_else(|| Some(manifest.version.clone()))
        } else {
            current_version
        },
        latest_version: manifest.version.clone(),
        has_update,
        is_available_tier: manifest.is_available,
        status: status.to_string(),
        downloaded_bytes,
        total_bytes,
        path: path.map(|path| path.to_string_lossy().into_owned()),
        error,
    }
}

pub(crate) fn emit_status(app: &AppHandle, status: LocalAiModelStatus) {
    let _ = app.emit(LOCAL_AI_MODEL_PROGRESS_EVENT, status);
}

pub(crate) fn model_directory(manifest: &LocalAiModelManifest) -> Result<PathBuf, String> {
    let data_dir =
        settings::app_data_dir().ok_or_else(|| "Cannot resolve app data directory".to_string())?;
    Ok(data_dir
        .join("ai")
        .join("models")
        .join(safe_model_id(&manifest.id)?))
}

pub(crate) fn local_model_unavailable_message(status: &LocalAiModelStatus) -> String {
    if let Some(error) = &status.error {
        return error.clone();
    }

    match status.status.as_str() {
        "not-downloaded" => "本地模型尚未下载，当前还不能续写。".to_string(),
        "downloading" => "本地模型仍在下载中，请稍后再试。".to_string(),
        "verifying" => "本地模型正在校验中，请稍后再试。".to_string(),
        "failed" => "本地模型不可用，请重新下载。".to_string(),
        _ => "本地模型当前不可用。".to_string(),
    }
}

pub(crate) fn safe_model_id(model_id: &str) -> Result<&str, String> {
    if model_id.is_empty()
        || model_id.contains('/')
        || model_id.contains('\\')
        || model_id == "."
        || model_id == ".."
    {
        return Err("Invalid local AI model id.".to_string());
    }
    Ok(model_id)
}
