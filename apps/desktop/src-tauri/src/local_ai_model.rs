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

const DOWNLOAD_TEMP_FILE_NAME: &str = "download.tmp";

const DOWNLOAD_CANCEL_FILE_NAME: &str = "download.cancel";
const LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE: &str = "本地模型下载已取消。";

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAiFileSpec {
    pub(crate) filename: String,
    pub(crate) download_url: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LocalAiModelManifest {
    pub(crate) id: &'static str,
    pub(crate) tier: &'static str,
    pub(crate) display_name: &'static str,
    pub(crate) version: String,
    pub(crate) context_size: u32,
    pub(crate) default_max_tokens: u16,
    pub(crate) is_available: bool,
    pub(crate) base_file: LocalAiFileSpec,
    pub(crate) gec_adapter: Option<LocalAiFileSpec>,
    pub(crate) completion_adapter: Option<LocalAiFileSpec>,
    pub(crate) distill_adapter: Option<LocalAiFileSpec>,
    pub(crate) legacy_single_file: Option<LocalAiFileSpec>,
}

impl LocalAiModelManifest {
    pub(crate) fn total_download_bytes(&self) -> u64 {
        if let Some(single) = &self.legacy_single_file {
            return single.size_bytes;
        }
        let mut total = self.base_file.size_bytes;
        if let Some(gec) = &self.gec_adapter {
            total += gec.size_bytes;
        }
        if let Some(comp) = &self.completion_adapter {
            total += comp.size_bytes;
        }
        if let Some(dist) = &self.distill_adapter {
            total += dist.size_bytes;
        }
        total
    }

    pub(crate) fn all_download_specs(&self) -> Vec<(&'static str, &LocalAiFileSpec)> {
        if let Some(single) = &self.legacy_single_file {
            return vec![("model", single)];
        }
        let mut list = Vec::new();
        if !self.base_file.download_url.is_empty() {
            list.push(("base", &self.base_file));
        }
        if let Some(gec) = &self.gec_adapter {
            if !gec.download_url.is_empty() {
                list.push(("gec", gec));
            }
        }
        if let Some(comp) = &self.completion_adapter {
            if !comp.download_url.is_empty() {
                list.push(("completion", comp));
            }
        }
        if let Some(dist) = &self.distill_adapter {
            if !dist.download_url.is_empty() {
                list.push(("distill", dist));
            }
        }
        list
    }
}

pub(crate) fn default_lite_model() -> LocalAiModelManifest {
    LocalAiModelManifest {
        id: LITE_MODEL_ID,
        tier: "lite",
        display_name: "Lite (0.6B)",
        version: "v1.3.0".to_string(),
        context_size: 8192,
        default_max_tokens: 220,
        is_available: true,
        base_file: LocalAiFileSpec {
            filename: "lite-base-qwen3-0.6b-v1.3.0-Q8_0.gguf".to_string(),
            download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/lite-base-qwen3-0.6b-v1.3.0-Q8_0.gguf".to_string(),
            size_bytes: 639_446_688,
            sha256: "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031".to_string(),
        },
        gec_adapter: Some(LocalAiFileSpec {
            filename: "lite-gec-qwen3-0.6b-v1.3.0-lora-f16.gguf".to_string(),
            download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/lite-gec-qwen3-0.6b-v1.3.0-lora-f16.gguf".to_string(),
            size_bytes: 40_397_472,
            sha256: "c3ef5140e7da7cb2f70d0bec65e3116d715683532cec7f5ab6f1e702f581d473".to_string(),
        }),
        completion_adapter: Some(LocalAiFileSpec {
            filename: "lite-completion-qwen3-0.6b-v1.3.0-lora-f16.gguf".to_string(),
            download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/lite-completion-qwen3-0.6b-v1.3.0-lora-f16.gguf".to_string(),
            size_bytes: 40_397_472,
            sha256: "0a979b9bf9e29e6d75f5f99e2f3e2e54026114c2ed902f4ea30349c18819c597".to_string(),
        }),
        distill_adapter: Some(LocalAiFileSpec {
            filename: "lite-distill-qwen3-0.6b-v1.3.0-lora-f16.gguf".to_string(),
            download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/lite-distill-qwen3-0.6b-v1.3.0-lora-f16.gguf".to_string(),
            size_bytes: 40_397_472,
            sha256: "e75bcbd1ebed0c374d78f3873896bb9d7b0f1a7d82cc56e130f98130c6a174bc".to_string(),
        }),
        legacy_single_file: None,
    }
}

pub(crate) fn default_standard_model() -> LocalAiModelManifest {
    LocalAiModelManifest {
        id: STANDARD_MODEL_ID,
        tier: "standard",
        display_name: "Standard (1.7B)",
        version: "v1.3.0".to_string(),
        context_size: 8192,
        default_max_tokens: 260,
        is_available: true,
        base_file: LocalAiFileSpec {
            filename: "standard-base-qwen3-1.7b-v1.3.0-Q8_0.gguf".to_string(),
            download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/standard-base-qwen3-1.7b-v1.3.0-Q8_0.gguf".to_string(),
            size_bytes: 1_834_426_016,
            sha256: "061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a".to_string(),
        },
        gec_adapter: Some(LocalAiFileSpec {
            filename: "standard-gec-qwen3-1.7b-v1.3.0-lora-f16.gguf".to_string(),
            download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/standard-gec-qwen3-1.7b-v1.3.0-lora-f16.gguf".to_string(),
            size_bytes: 69_757_600,
            sha256: "f82b6d88ebcbabbbe0432dea7c3064b185fe01f4e88e3d1ac6c21d3902c36d99".to_string(),
        }),
        completion_adapter: Some(LocalAiFileSpec {
            filename: "standard-completion-qwen3-1.7b-v1.3.0-lora-f16.gguf".to_string(),
            download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/standard-completion-qwen3-1.7b-v1.3.0-lora-f16.gguf".to_string(),
            size_bytes: 69_757_600,
            sha256: "3bdd9f52575f03bd6b1b04223e03749a0f5392b540566374005f98c50e326f25".to_string(),
        }),
        distill_adapter: Some(LocalAiFileSpec {
            filename: "standard-distill-qwen3-1.7b-v1.3.0-lora-f16.gguf".to_string(),
            download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/standard-distill-qwen3-1.7b-v1.3.0-lora-f16.gguf".to_string(),
            size_bytes: 69_757_600,
            sha256: "66f53ddf8261c99c9f52734da5bdc0bbfe8535b07f318466ed246888ce0ec8c1".to_string(),
        }),
        legacy_single_file: None,
    }
}

pub(crate) fn default_pro_model() -> LocalAiModelManifest {
    LocalAiModelManifest {
        id: PRO_MODEL_ID,
        tier: "pro",
        display_name: "Pro",
        version: "v0.0.0-beta".to_string(),
        context_size: 8192,
        default_max_tokens: 400,
        is_available: false,
        base_file: LocalAiFileSpec {
            filename: String::new(),
            download_url: String::new(),
            size_bytes: 0,
            sha256: String::new(),
        },
        gec_adapter: None,
        completion_adapter: None,
        distill_adapter: None,
        legacy_single_file: None,
    }
}

pub(crate) fn default_manifests() -> Vec<LocalAiModelManifest> {
    vec![
        default_lite_model(),
        default_standard_model(),
        default_pro_model(),
    ]
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteModelCapability {
    version: Option<String>,
    filename: Option<String>,
    size_bytes: Option<u64>,
    sha256: Option<String>,
    download_url: Option<String>,
    quant: Option<String>,
    adapter_id: Option<String>,
    task: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteModelBase {
    version: Option<String>,
    filename: Option<String>,
    size_bytes: Option<u64>,
    sha256: Option<String>,
    download_url: Option<String>,
    quant: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteModelEntry {
    model_id: Option<String>,
    tier: Option<String>,
    display_name: Option<String>,
    description: Option<String>,
    recommended: Option<bool>,
    is_available: Option<bool>,
    // Schema v2 字段
    base: Option<RemoteModelBase>,
    capabilities: Option<std::collections::HashMap<String, RemoteModelCapability>>,
    // Schema v1 兼容字段
    filename: Option<String>,
    size_bytes: Option<u64>,
    sha256: Option<String>,
    download_url: Option<String>,
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
    let urls = [
        "https://raw.githubusercontent.com/wmasfoe/md-editor-models/main/manifest.json",
        "https://github.com/wmasfoe/md-editor-models/releases/latest/download/manifest.json",
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

fn apply_remote_manifest_to_list(manifests: &mut [LocalAiModelManifest], remote: &RemoteManifest) {
    let remote_version = if remote.version.starts_with('v') || remote.version.starts_with('V') {
        remote.version.clone()
    } else {
        format!("v{}", remote.version)
    };

    for model_entry in &remote.models {
        for manifest in manifests.iter_mut() {
            let matches_tier = model_entry.tier.as_deref().is_some_and(|tier| {
                (tier == "lite" && manifest.id == LITE_MODEL_ID)
                    || (tier == "standard" && manifest.id == STANDARD_MODEL_ID)
                    || (tier == "pro" && manifest.id == PRO_MODEL_ID)
            });
            let matches_id = model_entry.model_id.as_deref().is_some_and(|id| {
                id == manifest.id
                    || (id == "qwen2.5-0.5b-editor" && manifest.id == LITE_MODEL_ID)
                    || (id == "qwen2.5-1.5b-editor" && manifest.id == STANDARD_MODEL_ID)
            });

            if matches_tier || matches_id {
                manifest.version = remote_version.clone();
                if let Some(ctx) = remote.context_size {
                    if ctx > 0 {
                        manifest.context_size = ctx;
                    }
                }

                // 1. Schema v2 格式处理
                if let Some(base) = &model_entry.base {
                    if let Some(url) = &base.download_url {
                        manifest.base_file.download_url = url.clone();
                    }
                    if let Some(filename) = &base.filename {
                        manifest.base_file.filename = filename.clone();
                    }
                    if let Some(size) = base.size_bytes {
                        manifest.base_file.size_bytes = size;
                    }
                    if let Some(sha) = &base.sha256 {
                        manifest.base_file.sha256 = sha.clone();
                    }

                    if let Some(caps) = &model_entry.capabilities {
                        if let Some(gec) = caps.get("gec") {
                            manifest.gec_adapter = Some(LocalAiFileSpec {
                                filename: gec.filename.clone().unwrap_or_default(),
                                download_url: gec.download_url.clone().unwrap_or_default(),
                                size_bytes: gec.size_bytes.unwrap_or_default(),
                                sha256: gec.sha256.clone().unwrap_or_default(),
                            });
                        }
                        if let Some(comp) = caps.get("completion") {
                            manifest.completion_adapter = Some(LocalAiFileSpec {
                                filename: comp.filename.clone().unwrap_or_default(),
                                download_url: comp.download_url.clone().unwrap_or_default(),
                                size_bytes: comp.size_bytes.unwrap_or_default(),
                                sha256: comp.sha256.clone().unwrap_or_default(),
                            });
                        }
                        if let Some(dist) = caps.get("distill") {
                            manifest.distill_adapter = Some(LocalAiFileSpec {
                                filename: dist.filename.clone().unwrap_or_default(),
                                download_url: dist.download_url.clone().unwrap_or_default(),
                                size_bytes: dist.size_bytes.unwrap_or_default(),
                                sha256: dist.sha256.clone().unwrap_or_default(),
                            });
                        }
                    }
                    manifest.legacy_single_file = None;
                } else if let Some(url) = &model_entry.download_url {
                    // 2. Schema v1 兼容格式
                    manifest.legacy_single_file = Some(LocalAiFileSpec {
                        filename: model_entry
                            .filename
                            .clone()
                            .unwrap_or_else(|| "model.gguf".to_string()),
                        download_url: url.clone(),
                        size_bytes: model_entry.size_bytes.unwrap_or(0),
                        sha256: model_entry.sha256.clone().unwrap_or_default(),
                    });
                }
            }
        }
    }
}

pub(crate) fn resolve_all_manifests() -> Vec<LocalAiModelManifest> {
    let mut manifests = default_manifests();
    if let Some(remote) = load_cached_remote_manifest() {
        apply_remote_manifest_to_list(&mut manifests, &remote);
    }
    manifests
}

pub(crate) fn resolve_manifest(model_id: Option<&str>) -> Result<LocalAiModelManifest, String> {
    let target = model_id.unwrap_or(DEFAULT_MODEL_ID);
    let all = resolve_all_manifests();
    for m in all {
        if m.id == target
            || (target == LEGACY_MODEL_ID && m.id == LITE_MODEL_ID)
            || (target == "qwen2.5-0.5b-editor" && m.id == LITE_MODEL_ID)
            || (target == "qwen2.5-1.5b-editor" && m.id == STANDARD_MODEL_ID)
        {
            return Ok(m);
        }
    }
    Err(format!("未知的本地模型：{target}"))
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalAiModelStatus {
    pub(crate) model_id: String,
    pub(crate) display_name: String,
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
    pub(crate) base_path: PathBuf,
    pub(crate) gec_adapter_path: Option<PathBuf>,
    pub(crate) completion_adapter_path: Option<PathBuf>,
    pub(crate) distill_adapter_path: Option<PathBuf>,
    pub(crate) context_size: u32,
    pub(crate) default_max_tokens: u16,
}

#[derive(Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct PersistedLocalAiModelManifest {
    id: String,
    display_name: String,
    version: String,
    #[serde(default)]
    base_filename: Option<String>,
    #[serde(default)]
    base_sha256: Option<String>,
    #[serde(default)]
    gec_filename: Option<String>,
    #[serde(default)]
    gec_sha256: Option<String>,
    #[serde(default)]
    completion_filename: Option<String>,
    #[serde(default)]
    completion_sha256: Option<String>,
    #[serde(default)]
    distill_filename: Option<String>,
    #[serde(default)]
    distill_sha256: Option<String>,
    #[serde(default)]
    total_size_bytes: u64,
    #[serde(default)]
    filename: Option<String>,
    #[serde(default)]
    size_bytes: Option<u64>,
    #[serde(default)]
    sha256: Option<String>,
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
            let mut manifests = default_manifests();
            apply_remote_manifest_to_list(&mut manifests, &remote);
            Ok(manifests.iter().map(read_model_status).collect())
        }
        _ => get_all_local_ai_models_status(),
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
    let staging_dir = directory.join("staging.tmp");
    let _ = fs::write(&cancel_path, b"cancel");
    let _ = fs::remove_file(&temp_path);
    let _ = fs::remove_dir_all(&staging_dir);

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

    if let Ok(mut manager) = runtime.manager().lock() {
        manager.stop_runtime_if_model(manifest.id);
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

async fn download_model(
    app: &AppHandle,
    manifest: &LocalAiModelManifest,
) -> Result<LocalAiModelStatus, String> {
    let specs = manifest.all_download_specs();
    if specs.is_empty() || specs.iter().any(|(_, s)| s.download_url.trim().is_empty()) {
        return Err("本地模型下载源尚未配置。".to_string());
    }

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

    let total_bytes = manifest.total_download_bytes();
    let mut accumulated_bytes: u64 = 0;

    emit_status(
        app,
        build_status(manifest, "downloading", 0, total_bytes, None, None, None),
    );

    for (tag, spec) in specs {
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
                    total_bytes,
                    None,
                    None,
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
                    total_bytes,
                    None,
                    None,
                    None,
                ),
            );
            let actual_sha = compute_sha256_hex(&temp_file_path)?;
            if actual_sha.to_ascii_lowercase() != spec.sha256.to_ascii_lowercase() {
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

    if cancel_path.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
        let _ = fs::remove_file(&cancel_path);
        let status = read_model_status(manifest);
        emit_status(app, status.clone());
        return Err(LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE.to_string());
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

fn write_model_metadata(manifest: &LocalAiModelManifest) -> Result<(), String> {
    let directory = model_directory(manifest)?;
    let metadata = PersistedLocalAiModelManifest {
        id: manifest.id.to_string(),
        display_name: manifest.display_name.to_string(),
        version: manifest.version.clone(),
        base_filename: Some("base.gguf".to_string()),
        base_sha256: Some(manifest.base_file.sha256.clone()),
        gec_filename: manifest
            .gec_adapter
            .as_ref()
            .map(|_| "gec.gguf".to_string()),
        gec_sha256: manifest.gec_adapter.as_ref().map(|a| a.sha256.clone()),
        completion_filename: manifest
            .completion_adapter
            .as_ref()
            .map(|_| "completion.gguf".to_string()),
        completion_sha256: manifest
            .completion_adapter
            .as_ref()
            .map(|a| a.sha256.clone()),
        distill_filename: manifest
            .distill_adapter
            .as_ref()
            .map(|_| "distill.gguf".to_string()),
        distill_sha256: manifest.distill_adapter.as_ref().map(|a| a.sha256.clone()),
        total_size_bytes: manifest.total_download_bytes(),
        filename: manifest
            .legacy_single_file
            .as_ref()
            .map(|s| s.filename.clone()),
        size_bytes: manifest.legacy_single_file.as_ref().map(|s| s.size_bytes),
        sha256: manifest
            .legacy_single_file
            .as_ref()
            .map(|s| s.sha256.clone()),
    };
    let manifest_json = serde_json::to_string_pretty(&metadata)
        .map_err(|error| format!("Failed to serialize local AI model manifest: {error}"))?;
    fs::write(directory.join("manifest.json"), manifest_json)
        .map_err(|error| format!("Failed to write local AI model manifest: {error}"))?;
    Ok(())
}

fn normalize_version(v: &str) -> &str {
    v.trim().trim_start_matches('v').trim_start_matches('V')
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
        model_id: manifest.id.to_string(),
        display_name: manifest.display_name.to_string(),
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

fn model_directory(manifest: &LocalAiModelManifest) -> Result<PathBuf, String> {
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
    fn resolves_builtin_models() {
        assert_eq!(
            resolve_manifest(Some(LITE_MODEL_ID)).unwrap().id,
            LITE_MODEL_ID
        );
        assert_eq!(
            resolve_manifest(Some(STANDARD_MODEL_ID)).unwrap().id,
            STANDARD_MODEL_ID
        );
        assert_eq!(
            resolve_manifest(Some(PRO_MODEL_ID)).unwrap().id,
            PRO_MODEL_ID
        );
        assert_eq!(
            resolve_manifest(Some(LEGACY_MODEL_ID)).unwrap().id,
            LITE_MODEL_ID
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
    fn parses_and_applies_remote_manifest_v1() {
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
        let mut list = default_manifests();
        apply_remote_manifest_to_list(&mut list, &remote);
        let lite = list.iter().find(|m| m.id == LITE_MODEL_ID).unwrap();
        assert_eq!(lite.version, "v1.1.0");
        let legacy = lite.legacy_single_file.as_ref().unwrap();
        assert_eq!(legacy.download_url, "https://example.com/lite.gguf");
        assert_eq!(legacy.size_bytes, 397554976);
    }

    #[test]
    fn parses_and_applies_remote_manifest_v2() {
        let json = r#"{
            "schemaVersion": 2,
            "version": "1.3.0",
            "models": [
                {
                    "tier": "lite",
                    "modelId": "md-editor-writer-lite",
                    "base": {
                        "filename": "lite-base-qwen3-0.6b-v1.3.0-Q8_0.gguf",
                        "sizeBytes": 639446688,
                        "sha256": "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031",
                        "downloadUrl": "https://example.com/lite-base.gguf"
                    },
                    "capabilities": {
                        "gec": {
                            "filename": "lite-gec-qwen3-0.6b-v1.3.0-lora-f16.gguf",
                            "sizeBytes": 40397472,
                            "sha256": "c3ef5140e7da7cb2f70d0bec65e3116d715683532cec7f5ab6f1e702f581d473",
                            "downloadUrl": "https://example.com/lite-gec.gguf"
                        }
                    }
                }
            ]
        }"#;
        let remote: RemoteManifest = serde_json::from_str(json).unwrap();
        let mut list = default_manifests();
        apply_remote_manifest_to_list(&mut list, &remote);
        let lite = list.iter().find(|m| m.id == LITE_MODEL_ID).unwrap();
        assert_eq!(lite.version, "v1.3.0");
        assert_eq!(
            lite.base_file.download_url,
            "https://example.com/lite-base.gguf"
        );
        assert_eq!(lite.base_file.size_bytes, 639446688);
        assert_eq!(
            lite.gec_adapter.as_ref().unwrap().filename,
            "lite-gec-qwen3-0.6b-v1.3.0-lora-f16.gguf"
        );
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
        assert_eq!(status.latest_version, "v1.3.0");
        assert!(status.has_update);
    }

    #[test]
    fn reads_currently_installed_model_if_present() {
        if let Ok(model) = get_available_local_ai_model(Some(STANDARD_MODEL_ID)) {
            assert_eq!(model.model_id, STANDARD_MODEL_ID);
            assert!(model.base_path.is_file());
        }
    }
}
