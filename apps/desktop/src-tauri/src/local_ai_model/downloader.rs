//! # Local AI Model Downloader
//!
//! 负责调用原生 `curl` 进程断点续传或全量拉取 GGUF 基础模型与 LoRA 适配器，
//! 提供下载进度向 Webview 广播、用户主动取消、以及 staging 目录原子替换保护。

use std::{
    fs,
    io::{Read, Write},
    process::{Command, Stdio},
};
use tauri::{AppHandle, Manager};

use super::{
    manifest::{resolve_manifest, LocalAiFileSpec, LocalAiModelManifest},
    storage::{
        build_status, can_reuse_local_component, compute_sha256_hex, emit_status, model_directory,
        read_model_status, stage_reused_component, write_model_metadata, LocalAiModelStatus,
        PersistedLocalAiModelManifest, DOWNLOAD_TEMP_FILE_NAME,
    },
};
use crate::local_ai_runtime::LocalAiRuntimeState;

pub(crate) const DOWNLOAD_CANCEL_FILE_NAME: &str = "download.cancel";
pub(crate) const LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE: &str = "本地模型下载已取消。";

/// 启动指定本地模型的后台下载流水线。
#[tauri::command]
pub(crate) async fn download_local_ai_model(
    app: AppHandle,
    model_id: Option<String>,
) -> Result<LocalAiModelStatus, String> {
    let manifest = resolve_manifest(model_id.as_deref())?;
    if !manifest.is_available {
        return Err(format!("{} 尚未发布，敬请期待。", manifest.display_name));
    }
    let result = download_model(&app, &manifest).await;
    if let Err(error) = &result {
        if error != LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE {
            // 出错时，保留旧模型状态，不覆盖为 failed
            let status = read_model_status(&manifest);
            emit_status(&app, status);
        }
    }
    result
}

/// 用户点击取消下载，设置取消标记文件并清理未就绪的临时/staging 文件。
#[tauri::command]
pub(crate) fn cancel_local_ai_model_download(
    app: AppHandle,
    model_id: Option<String>,
) -> Result<LocalAiModelStatus, String> {
    let manifest = resolve_manifest(model_id.as_deref())?;
    let directory = model_directory(&manifest)?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create local AI model directory {}: {error}",
            directory.display()
        )
    })?;
    let cancel_path = directory.join(DOWNLOAD_CANCEL_FILE_NAME);
    let temp_path = directory.join(DOWNLOAD_TEMP_FILE_NAME);
    let staging_dir = directory.join("staging.tmp");
    let _ = fs::write(&cancel_path, b"cancel");
    let _ = fs::remove_file(&temp_path);
    let _ = fs::remove_dir_all(&staging_dir);

    let status = read_model_status(&manifest);
    emit_status(&app, status.clone());
    Ok(status)
}

pub(crate) async fn download_model(
    app: &AppHandle,
    manifest: &LocalAiModelManifest,
) -> Result<LocalAiModelStatus, String> {
    let specs = manifest.all_download_specs();
    if specs.is_empty() || specs.iter().any(|(_, s)| s.download_url.trim().is_empty()) {
        return Err("本地模型下载源尚未配置。".to_string());
    }

    // 读取当前状态与持久化版本，保留版本上下文
    let initial_status = read_model_status(manifest);
    let current_version = initial_status.version.clone();

    let directory = model_directory(manifest)?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create local AI model directory {}: {error}",
            directory.display()
        )
    })?;

    let staging_dir = directory.join("staging.tmp");
    if staging_dir.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
    }
    fs::create_dir_all(&staging_dir).map_err(|e| format!("Failed to create staging dir: {e}"))?;

    let cancel_path = directory.join(DOWNLOAD_CANCEL_FILE_NAME);
    let _ = fs::remove_file(&cancel_path);

    // 读取本地持久化清单以快速比对组件 SHA256
    let manifest_path = directory.join("manifest.json");
    let persisted_manifest = if manifest_path.is_file() {
        fs::read_to_string(&manifest_path)
            .ok()
            .and_then(|json| serde_json::from_str::<PersistedLocalAiModelManifest>(&json).ok())
    } else {
        None
    };

    // 分离出：可复用组件（0 网络下载）与待下载组件
    let mut download_specs: Vec<(String, LocalAiFileSpec)> = Vec::new();
    let mut reused_specs: Vec<(String, LocalAiFileSpec)> = Vec::new();

    for (tag, spec) in specs {
        let local_file = directory.join(format!("{tag}.gguf"));
        let persisted_sha = persisted_manifest
            .as_ref()
            .and_then(|p| match tag.as_str() {
                "base" => p.base_sha256.as_deref().or(p.sha256.as_deref()),
                "gec" => p.gec_sha256.as_deref(),
                "completion" => p.completion_sha256.as_deref(),
                "distill" => p.distill_sha256.as_deref(),
                "model" => p.sha256.as_deref(),
                _ => None,
            });

        if can_reuse_local_component(&local_file, &spec, persisted_sha) {
            let final_staged_path = staging_dir.join(format!("{tag}.gguf"));
            if stage_reused_component(&local_file, &final_staged_path).is_ok() {
                reused_specs.push((tag, spec));
                continue;
            }
        }

        download_specs.push((tag, spec));
    }

    let network_total_bytes: u64 = download_specs.iter().map(|(_, s)| s.size_bytes).sum();
    let mut accumulated_bytes: u64 = 0;

    if !download_specs.is_empty() {
        emit_status(
            app,
            build_status(
                manifest,
                "downloading",
                0,
                network_total_bytes,
                None,
                current_version.clone(),
                None,
            ),
        );

        for (tag, spec) in download_specs {
            let temp_file_path = staging_dir.join(format!("{tag}.tmp"));
            let final_staged_path = staging_dir.join(format!("{tag}.gguf"));

            let output = fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&temp_file_path)
                .map_err(|error| {
                    format!(
                        "Failed to create staging file {}: {error}",
                        temp_file_path.display()
                    )
                })?;

            let mut curl = Command::new("curl")
                .arg("-L")
                .arg("--fail")
                .arg("--silent")
                .arg("--show-error")
                .arg(&spec.download_url)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|error| format!("本地模型下载器启动失败：{error}"))?;

            let mut stdout = curl
                .stdout
                .take()
                .ok_or_else(|| "本地模型下载器没有输出流。".to_string())?;

            let mut mut_output = output;
            let mut buffer = [0_u8; 64 * 1024];

            loop {
                if cancel_path.exists() {
                    let _ = curl.kill();
                    let _ = curl.wait();
                    drop(mut_output);
                    let _ = fs::remove_dir_all(&staging_dir);
                    let _ = fs::remove_file(&cancel_path);
                    let status = read_model_status(manifest);
                    emit_status(app, status.clone());
                    return Err(LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE.to_string());
                }

                let read = stdout
                    .read(&mut buffer)
                    .map_err(|error| format!("读取本地模型下载流失败：{error}"))?;
                if read == 0 {
                    break;
                }
                mut_output
                    .write_all(&buffer[..read])
                    .map_err(|error| format!("写入本地模型失败：{error}"))?;
                accumulated_bytes += read as u64;
                emit_status(
                    app,
                    build_status(
                        manifest,
                        "downloading",
                        accumulated_bytes,
                        network_total_bytes,
                        None,
                        current_version.clone(),
                        None,
                    ),
                );
            }

            mut_output
                .flush()
                .map_err(|error| format!("保存本地模型临时文件失败：{error}"))?;
            drop(mut_output);

            if cancel_path.exists() {
                let _ = curl.kill();
                let _ = curl.wait();
                let _ = fs::remove_dir_all(&staging_dir);
                let _ = fs::remove_file(&cancel_path);
                let status = read_model_status(manifest);
                emit_status(app, status.clone());
                return Err(LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE.to_string());
            }

            let status = curl
                .wait()
                .map_err(|error| format!("等待本地模型下载完成时失败：{error}"))?;
            if !status.success() {
                let mut stderr_output = String::new();
                if let Some(mut stderr) = curl.stderr.take() {
                    let _ = stderr.read_to_string(&mut stderr_output);
                }
                let _ = fs::remove_dir_all(&staging_dir);
                let _ = fs::remove_file(&cancel_path);
                let message = stderr_output.trim();
                return Err(if message.is_empty() {
                    format!("下载组件 {tag} 失败。")
                } else {
                    format!("下载组件 {tag} 失败：{message}")
                });
            }

            // SHA256 校验
            if !spec.sha256.trim().is_empty() {
                emit_status(
                    app,
                    build_status(
                        manifest,
                        "verifying",
                        accumulated_bytes,
                        network_total_bytes,
                        None,
                        current_version.clone(),
                        None,
                    ),
                );
                let actual_sha = compute_sha256_hex(&temp_file_path)?;
                if !actual_sha.eq_ignore_ascii_case(&spec.sha256) {
                    let _ = fs::remove_dir_all(&staging_dir);
                    let _ = fs::remove_file(&cancel_path);
                    return Err(format!(
                        "本地模型组件 {tag} 校验失败，已清理未通过校验的文件。"
                    ));
                }
            }

            // 在 staging_dir 中将 .tmp 重命名为 .gguf
            fs::rename(&temp_file_path, &final_staged_path).map_err(|e| {
                format!(
                    "Failed to finalize staged component {}: {e}",
                    final_staged_path.display()
                )
            })?;
        }
    } else {
        // 全部组件本地复用（0 网络下载），发出校验提示完成平滑过渡
        emit_status(
            app,
            build_status(
                manifest,
                "verifying",
                0,
                0,
                None,
                current_version.clone(),
                None,
            ),
        );
    }

    if cancel_path.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
        let _ = fs::remove_file(&cancel_path);
        let status = read_model_status(manifest);
        emit_status(app, status.clone());
        return Err(LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE.to_string());
    }

    // 替换文件前，若当前运行时持有该模型句柄，先优雅停机
    if let Some(runtime) = app.try_state::<LocalAiRuntimeState>() {
        if let Ok(mut manager) = runtime.manager().lock() {
            manager.stop_runtime_if_model(&manifest.id);
        }
    }

    // --- 原子安全替换流水线 ---
    let backup_files = [
        "base.gguf",
        "gec.gguf",
        "completion.gguf",
        "distill.gguf",
        "model.gguf",
    ];
    for name in &backup_files {
        let target = directory.join(name);
        if target.is_file() {
            let backup = directory.join(format!("{name}.old"));
            if backup.exists() {
                let _ = fs::remove_file(&backup);
            }
            let _ = fs::rename(&target, &backup);
        }
    }

    // 将 staging_dir 中的所有 .gguf 移动到 directory
    let entries =
        fs::read_dir(&staging_dir).map_err(|e| format!("Failed to read staging dir: {e}"))?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() && p.extension().is_some_and(|ext| ext == "gguf") {
            if let Some(file_name) = p.file_name() {
                let dest = directory.join(file_name);
                if let Err(e) = fs::rename(&p, &dest) {
                    // 回滚
                    for name in &backup_files {
                        let backup = directory.join(format!("{name}.old"));
                        if backup.is_file() {
                            let orig = directory.join(name);
                            let _ = fs::rename(&backup, &orig);
                        }
                    }
                    let _ = fs::remove_dir_all(&staging_dir);
                    return Err(format!(
                        "Failed to move {file_name:?} into target directory: {e}"
                    ));
                }
            }
        }
    }

    // 写入 metadata
    write_model_metadata(manifest)?;

    // 删除旧备份文件和 staging 目录，彻底释放磁盘空间
    for name in &backup_files {
        let backup = directory.join(format!("{name}.old"));
        if backup.exists() {
            let _ = fs::remove_file(&backup);
        }
    }
    let _ = fs::remove_dir_all(&staging_dir);
    let _ = fs::remove_file(&cancel_path);

    let status = read_model_status(manifest);
    emit_status(app, status.clone());
    Ok(status)
}
