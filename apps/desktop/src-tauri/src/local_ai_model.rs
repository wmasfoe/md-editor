use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::{local_ai_runtime::LocalAiRuntimeState, settings};

const LOCAL_AI_MODEL_PROGRESS_EVENT: &str = "local-ai-model-progress";
const DEFAULT_MODEL_ID: &str = "md-editor-writer-standard";
const LEGACY_MODEL_ID: &str = "md-editor-writer-small-v1";
const LITE_MODEL_ID: &str = "md-editor-writer-lite";
const STANDARD_MODEL_ID: &str = "md-editor-writer-standard";
const PRO_MODEL_ID: &str = "md-editor-writer-pro";

const LEGACY_V100_LITE_SHA256: &str =
    "eda69b3628916c009306d9b6260623c71bd25d18dab2a51b2d9c687b51304e0b";
const LEGACY_V100_STANDARD_SHA256: &str =
    "cd7d83d9a891c1488f6579417a7039acfb9648e046b89d286e5422c2e00e4eab";

const DOWNLOAD_TEMP_FILE_NAME: &str = "download.tmp";
const DOWNLOAD_CANCEL_FILE_NAME: &str = "download.cancel";
const LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE: &str = "本地模型下载已取消。";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LocalAiModelManifest {
    pub(crate) id: String,
    pub(crate) display_name: String,
    pub(crate) description: String,
    pub(crate) version: String,
    pub(crate) filename: String,
    pub(crate) download_url: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
    pub(crate) context_size: u32,
    pub(crate) default_max_tokens: u16,
    pub(crate) is_available: bool,
    pub(crate) is_recommended: bool,
}

pub(crate) fn default_lite_model() -> LocalAiModelManifest {
    LocalAiModelManifest {
        id: LITE_MODEL_ID.to_string(),
        display_name: "Lite (0.5B)".to_string(),
        description: "自研微调轻量模型，极速响应，适合轻薄本与日常流畅写作。".to_string(),
        version: "v1.1.0".to_string(),
        filename: "model.gguf".to_string(),
        download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.1.0/qwen2.5-0.5b-editor-v1.1.0-Q4_K_M.gguf".to_string(),
        size_bytes: 397_554_976,
        sha256: "9f90196672209bbb311d689495d7ff696100543d6a270c59c8071c8c9bfd7a04".to_string(),
        context_size: 8192,
        default_max_tokens: 220,
        is_available: true,
        is_recommended: true,
    }
}

pub(crate) fn default_standard_model() -> LocalAiModelManifest {
    LocalAiModelManifest {
        id: STANDARD_MODEL_ID.to_string(),
        display_name: "Standard (1.5B)".to_string(),
        description: "自研微调高精度进阶版，更强复杂长句纠错与代码续写能力。".to_string(),
        version: "v1.1.0".to_string(),
        filename: "model.gguf".to_string(),
        download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.1.0/qwen2.5-1.5b-editor-v1.1.0-Q4_K_M.gguf".to_string(),
        size_bytes: 397_554_976,
        sha256: "9f90196672209bbb311d689495d7ff696100543d6a270c59c8071c8c9bfd7a04".to_string(),
        context_size: 8192,
        default_max_tokens: 260,
        is_available: true,
        is_recommended: false,
    }
}

pub(crate) fn default_pro_model() -> LocalAiModelManifest {
    LocalAiModelManifest {
        id: PRO_MODEL_ID.to_string(),
        display_name: "Pro".to_string(),
        description: "旗舰级深度长文创作、论文润色与逻辑重构（敬请期待）。".to_string(),
        version: "v0.0.0-beta".to_string(),
        filename: "model.gguf".to_string(),
        download_url: String::new(),
        size_bytes: 0,
        sha256: String::new(),
        context_size: 8192,
        default_max_tokens: 400,
        is_available: false,
        is_recommended: false,
    }
}

pub(crate) fn default_manifests() -> Vec<LocalAiModelManifest> {
    vec![
        default_lite_model(),
        default_standard_model(),
        default_pro_model(),
    ]
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RemoteModelAsset {
    version: Option<String>,
    filename: Option<String>,
    size_bytes: Option<u64>,
    sha256: Option<String>,
    download_url: Option<String>,
    quant: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteModelCapability {
    #[serde(flatten)]
    asset: RemoteModelAsset,
    adapter_id: Option<String>,
    task: Option<String>,
    base_model_id: Option<String>,
    base_model_version: Option<String>,
    base_sha256: Option<String>,
    prompt_protocol: Option<String>,
    grammar: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteModelEntry {
    model_id: Option<String>,
    tier: Option<String>,
    display_name: Option<String>,
    description: Option<String>,
    is_available: Option<bool>,
    recommended: Option<bool>,
    // v1 平铺完整模型字段（兼容历史 manifest）
    filename: Option<String>,
    size_bytes: Option<u64>,
    sha256: Option<String>,
    download_url: Option<String>,
    // v2 分档资产：Base + capabilities
    base: Option<RemoteModelAsset>,
    capabilities: Option<std::collections::BTreeMap<String, RemoteModelCapability>>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteManifest {
    schema_version: Option<u32>,
    version: String,
    models: Vec<RemoteModelEntry>,
    context_size: Option<u32>,
}

fn remote_manifest_cache_path() -> Result<PathBuf, String> {
    let data_dir =
        settings::app_data_dir().ok_or_else(|| "Cannot resolve app data directory".to_string())?;
    Ok(data_dir
        .join("ai")
        .join("models")
        .join("remote_manifest.json"))
}

fn load_cached_remote_manifest() -> Option<RemoteManifest> {
    let path = remote_manifest_cache_path().ok()?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<RemoteManifest>(&content).ok()
}

fn save_cached_remote_manifest(manifest: &RemoteManifest) -> Result<(), String> {
    let path = remote_manifest_cache_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create models directory: {e}"))?;
    }
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize remote manifest: {e}"))?;
    fs::write(path, json).map_err(|e| format!("Failed to write remote manifest: {e}"))?;
    Ok(())
}

fn fetch_remote_manifest() -> Result<RemoteManifest, String> {
    // Release 资产是发布脚本真正上传的位置（raw 分支文件长期 404），优先拉取 release。
    let urls = [
        "https://github.com/wmasfoe/md-editor-models/releases/latest/download/manifest.json",
        "https://raw.githubusercontent.com/wmasfoe/md-editor-models/master/manifest.json",
        "https://raw.githubusercontent.com/wmasfoe/md-editor-models/main/manifest.json",
    ];

    for url in urls {
        let output = Command::new("curl")
            .arg("-sL")
            .arg("--connect-timeout")
            .arg("8")
            .arg("--max-time")
            .arg("15")
            .arg(url)
            .output();

        if let Ok(output) = output {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                if let Ok(manifest) = serde_json::from_str::<RemoteManifest>(&text) {
                    if !manifest.version.trim().is_empty() && !manifest.models.is_empty() {
                        let _ = save_cached_remote_manifest(&manifest);
                        return Ok(manifest);
                    }
                }
            }
        }
    }

    Err("无法获取远程模型清单，请检查网络连接。".to_string())
}

fn normalize_remote_version(version: &str) -> String {
    if version.starts_with('v') || version.starts_with('V') {
        version.to_string()
    } else {
        format!("v{version}")
    }
}

/// 将远端逻辑档位/模型 id 归一化为客户端内置逻辑 id，保证旧存档 modelId 兼容。
fn resolve_logical_model_id(tier: Option<&str>, model_id: Option<&str>) -> Option<&'static str> {
    if let Some(id) = model_id {
        match id {
            LEGACY_MODEL_ID => return Some(LITE_MODEL_ID),
            LITE_MODEL_ID | STANDARD_MODEL_ID | PRO_MODEL_ID => {
                return Some(match id {
                    LITE_MODEL_ID => LITE_MODEL_ID,
                    STANDARD_MODEL_ID => STANDARD_MODEL_ID,
                    _ => PRO_MODEL_ID,
                })
            }
            "qwen2.5-0.5b-editor" | "qwen2.5-0.6b-editor" | "qwen3-0.6b-editor" => {
                return Some(LITE_MODEL_ID);
            }
            "qwen2.5-1.5b-editor" | "qwen3-1.5b-editor" => return Some(STANDARD_MODEL_ID),
            _ => {}
        }
    }
    match tier {
        Some("lite") => Some(LITE_MODEL_ID),
        Some("standard") => Some(STANDARD_MODEL_ID),
        Some("pro") => Some(PRO_MODEL_ID),
        _ => None,
    }
}

/// v2 逻辑档位中，主模型文件 = base 资产；v1 平铺完整模型则直接用平铺字段。
fn entry_primary_asset(entry: &RemoteModelEntry) -> RemoteModelAsset {
    entry.base.clone().unwrap_or(RemoteModelAsset {
        version: None,
        filename: entry.filename.clone(),
        size_bytes: entry.size_bytes,
        sha256: entry.sha256.clone(),
        download_url: entry.download_url.clone(),
        quant: None,
    })
}

/// 基于远端 manifest 动态构建完整 Model Catalog（唯一事实来源）。
/// 无法获得远端 catalog 时回退到内置默认列表，保证离线可用。
fn build_catalog_from_remote(remote: &RemoteManifest) -> Vec<LocalAiModelManifest> {
    let remote_version = normalize_remote_version(&remote.version);
    let context_size = remote.context_size.unwrap_or(8192);
    let mut catalog: Vec<LocalAiModelManifest> = Vec::new();

    for entry in &remote.models {
        let Some(logical_id) =
            resolve_logical_model_id(entry.tier.as_deref(), entry.model_id.as_deref())
        else {
            continue;
        };
        let asset = entry_primary_asset(entry);
        // v2 base 资产按真实文件名落盘；v1 完整模型沿用历史固定名 model.gguf，
        // 保证已下载用户的本地文件路径不因 manifest 升级而失效。
        let local_filename = if entry.base.is_some() {
            asset
                .filename
                .clone()
                .unwrap_or_else(|| "model.gguf".to_string())
        } else {
            "model.gguf".to_string()
        };
        let is_available = entry.is_available.unwrap_or(true)
            && asset
                .download_url
                .as_deref()
                .is_some_and(|url| !url.is_empty());
        let is_recommended = entry.recommended.unwrap_or(false);

        // 保持 catalog 稳定顺序：lite / standard / pro，且同档位只保留最新一条
        if let Some(existing) = catalog.iter_mut().find(|m| m.id == logical_id) {
            existing.version = remote_version.clone();
            existing.display_name = entry
                .display_name
                .clone()
                .unwrap_or_else(|| existing.display_name.clone());
            existing.description = entry
                .description
                .clone()
                .unwrap_or_else(|| existing.description.clone());
            existing.is_available = is_available;
            existing.is_recommended = is_recommended;
            if !local_filename.is_empty() {
                existing.filename = local_filename.clone();
            }
            if let Some(url) = &asset.download_url {
                if !url.is_empty() {
                    existing.download_url = url.clone();
                }
            }
            if let Some(size) = asset.size_bytes {
                if size > 0 {
                    existing.size_bytes = size;
                }
            }
            if let Some(sha) = &asset.sha256 {
                if !sha.is_empty() {
                    existing.sha256 = sha.clone();
                }
            }
            if let Some(quant) = &asset.quant {
                if !quant.is_empty() {
                    let _ = quant;
                }
            }
            existing.context_size = context_size;
            continue;
        }

        catalog.push(LocalAiModelManifest {
            id: logical_id.to_string(),
            display_name: entry
                .display_name
                .clone()
                .unwrap_or_else(|| logical_id.to_string()),
            description: entry.description.clone().unwrap_or_default(),
            version: remote_version.clone(),
            filename: local_filename,
            download_url: asset.download_url.clone().unwrap_or_default(),
            size_bytes: asset.size_bytes.unwrap_or(0),
            sha256: asset.sha256.clone().unwrap_or_default(),
            context_size,
            default_max_tokens: match logical_id {
                LITE_MODEL_ID => 220,
                STANDARD_MODEL_ID => 260,
                _ => 400,
            },
            is_available,
            is_recommended,
        });
    }

    if catalog.is_empty() {
        return default_manifests();
    }
    catalog
}

pub(crate) fn resolve_all_manifests() -> Vec<LocalAiModelManifest> {
    if let Some(remote) = load_cached_remote_manifest() {
        let catalog = build_catalog_from_remote(&remote);
        if !catalog.is_empty() {
            return catalog;
        }
    }
    default_manifests()
}

pub(crate) fn resolve_manifest(model_id: Option<&str>) -> Result<LocalAiModelManifest, String> {
    let target = model_id.unwrap_or(DEFAULT_MODEL_ID);
    let all = resolve_all_manifests();
    for m in all {
        if m.id.as_str() == target
            || (target == LEGACY_MODEL_ID && m.id == LITE_MODEL_ID)
            || (target == "qwen2.5-0.5b-editor" && m.id == LITE_MODEL_ID)
            || (target == "qwen2.5-1.5b-editor" && m.id == STANDARD_MODEL_ID)
        {
            return Ok(m);
        }
    }
    Err(format!("未知的本地模型：{target}"))
}

/// 任务能力路由：从远端 catalog 的 capabilities 中解析某任务对应的 Adapter 资产。
/// 返回 (adapter 文件名, 下载 URL, SHA256)。v2 尚未发布/无该能力时返回明确错误。
pub(crate) fn resolve_capability_asset(
    model_id: &str,
    task: &str,
) -> Result<(String, String, String), String> {
    let target = match model_id {
        LEGACY_MODEL_ID => LITE_MODEL_ID,
        _ => model_id,
    };
    let remote = load_cached_remote_manifest()
        .ok_or_else(|| format!("远程模型清单尚未加载，无法解析 {model_id} 的任务能力。"))?;
    let entry = remote
        .models
        .iter()
        .find(|entry| {
            resolve_logical_model_id(entry.tier.as_deref(), entry.model_id.as_deref())
                == Some(target)
        })
        .ok_or_else(|| format!("未知的本地模型：{target}"))?;
    let capability = entry
        .capabilities
        .as_ref()
        .and_then(|caps| caps.get(task))
        .ok_or_else(|| format!("{target} 不支持任务：{task}"))?;
    let filename = capability
        .asset
        .filename
        .clone()
        .ok_or_else(|| format!("{target} 的任务 {task} 缺少 Adapter 文件名"))?;
    let url = capability
        .asset
        .download_url
        .clone()
        .ok_or_else(|| format!("{target} 的任务 {task} 缺少 Adapter 下载地址"))?;
    let sha256 = capability.asset.sha256.clone().unwrap_or_default();
    Ok((filename, url, sha256))
}

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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LocalAiModelFile {
    pub(crate) model_id: String,
    pub(crate) display_name: String,
    pub(crate) version: String,
    pub(crate) path: PathBuf,
    pub(crate) context_size: u32,
    pub(crate) default_max_tokens: u16,
}

#[derive(Serialize, serde::Deserialize)]
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
    Ok(read_model_status(&manifest))
}

#[tauri::command]
pub(crate) fn get_all_local_ai_models_status() -> Result<Vec<LocalAiModelStatus>, String> {
    Ok(resolve_all_manifests()
        .into_iter()
        .map(|manifest| read_model_status(&manifest))
        .collect())
}

#[tauri::command]
pub(crate) async fn check_local_ai_model_updates() -> Result<Vec<LocalAiModelStatus>, String> {
    let remote_res = tauri::async_runtime::spawn_blocking(fetch_remote_manifest).await;
    match remote_res {
        Ok(Ok(remote)) => {
            let manifests = build_catalog_from_remote(&remote);
            Ok(manifests.iter().map(read_model_status).collect())
        }
        _ => {
            // 网络异常时回退到缓存或默认配置
            get_all_local_ai_models_status()
        }
    }
}

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
    let _ = fs::write(&cancel_path, b"cancel");
    let _ = fs::remove_file(&temp_path);

    let status = read_model_status(&manifest);
    emit_status(&app, status.clone());
    Ok(status)
}

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

    let path = model_file_path(&manifest)?;
    if !path.exists() {
        return Err("本地模型文件不存在，请先下载。".to_string());
    }

    Ok(LocalAiModelFile {
        model_id: manifest.id.clone(),
        display_name: manifest.display_name.clone(),
        version: status.version.unwrap_or_else(|| manifest.version.clone()),
        path,
        context_size: manifest.context_size,
        default_max_tokens: manifest.default_max_tokens,
    })
}

async fn download_model(
    app: &AppHandle,
    manifest: &LocalAiModelManifest,
) -> Result<LocalAiModelStatus, String> {
    if manifest.download_url.trim().is_empty() {
        return Err("本地模型下载源尚未配置。".to_string());
    }

    let directory = model_directory(manifest)?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create local AI model directory {}: {error}",
            directory.display()
        )
    })?;

    let model_path = directory.join(&manifest.filename);
    let temp_path = directory.join(DOWNLOAD_TEMP_FILE_NAME);
    let cancel_path = directory.join(DOWNLOAD_CANCEL_FILE_NAME);
    let _ = fs::remove_file(&cancel_path);

    let output = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&temp_path)
        .map_err(|error| format!("Failed to create local AI model temp file: {error}"))?;

    let mut curl = Command::new("curl")
        .arg("-L")
        .arg("--fail")
        .arg("--silent")
        .arg("--show-error")
        .arg(&manifest.download_url)
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
        build_status(manifest, "downloading", 0, total_bytes, None, None, None),
    );

    let mut mut_output = output;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        if cancel_path.exists() {
            let _ = curl.kill();
            let _ = curl.wait();
            drop(mut_output);
            return handle_download_cancelled(app, manifest, &temp_path, &cancel_path);
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
                None,
            ),
        );
    }

    mut_output
        .flush()
        .map_err(|error| format!("保存本地模型失败：{error}"))?;
    drop(mut_output);

    if cancel_path.exists() {
        let _ = curl.kill();
        let _ = curl.wait();
        return handle_download_cancelled(app, manifest, &temp_path, &cancel_path);
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
            None,
        ),
    );
    if cancel_path.exists() {
        return handle_download_cancelled(app, manifest, &temp_path, &cancel_path);
    }

    if !manifest.sha256.trim().is_empty() {
        let actual_sha256 = compute_sha256_hex(&temp_path)?;
        if actual_sha256 != manifest.sha256.to_ascii_lowercase() {
            let _ = fs::remove_file(&temp_path);
            let _ = fs::remove_file(&cancel_path);
            return Err("本地模型校验失败，已删除未通过校验的下载文件。".to_string());
        }
    }

    // --- 原子安全替换流水线 ---
    let backup_path = directory.join("model.gguf.old");
    if backup_path.exists() {
        let _ = fs::remove_file(&backup_path);
    }

    // 1. 如果旧模型存在，先重命名为 backup_path (model.gguf.old)
    if model_path.exists() {
        fs::rename(&model_path, &backup_path).map_err(|error| {
            format!(
                "Failed to backup existing local AI model {}: {error}",
                model_path.display()
            )
        })?;
    }

    // 2. 将新下载已校验的文件原子替换为 model.gguf
    if let Err(error) = fs::rename(&temp_path, &model_path) {
        // 如果移动新模型发生错误，安全回滚旧模型
        if backup_path.exists() {
            let _ = fs::rename(&backup_path, &model_path);
        }
        return Err(format!(
            "Failed to replace model with new file from {} to {}: {error}",
            temp_path.display(),
            model_path.display()
        ));
    }

    // 3. 写入最新模型元数据与校验和
    write_model_metadata(manifest)?;

    // 4. 【关键保障】：新模型替换成功后，立即删除旧模型备份文件，彻底释放磁盘空间！
    if backup_path.exists() {
        let _ = fs::remove_file(&backup_path);
    }
    let _ = fs::remove_file(&cancel_path);

    let status = read_model_status(manifest);
    emit_status(app, status.clone());
    Ok(status)
}

fn handle_download_cancelled(
    app: &AppHandle,
    manifest: &LocalAiModelManifest,
    temp_path: &Path,
    cancel_path: &Path,
) -> Result<LocalAiModelStatus, String> {
    let _ = fs::remove_file(temp_path);
    let _ = fs::remove_file(cancel_path);
    let status = read_model_status(manifest);
    emit_status(app, status.clone());
    Err(LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE.to_string())
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

fn extract_first_hex_hash(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|token| token.len() == 64 && token.chars().all(|c| c.is_ascii_hexdigit()))
        .map(|token| token.to_ascii_lowercase())
}

fn read_model_status(manifest: &LocalAiModelManifest) -> LocalAiModelStatus {
    if !manifest.is_available {
        return build_status(
            manifest,
            "not-downloaded",
            0,
            manifest.size_bytes,
            None,
            None,
            None,
        );
    }

    let Ok(model_path) = model_file_path(manifest) else {
        return build_status(
            manifest,
            "failed",
            0,
            manifest.size_bytes,
            None,
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
        let persisted_manifest = model_path
            .parent()
            .and_then(|dir| fs::read_to_string(dir.join("manifest.json")).ok())
            .and_then(|json| serde_json::from_str::<PersistedLocalAiModelManifest>(&json).ok());

        let (effective_version, is_valid_checksum) = match persisted_manifest {
            Some(persisted) => {
                let valid = persisted.sha256.trim().is_empty()
                    || checksum_record.as_deref() == Some(&persisted.sha256)
                    || checksum_record.as_deref() == Some(&manifest.sha256)
                    || (manifest.id.as_str() == LITE_MODEL_ID
                        && checksum_record.as_deref() == Some(LEGACY_V100_LITE_SHA256))
                    || (manifest.id == STANDARD_MODEL_ID
                        && checksum_record.as_deref() == Some(LEGACY_V100_STANDARD_SHA256));
                (persisted.version, valid)
            }
            None => {
                // 如果本地有模型文件但未写 manifest.json，通过 checksum 判定版本
                if checksum_record.as_deref() == Some(LEGACY_V100_LITE_SHA256)
                    || checksum_record.as_deref() == Some(LEGACY_V100_STANDARD_SHA256)
                {
                    ("v1.0.0".to_string(), true)
                } else if checksum_record.as_deref() == Some(&manifest.sha256)
                    || manifest.sha256.is_empty()
                {
                    (manifest.version.clone(), true)
                } else {
                    ("v1.0.0".to_string(), true)
                }
            }
        };

        if is_valid_checksum {
            return build_status(
                manifest,
                "available",
                downloaded_bytes,
                manifest.size_bytes.max(downloaded_bytes),
                Some(model_path),
                Some(effective_version),
                None,
            );
        }

        return build_status(
            manifest,
            "failed",
            downloaded_bytes,
            manifest.size_bytes.max(downloaded_bytes),
            Some(model_path),
            Some(effective_version),
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
        None,
    )
}

fn write_model_metadata(manifest: &LocalAiModelManifest) -> Result<(), String> {
    let directory = model_directory(manifest)?;
    let metadata = PersistedLocalAiModelManifest {
        id: manifest.id.clone(),
        display_name: manifest.display_name.clone(),
        version: manifest.version.clone(),
        filename: manifest.filename.to_string(),
        size_bytes: manifest.size_bytes,
        sha256: manifest.sha256.clone(),
    };
    let manifest_json = serde_json::to_string_pretty(&metadata)
        .map_err(|error| format!("Failed to serialize local AI model manifest: {error}"))?;
    fs::write(directory.join("manifest.json"), manifest_json)
        .map_err(|error| format!("Failed to write local AI model manifest: {error}"))?;
    fs::write(directory.join("model.gguf.sha256"), &manifest.sha256)
        .map_err(|error| format!("Failed to write local AI model checksum: {error}"))
}

fn normalize_version(v: &str) -> &str {
    v.trim().trim_start_matches('v').trim_start_matches('V')
}

fn manifest_tier(model_id: &str) -> String {
    match model_id {
        LITE_MODEL_ID => "lite".to_string(),
        STANDARD_MODEL_ID => "standard".to_string(),
        PRO_MODEL_ID => "pro".to_string(),
        _ => "standard".to_string(),
    }
}

fn build_status(
    manifest: &LocalAiModelManifest,
    status: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
    path: Option<PathBuf>,
    current_version: Option<String>,
    error: Option<String>,
) -> LocalAiModelStatus {
    let is_available_status = status == "available";
    let has_update = is_available_status
        && current_version
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
            None
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

fn emit_status(app: &AppHandle, status: LocalAiModelStatus) {
    let _ = app.emit(LOCAL_AI_MODEL_PROGRESS_EVENT, status);
}

fn model_file_path(manifest: &LocalAiModelManifest) -> Result<PathBuf, String> {
    Ok(model_directory(manifest)?.join(&manifest.filename))
}

fn model_directory(manifest: &LocalAiModelManifest) -> Result<PathBuf, String> {
    let data_dir =
        settings::app_data_dir().ok_or_else(|| "Cannot resolve app data directory".to_string())?;
    Ok(data_dir
        .join("ai")
        .join("models")
        .join(safe_model_id(&manifest.id)?))
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
    fn resolves_builtin_models() {
        assert_eq!(
            resolve_manifest(Some(LITE_MODEL_ID)).unwrap().id,
            LITE_MODEL_ID.to_string()
        );
        assert_eq!(
            resolve_manifest(Some(STANDARD_MODEL_ID)).unwrap().id,
            STANDARD_MODEL_ID.to_string()
        );
        assert_eq!(
            resolve_manifest(Some(PRO_MODEL_ID)).unwrap().id,
            PRO_MODEL_ID.to_string()
        );
        assert_eq!(
            resolve_manifest(Some(LEGACY_MODEL_ID)).unwrap().id,
            LITE_MODEL_ID.to_string()
        );
    }

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

    #[test]
    fn parses_and_builds_catalog_from_v1_remote_manifest() {
        let json = r#"{
            "version": "1.1.0",
            "models": [
                {
                    "tier": "lite",
                    "modelId": "qwen2.5-0.5b-editor",
                    "filename": "qwen2.5-0.5b-editor-v1.1.0-Q4_K_M.gguf",
                    "sizeBytes": 397554976,
                    "sha256": "9f90196672209bbb311d689495d7ff696100543d6a270c59c8071c8c9bfd7a04",
                    "downloadUrl": "https://example.com/lite.gguf"
                }
            ]
        }"#;
        let remote: RemoteManifest = serde_json::from_str(json).unwrap();
        let list = build_catalog_from_remote(&remote);
        let lite = list.iter().find(|m| m.id == LITE_MODEL_ID).unwrap();
        assert_eq!(lite.version, "v1.1.0");
        assert_eq!(lite.download_url, "https://example.com/lite.gguf");
        assert_eq!(lite.size_bytes, 397554976);
        // v1 完整模型沿用历史固定本地文件名，避免破坏已下载用户
        assert_eq!(lite.filename, "model.gguf");
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn parses_v2_manifest_with_base_and_capabilities() {
        let json = r#"{
            "schemaVersion": 2,
            "version": "1.2.0",
            "models": [
                {
                    "modelId": "md-editor-writer-lite",
                    "tier": "lite",
                    "displayName": "Lite (0.6B)",
                    "description": "轻量极速版",
                    "recommended": true,
                    "isAvailable": true,
                    "base": {
                        "version": "v1.2.0",
                        "filename": "lite-base-qwen3-0.6b-v1.2.0-Q4_K_M.gguf",
                        "sizeBytes": 123456,
                        "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "downloadUrl": "https://example.com/lite-base.gguf"
                    },
                    "capabilities": {
                        "gec": {
                            "adapterId": "md-editor-writer-lite-gec",
                            "task": "gec",
                            "baseModelId": "md-editor-writer-lite",
                            "baseModelVersion": "v1.2.0",
                            "baseSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                            "filename": "lite-gec-v1.2.0-Q4_K_M.gguf",
                            "sizeBytes": 22222,
                            "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                            "downloadUrl": "https://example.com/lite-gec.gguf",
                            "promptProtocol": "gec-v2",
                            "grammar": "tuple-diff"
                        }
                    }
                }
            ]
        }"#;
        let remote: RemoteManifest = serde_json::from_str(json).unwrap();
        assert_eq!(remote.schema_version, Some(2));
        assert!(remote.models[0].base.is_some());
        assert!(remote.models[0].capabilities.is_some());

        let list = build_catalog_from_remote(&remote);
        let lite = list.iter().find(|m| m.id == LITE_MODEL_ID).unwrap();
        assert_eq!(lite.version, "v1.2.0");
        assert_eq!(lite.filename, "lite-base-qwen3-0.6b-v1.2.0-Q4_K_M.gguf");
        assert_eq!(
            lite.sha256,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
        assert_eq!(lite.display_name, "Lite (0.6B)");
        assert_eq!(lite.description, "轻量极速版");
    }

    #[test]
    fn version_normalization_detects_updates() {
        assert_eq!(normalize_version("v1.0.0"), "1.0.0");
        assert_eq!(normalize_version("1.0.0"), "1.0.0");
        assert_ne!(normalize_version("v1.0.0"), normalize_version("v1.1.0"));
    }

    #[test]
    fn legacy_v100_installed_model_marked_available_with_update() {
        let manifest = default_standard_model();
        let status = build_status(
            &manifest,
            "available",
            985_711_904,
            985_711_904,
            Some(PathBuf::from("/tmp/model.gguf")),
            Some("v1.0.0".to_string()),
            None,
        );
        assert_eq!(status.status, "available");
        assert_eq!(status.version, Some("v1.0.0".to_string()));
        assert_eq!(status.latest_version, "v1.1.0");
        assert!(status.has_update);
    }
}
