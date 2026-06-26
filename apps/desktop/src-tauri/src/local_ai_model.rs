use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::settings;

const LOCAL_AI_MODEL_PROGRESS_EVENT: &str = "local-ai-model-progress";
const DEFAULT_MODEL_ID: &str = "md-editor-writer-small-v1";
const DOWNLOAD_TEMP_FILE_NAME: &str = "download.tmp";
const DOWNLOAD_CANCEL_FILE_NAME: &str = "download.cancel";
const LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE: &str = "本地模型下载已取消。";

#[derive(Clone, Copy)]
struct LocalAiModelManifest {
    id: &'static str,
    display_name: &'static str,
    version: &'static str,
    filename: &'static str,
    download_url: &'static str,
    size_bytes: u64,
    sha256: &'static str,
    context_size: u32,
    default_max_tokens: u16,
}

const DEFAULT_MODEL: LocalAiModelManifest = LocalAiModelManifest {
    id: DEFAULT_MODEL_ID,
    display_name: "md-editor Writer Small",
    version: "Qwen2.5-0.5B-Instruct-GGUF@9217f5d",
    filename: "model.gguf",
    download_url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf?download=1",
    size_bytes: 491_400_032,
    sha256: "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
    context_size: 4096,
    default_max_tokens: 220,
};

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAiModelStatus {
    model_id: String,
    display_name: String,
    version: Option<String>,
    status: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    path: Option<String>,
    error: Option<String>,
}

impl LocalAiModelStatus {
    pub(crate) fn is_available(&self) -> bool {
        self.status == "available"
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LocalAiModelFile {
    pub(crate) model_id: String,
    pub(crate) display_name: String,
    pub(crate) version: String,
    pub(crate) path: PathBuf,
    pub(crate) context_size: u32,
    pub(crate) default_max_tokens: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedLocalAiModelManifest {
    id: String,
    display_name: String,
    version: String,
    filename: String,
    size_bytes: u64,
    sha256: String,
}

#[tauri::command]
pub(crate) fn get_local_ai_model_status(
    model_id: Option<String>,
) -> Result<LocalAiModelStatus, String> {
    let manifest = resolve_manifest(model_id.as_deref())?;
    Ok(read_model_status(manifest))
}

#[tauri::command]
pub(crate) async fn download_local_ai_model(
    app: AppHandle,
    model_id: Option<String>,
) -> Result<LocalAiModelStatus, String> {
    let manifest = resolve_manifest(model_id.as_deref())?;
    let result = download_model(&app, manifest).await;
    if let Err(error) = &result {
        if error != LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE {
            emit_status(
                &app,
                build_status(
                    manifest,
                    "failed",
                    0,
                    manifest.size_bytes,
                    None,
                    Some(error.clone()),
                ),
            );
        }
    }
    result
}

#[tauri::command]
pub(crate) fn cancel_local_ai_model_download(
    app: AppHandle,
    model_id: Option<String>,
) -> Result<LocalAiModelStatus, String> {
    let manifest = resolve_manifest(model_id.as_deref())?;
    let directory = model_directory(manifest)?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create local AI model directory {}: {error}",
            directory.display()
        )
    })?;
    fs::write(directory.join(DOWNLOAD_CANCEL_FILE_NAME), b"cancel")
        .map_err(|error| format!("取消本地模型下载失败：{error}"))?;

    let temp_path = directory.join(DOWNLOAD_TEMP_FILE_NAME);
    let downloaded_bytes = temp_path.metadata().map(|meta| meta.len()).unwrap_or(0);
    let status = build_status(
        manifest,
        "not-downloaded",
        downloaded_bytes,
        manifest.size_bytes,
        None,
        Some(LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE.to_string()),
    );
    emit_status(&app, status.clone());
    Ok(status)
}

#[tauri::command]
pub(crate) fn delete_local_ai_model(
    app: AppHandle,
    model_id: Option<String>,
) -> Result<LocalAiModelStatus, String> {
    let manifest = resolve_manifest(model_id.as_deref())?;
    let directory = model_directory(manifest)?;
    if directory.exists() {
        fs::remove_dir_all(&directory).map_err(|error| {
            format!(
                "Failed to delete local AI model {}: {error}",
                directory.display()
            )
        })?;
    }
    let status = read_model_status(manifest);
    emit_status(&app, status.clone());
    Ok(status)
}

pub(crate) fn get_available_local_ai_model(
    model_id: Option<&str>,
) -> Result<LocalAiModelFile, String> {
    let manifest = resolve_manifest(model_id)?;
    let status = read_model_status(manifest);
    if !status.is_available() {
        return Err(local_model_unavailable_message(&status));
    }

    let path = model_file_path(manifest)?;
    if !path.exists() {
        return Err("本地模型文件不存在，请重新下载。".to_string());
    }

    Ok(LocalAiModelFile {
        model_id: manifest.id.to_string(),
        display_name: manifest.display_name.to_string(),
        version: manifest.version.to_string(),
        path,
        context_size: manifest.context_size,
        default_max_tokens: manifest.default_max_tokens,
    })
}

async fn download_model(
    app: &AppHandle,
    manifest: LocalAiModelManifest,
) -> Result<LocalAiModelStatus, String> {
    if manifest.download_url.trim().is_empty() {
        return Err("本地模型下载源尚未配置。".to_string());
    }
    if manifest.sha256.trim().is_empty() {
        return Err("本地模型校验 hash 尚未配置。".to_string());
    }

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || download_model_blocking(&app, manifest))
        .await
        .map_err(|error| format!("本地模型下载任务失败：{error}"))?
}

fn download_model_blocking(
    app: &AppHandle,
    manifest: LocalAiModelManifest,
) -> Result<LocalAiModelStatus, String> {
    let directory = model_directory(manifest)?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create local AI model directory {}: {error}",
            directory.display()
        )
    })?;

    let temp_path = directory.join(DOWNLOAD_TEMP_FILE_NAME);
    let cancel_path = directory.join(DOWNLOAD_CANCEL_FILE_NAME);
    let _ = fs::remove_file(&cancel_path);
    let model_path = model_file_path(manifest)?;
    let mut output = fs::File::create(&temp_path).map_err(|error| {
        format!(
            "Failed to create local AI model download file {}: {error}",
            temp_path.display()
        )
    })?;

    let mut curl = Command::new("curl")
        .arg("--location")
        .arg("--fail")
        .arg("--silent")
        .arg("--show-error")
        .arg("--output")
        .arg("-")
        .arg(manifest.download_url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("本地模型下载器启动失败：{error}"))?;

    let mut stdout = curl
        .stdout
        .take()
        .ok_or_else(|| "本地模型下载器没有输出流。".to_string())?;
    let mut downloaded_bytes = 0_u64;
    let total_bytes = manifest.size_bytes;
    emit_status(
        app,
        build_status(manifest, "downloading", 0, total_bytes, None, None),
    );

    let mut buffer = [0_u8; 64 * 1024];
    loop {
        if cancel_path.exists() {
            let _ = curl.kill();
            let _ = curl.wait();
            let _ = fs::remove_file(&temp_path);
            let _ = fs::remove_file(&cancel_path);
            emit_status(
                app,
                build_status(
                    manifest,
                    "not-downloaded",
                    downloaded_bytes,
                    total_bytes,
                    None,
                    Some(LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE.to_string()),
                ),
            );
            return Err(LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE.to_string());
        }

        let read = stdout
            .read(&mut buffer)
            .map_err(|error| format!("读取本地模型下载流失败：{error}"))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| format!("写入本地模型失败：{error}"))?;
        downloaded_bytes += read as u64;
        emit_status(
            app,
            build_status(
                manifest,
                "downloading",
                downloaded_bytes,
                total_bytes,
                None,
                None,
            ),
        );
    }

    output
        .flush()
        .map_err(|error| format!("保存本地模型失败：{error}"))?;
    drop(output);

    if cancel_path.exists() {
        let _ = curl.kill();
        let _ = curl.wait();
        let _ = fs::remove_file(&temp_path);
        let _ = fs::remove_file(&cancel_path);
        emit_status(
            app,
            build_status(
                manifest,
                "not-downloaded",
                downloaded_bytes,
                total_bytes,
                None,
                Some(LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE.to_string()),
            ),
        );
        return Err(LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE.to_string());
    }

    let status = curl
        .wait()
        .map_err(|error| format!("等待本地模型下载完成时失败：{error}"))?;
    let mut stderr_output = String::new();
    if let Some(mut stderr) = curl.stderr.take() {
        let _ = stderr.read_to_string(&mut stderr_output);
    }
    if !status.success() {
        let _ = fs::remove_file(&temp_path);
        let _ = fs::remove_file(&cancel_path);
        let message = stderr_output.trim();
        return Err(if message.is_empty() {
            "本地模型下载失败。".to_string()
        } else {
            format!("本地模型下载失败：{message}")
        });
    }

    emit_status(
        app,
        build_status(
            manifest,
            "verifying",
            downloaded_bytes,
            total_bytes,
            None,
            None,
        ),
    );
    if cancel_path.exists() {
        let _ = fs::remove_file(&temp_path);
        let _ = fs::remove_file(&cancel_path);
        emit_status(
            app,
            build_status(
                manifest,
                "not-downloaded",
                downloaded_bytes,
                total_bytes,
                None,
                Some(LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE.to_string()),
            ),
        );
        return Err(LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE.to_string());
    }
    let actual_sha256 = compute_sha256_hex(&temp_path)?;
    if actual_sha256 != manifest.sha256.to_ascii_lowercase() {
        let _ = fs::remove_file(&temp_path);
        let _ = fs::remove_file(&cancel_path);
        return Err("本地模型校验失败，已删除未通过校验的下载文件。".to_string());
    }

    if model_path.exists() {
        fs::remove_file(&model_path).map_err(|error| {
            format!(
                "Failed to replace local AI model {}: {error}",
                model_path.display()
            )
        })?;
    }
    fs::rename(&temp_path, &model_path).map_err(|error| {
        format!(
            "Failed to move local AI model from {} to {}: {error}",
            temp_path.display(),
            model_path.display()
        )
    })?;
    write_model_metadata(manifest)?;
    let _ = fs::remove_file(&cancel_path);

    let status = read_model_status(manifest);
    emit_status(app, status.clone());
    Ok(status)
}

fn compute_sha256_hex(path: &Path) -> Result<String, String> {
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
            "shasum" => Command::new(command)
                .arg("-a")
                .arg("256")
                .arg(path)
                .output(),
            "sha256sum" => Command::new(command).arg(path).output(),
            "openssl" => Command::new(command)
                .arg("dgst")
                .arg("-sha256")
                .arg(path)
                .output(),
            _ => unreachable!(),
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

fn extract_first_hex_hash(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|token| token.len() == 64 && token.chars().all(|c| c.is_ascii_hexdigit()))
        .map(|token| token.to_ascii_lowercase())
}

fn resolve_manifest(model_id: Option<&str>) -> Result<LocalAiModelManifest, String> {
    match model_id.unwrap_or(DEFAULT_MODEL_ID) {
        DEFAULT_MODEL_ID => Ok(DEFAULT_MODEL),
        other => Err(format!("未知的本地模型：{other}")),
    }
}

fn read_model_status(manifest: LocalAiModelManifest) -> LocalAiModelStatus {
    let Ok(model_path) = model_file_path(manifest) else {
        return build_status(
            manifest,
            "failed",
            0,
            manifest.size_bytes,
            None,
            Some("无法解析本地模型目录。".to_string()),
        );
    };
    let temp_path = model_path
        .parent()
        .map(|directory| directory.join(DOWNLOAD_TEMP_FILE_NAME));

    if model_path.exists() {
        let downloaded_bytes = model_path.metadata().map(|meta| meta.len()).unwrap_or(0);
        let checksum_record = model_path
            .parent()
            .map(|directory| directory.join("model.gguf.sha256"))
            .and_then(|path| fs::read_to_string(path).ok())
            .map(|value| value.trim().to_string());
        if manifest.sha256.trim().is_empty() || checksum_record.as_deref() == Some(manifest.sha256)
        {
            return build_status(
                manifest,
                "available",
                downloaded_bytes,
                manifest.size_bytes.max(downloaded_bytes),
                Some(model_path),
                None,
            );
        }
        return build_status(
            manifest,
            "failed",
            downloaded_bytes,
            manifest.size_bytes.max(downloaded_bytes),
            Some(model_path),
            Some("本地模型校验记录不匹配，请重新下载。".to_string()),
        );
    }

    if let Some(temp_path) = temp_path.filter(|path| path.exists()) {
        let downloaded_bytes = temp_path.metadata().map(|meta| meta.len()).unwrap_or(0);
        return build_status(
            manifest,
            "failed",
            downloaded_bytes,
            manifest.size_bytes.max(downloaded_bytes),
            None,
            Some("上次下载未完成，请重试。".to_string()),
        );
    }

    build_status(
        manifest,
        "not-downloaded",
        0,
        manifest.size_bytes,
        None,
        None,
    )
}

fn write_model_metadata(manifest: LocalAiModelManifest) -> Result<(), String> {
    let directory = model_directory(manifest)?;
    let metadata = PersistedLocalAiModelManifest {
        id: manifest.id.to_string(),
        display_name: manifest.display_name.to_string(),
        version: manifest.version.to_string(),
        filename: manifest.filename.to_string(),
        size_bytes: manifest.size_bytes,
        sha256: manifest.sha256.to_string(),
    };
    let manifest_json = serde_json::to_string_pretty(&metadata)
        .map_err(|error| format!("Failed to serialize local AI model manifest: {error}"))?;
    fs::write(directory.join("manifest.json"), manifest_json)
        .map_err(|error| format!("Failed to write local AI model manifest: {error}"))?;
    fs::write(directory.join("model.gguf.sha256"), manifest.sha256)
        .map_err(|error| format!("Failed to write local AI model checksum: {error}"))
}

fn build_status(
    manifest: LocalAiModelManifest,
    status: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
    path: Option<PathBuf>,
    error: Option<String>,
) -> LocalAiModelStatus {
    LocalAiModelStatus {
        model_id: manifest.id.to_string(),
        display_name: manifest.display_name.to_string(),
        version: (status == "available").then(|| manifest.version.to_string()),
        status: status.to_string(),
        downloaded_bytes,
        total_bytes,
        path: path.map(|path| path.to_string_lossy().into_owned()),
        error,
    }
}

fn emit_status(app: &AppHandle, status: LocalAiModelStatus) {
    let _ = app.emit(LOCAL_AI_MODEL_PROGRESS_EVENT, status);
}

fn model_file_path(manifest: LocalAiModelManifest) -> Result<PathBuf, String> {
    Ok(model_directory(manifest)?.join(manifest.filename))
}

fn model_directory(manifest: LocalAiModelManifest) -> Result<PathBuf, String> {
    let data_dir =
        settings::app_data_dir().ok_or_else(|| "Cannot resolve app data directory".to_string())?;
    Ok(data_dir
        .join("ai")
        .join("models")
        .join(safe_model_id(manifest.id)?))
}

fn local_model_unavailable_message(status: &LocalAiModelStatus) -> String {
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

fn safe_model_id(model_id: &str) -> Result<&str, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_model_ids() {
        assert!(resolve_manifest(Some("other-model")).is_err());
    }

    #[test]
    fn rejects_path_like_model_ids() {
        assert!(safe_model_id("../model").is_err());
        assert!(safe_model_id("nested/model").is_err());
        assert_eq!(safe_model_id(DEFAULT_MODEL_ID), Ok(DEFAULT_MODEL_ID));
    }
}
