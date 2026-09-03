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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LocalAiFileSpec {
    pub(crate) filename: String,
    pub(crate) download_url: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
}

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
    pub(crate) adapters: Vec<(String, LocalAiFileSpec)>,
}

impl LocalAiModelManifest {
    pub(crate) fn total_download_bytes(&self) -> u64 {
        self.size_bytes + self.adapters.iter().map(|(_, a)| a.size_bytes).sum::<u64>()
    }

    pub(crate) fn all_download_specs(&self) -> Vec<(String, LocalAiFileSpec)> {
        let mut specs = Vec::new();
        if !self.download_url.is_empty() {
            let base_tag = if self.adapters.is_empty() {
                "model"
            } else {
                "base"
            };
            specs.push((
                base_tag.to_string(),
                LocalAiFileSpec {
                    filename: self.filename.clone(),
                    download_url: self.download_url.clone(),
                    size_bytes: self.size_bytes,
                    sha256: self.sha256.clone(),
                },
            ));
        }
        for (task, adapter) in &self.adapters {
            specs.push((task.clone(), adapter.clone()));
        }
        specs
    }
}

pub(crate) fn default_lite_model() -> LocalAiModelManifest {
    LocalAiModelManifest {
        id: LITE_MODEL_ID.to_string(),
        display_name: "Lite (0.6B)".to_string(),
        description: "Qwen3 架构任务专用 LoRA 矩阵（纠错 / 续写 / 提炼），极速轻量。".to_string(),
        version: "v1.3.0".to_string(),
        filename: "lite-base-qwen3-0.6b-v1.3.0-Q8_0.gguf".to_string(),
        download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/lite-base-qwen3-0.6b-v1.3.0-Q8_0.gguf".to_string(),
        size_bytes: 639_446_688,
        sha256: "9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031".to_string(),
        context_size: 8192,
        default_max_tokens: 220,
        is_available: true,
        is_recommended: true,
        adapters: vec![
            (
                "gec".to_string(),
                LocalAiFileSpec {
                    filename: "lite-gec-qwen3-0.6b-v1.3.0-lora-f16.gguf".to_string(),
                    download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/lite-gec-qwen3-0.6b-v1.3.0-lora-f16.gguf".to_string(),
                    size_bytes: 40_397_472,
                    sha256: "c3ef5140e7da7cb2f70d0bec65e3116d715683532cec7f5ab6f1e702f581d473".to_string(),
                },
            ),
            (
                "completion".to_string(),
                LocalAiFileSpec {
                    filename: "lite-completion-qwen3-0.6b-v1.3.0-lora-f16.gguf".to_string(),
                    download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/lite-completion-qwen3-0.6b-v1.3.0-lora-f16.gguf".to_string(),
                    size_bytes: 40_397_472,
                    sha256: "eaef8dc00b5220c8f5379b1df0975618f0376d8b0222a768f59d57a2d744f4bf".to_string(),
                },
            ),
            (
                "distill".to_string(),
                LocalAiFileSpec {
                    filename: "lite-distill-qwen3-0.6b-v1.3.0-lora-f16.gguf".to_string(),
                    download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/lite-distill-qwen3-0.6b-v1.3.0-lora-f16.gguf".to_string(),
                    size_bytes: 40_397_472,
                    sha256: "b0068a529b5521db331771fe6ba292881cf69c57d76ee1fa1a113bc70fe5a5ae".to_string(),
                },
            ),
        ],
    }
}

pub(crate) fn default_standard_model() -> LocalAiModelManifest {
    LocalAiModelManifest {
        id: STANDARD_MODEL_ID.to_string(),
        display_name: "Standard (1.7B)".to_string(),
        description: "Qwen3 进阶版，搭载语法纠错、行内续写与长文提炼三大任务专用 LoRA，能力全面。".to_string(),
        version: "v1.3.0".to_string(),
        filename: "standard-base-qwen3-1.7b-v1.3.0-Q8_0.gguf".to_string(),
        download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/standard-base-qwen3-1.7b-v1.3.0-Q8_0.gguf".to_string(),
        size_bytes: 1_832_684_160,
        sha256: "8e860bc00f2eef8e5d3fc39c87849e7b4618fbbe868be5a07cb15591cbe65c19".to_string(),
        context_size: 8192,
        default_max_tokens: 260,
        is_available: true,
        is_recommended: false,
        adapters: vec![
            (
                "gec".to_string(),
                LocalAiFileSpec {
                    filename: "standard-gec-qwen3-1.7b-v1.3.0-lora-f16.gguf".to_string(),
                    download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/standard-gec-qwen3-1.7b-v1.3.0-lora-f16.gguf".to_string(),
                    size_bytes: 70_338_218,
                    sha256: "5d0137ff71f654b455097bc87ddfa6351b668f44ff53e5e49f874c7cf6551b80".to_string(),
                },
            ),
            (
                "completion".to_string(),
                LocalAiFileSpec {
                    filename: "standard-completion-qwen3-1.7b-v1.3.0-lora-f16.gguf".to_string(),
                    download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/standard-completion-qwen3-1.7b-v1.3.0-lora-f16.gguf".to_string(),
                    size_bytes: 70_338_218,
                    sha256: "1e1493cf032a843bb5c5970c91dc572bc8cb3f7fb359c19ea2b54bc360f06830".to_string(),
                },
            ),
            (
                "distill".to_string(),
                LocalAiFileSpec {
                    filename: "standard-distill-qwen3-1.7b-v1.3.0-lora-f16.gguf".to_string(),
                    download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.0/standard-distill-qwen3-1.7b-v1.3.0-lora-f16.gguf".to_string(),
                    size_bytes: 70_338_218,
                    sha256: "5251a37c569f4cb02c9a96e9ae1064ff3f25d97f26742b6a22fdfc4375b4f620".to_string(),
                },
            ),
        ],
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
        adapters: Vec::new(),
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

        let mut adapters = Vec::new();
        if let Some(caps) = &entry.capabilities {
            for (task, cap) in caps {
                if let (Some(fn_name), Some(url)) = (&cap.asset.filename, &cap.asset.download_url) {
                    adapters.push((
                        task.clone(),
                        LocalAiFileSpec {
                            filename: fn_name.clone(),
                            download_url: url.clone(),
                            size_bytes: cap.asset.size_bytes.unwrap_or(0),
                            sha256: cap.asset.sha256.clone().unwrap_or_default(),
                        },
                    ));
                }
            }
        }

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
            if !adapters.is_empty() {
                existing.adapters = adapters;
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
            adapters,
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
    for m in &all {
        if m.id.as_str() == target
            || (target == LEGACY_MODEL_ID && m.id == LITE_MODEL_ID)
            || (target == "qwen2.5-0.5b-editor" && m.id == LITE_MODEL_ID)
            || (target == "qwen2.5-1.5b-editor" && m.id == STANDARD_MODEL_ID)
        {
            return Ok(m.clone());
        }
    }
    for m in default_manifests() {
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
///
/// 当前 Runtime 尚未启动 `llama-server --lora`；待 v2 资产发布后由 Runtime 调用。
#[expect(
    dead_code,
    reason = "等待 v2 Adapter Release 后接入 llama-server --lora Runtime"
)]
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

#[allow(dead_code)]
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
        assert_eq!(status.latest_version, "v1.3.0");
        assert!(status.has_update);
    }
}
