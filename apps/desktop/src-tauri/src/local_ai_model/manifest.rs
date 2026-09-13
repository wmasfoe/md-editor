//! # Local AI Model Manifests
//!
//! 定义本地 AI 模型的规格模型、内置模型清单、远程 manifest 动态拉取与解析。

use crate::process_utils::silent_command;
use crate::settings;
use std::{collections::BTreeMap, fs, path::PathBuf};

pub(crate) const DEFAULT_MODEL_ID: &str = "md-editor-writer-standard";
pub(crate) const LEGACY_MODEL_ID: &str = "md-editor-writer-small-v1";
pub(crate) const LITE_MODEL_ID: &str = "md-editor-writer-lite";
pub(crate) const STANDARD_MODEL_ID: &str = "md-editor-writer-standard";
pub(crate) const PRO_MODEL_ID: &str = "md-editor-writer-pro";

/// 单个模型或 LoRA 权重组件的文件规格。
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LocalAiFileSpec {
    pub(crate) filename: String,
    pub(crate) download_url: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
}

/// 本地 AI 模型的完整技术规格清单。
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
    /// 计算包含 Base 模型与所有 LoRA Adapter 的总下载体积。
    pub(crate) fn total_download_bytes(&self) -> u64 {
        self.size_bytes + self.adapters.iter().map(|(_, a)| a.size_bytes).sum::<u64>()
    }

    /// 获取全部待下载组件的标签与文件规格集合。
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

/// 内置轻量级 Lite 模型（Qwen3 0.6B + 专用任务 LoRA）。
pub(crate) fn default_lite_model() -> LocalAiModelManifest {
    LocalAiModelManifest {
        id: LITE_MODEL_ID.to_string(),
        display_name: "Lite (0.6B)".to_string(),
        description: "Qwen3 架构任务专用 LoRA 矩阵（纠错 / 续写 / 提炼），极速轻量。".to_string(),
        version: "v1.3.1".to_string(),
        filename: "lite-base-qwen3-0.6b-v1.3.1-Q8_0.gguf".to_string(),
        download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.1/lite-base-qwen3-0.6b-v1.3.1-Q8_0.gguf".to_string(),
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
                    filename: "lite-gec-qwen3-0.6b-v1.3.1-lora-f16.gguf".to_string(),
                    download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.1/lite-gec-qwen3-0.6b-v1.3.1-lora-f16.gguf".to_string(),
                    size_bytes: 40_397_472,
                    sha256: "0547dcf4e629e6747c4a7ef9bef485562de83590543bf459aff25ee379fc331a".to_string(),
                },
            ),
            (
                "completion".to_string(),
                LocalAiFileSpec {
                    filename: "lite-completion-qwen3-0.6b-v1.3.1-lora-f16.gguf".to_string(),
                    download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.1/lite-completion-qwen3-0.6b-v1.3.1-lora-f16.gguf".to_string(),
                    size_bytes: 40_397_472,
                    sha256: "aa6e806b1ad802d8d3a1dacd382826891e76810cf5e9eff85f1472919e8ec7a8".to_string(),
                },
            ),
            (
                "distill".to_string(),
                LocalAiFileSpec {
                    filename: "lite-distill-qwen3-0.6b-v1.3.1-lora-f16.gguf".to_string(),
                    download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.1/lite-distill-qwen3-0.6b-v1.3.1-lora-f16.gguf".to_string(),
                    size_bytes: 40_397_472,
                    sha256: "347e34a26df1bd11f23d0d1afc8e292efcbeb51c2782f393a22ae29bac970b09".to_string(),
                },
            ),
        ],
    }
}

/// 内置标准级 Standard 模型（Qwen3 1.7B + 专用任务 LoRA）。
pub(crate) fn default_standard_model() -> LocalAiModelManifest {
    LocalAiModelManifest {
        id: STANDARD_MODEL_ID.to_string(),
        display_name: "Standard (1.7B)".to_string(),
        description: "Qwen3 进阶版，搭载语法纠错、行内续写与长文提炼三大任务专用 LoRA，能力全面。".to_string(),
        version: "v1.3.1".to_string(),
        filename: "standard-base-qwen3-1.7b-v1.3.1-Q8_0.gguf".to_string(),
        download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.1/standard-base-qwen3-1.7b-v1.3.1-Q8_0.gguf".to_string(),
        size_bytes: 1_834_426_016,
        sha256: "061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a".to_string(),
        context_size: 8192,
        default_max_tokens: 260,
        is_available: true,
        is_recommended: false,
        adapters: vec![
            (
                "gec".to_string(),
                LocalAiFileSpec {
                    filename: "standard-gec-qwen3-1.7b-v1.3.1-lora-f16.gguf".to_string(),
                    download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.1/standard-gec-qwen3-1.7b-v1.3.1-lora-f16.gguf".to_string(),
                    size_bytes: 69_757_600,
                    sha256: "06acb8e8bc92c19e84c02fa36ac19c282f58d4bb3a0262ce361914aa219e91db".to_string(),
                },
            ),
            (
                "completion".to_string(),
                LocalAiFileSpec {
                    filename: "standard-completion-qwen3-1.7b-v1.3.1-lora-f16.gguf".to_string(),
                    download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.1/standard-completion-qwen3-1.7b-v1.3.1-lora-f16.gguf".to_string(),
                    size_bytes: 69_757_600,
                    sha256: "f8391f9b4e01ede76fc2f74e502996bde31445ec799cd3a24683d4b7b5241ac2".to_string(),
                },
            ),
            (
                "distill".to_string(),
                LocalAiFileSpec {
                    filename: "standard-distill-qwen3-1.7b-v1.3.1-lora-f16.gguf".to_string(),
                    download_url: "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.1/standard-distill-qwen3-1.7b-v1.3.1-lora-f16.gguf".to_string(),
                    size_bytes: 69_757_600,
                    sha256: "7da6e7770360238508f7ac0d6aba03787ec9f0b5439644a0d86f064287f5af88".to_string(),
                },
            ),
        ],
    }
}

/// 内置旗舰级 Pro 模型占位声明。
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

/// 获取全套内置默认模型规格列表。
pub(crate) fn default_manifests() -> Vec<LocalAiModelManifest> {
    vec![
        default_lite_model(),
        default_standard_model(),
        default_pro_model(),
    ]
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteModelAsset {
    pub(crate) version: Option<String>,
    pub(crate) filename: Option<String>,
    pub(crate) size_bytes: Option<u64>,
    pub(crate) sha256: Option<String>,
    pub(crate) download_url: Option<String>,
    pub(crate) quant: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteModelCapability {
    #[serde(flatten)]
    pub(crate) asset: RemoteModelAsset,
    pub(crate) adapter_id: Option<String>,
    pub(crate) task: Option<String>,
    pub(crate) base_model_id: Option<String>,
    pub(crate) base_model_version: Option<String>,
    pub(crate) base_sha256: Option<String>,
    pub(crate) prompt_protocol: Option<String>,
    pub(crate) grammar: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteModelEntry {
    pub(crate) model_id: Option<String>,
    pub(crate) tier: Option<String>,
    pub(crate) display_name: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) is_available: Option<bool>,
    pub(crate) recommended: Option<bool>,
    pub(crate) filename: Option<String>,
    pub(crate) size_bytes: Option<u64>,
    pub(crate) sha256: Option<String>,
    pub(crate) download_url: Option<String>,
    pub(crate) base: Option<RemoteModelAsset>,
    pub(crate) capabilities: Option<BTreeMap<String, RemoteModelCapability>>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteManifest {
    pub(crate) schema_version: Option<u32>,
    pub(crate) version: String,
    pub(crate) models: Vec<RemoteModelEntry>,
    pub(crate) context_size: Option<u32>,
}

pub(crate) fn remote_manifest_cache_path() -> Result<PathBuf, String> {
    let data_dir =
        settings::app_data_dir().ok_or_else(|| "Cannot resolve app data directory".to_string())?;
    Ok(data_dir
        .join("ai")
        .join("models")
        .join("remote_manifest.json"))
}

pub(crate) fn load_cached_remote_manifest() -> Option<RemoteManifest> {
    let path = remote_manifest_cache_path().ok()?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<RemoteManifest>(&content).ok()
}

pub(crate) fn save_cached_remote_manifest(manifest: &RemoteManifest) -> Result<(), String> {
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

/// 尝试从远端 GitHub Release 及备用源拉取最新的模型配置清单。
pub(crate) fn fetch_remote_manifest() -> Result<RemoteManifest, String> {
    let urls = [
        "https://github.com/wmasfoe/md-editor-models/releases/latest/download/manifest.json",
        "https://github.com/wmasfoe/md-editor-models/releases/download/v1.3.1/manifest.json",
        "https://raw.githubusercontent.com/wmasfoe/md-editor-models/master/manifest.json",
        "https://raw.githubusercontent.com/wmasfoe/md-editor-models/main/manifest.json",
    ];

    for url in urls {
        let output = silent_command("curl")
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

pub(crate) fn normalize_remote_version(version: &str) -> String {
    if version.starts_with('v') || version.starts_with('V') {
        version.to_string()
    } else {
        format!("v{version}")
    }
}

pub(crate) fn resolve_logical_model_id(
    tier: Option<&str>,
    model_id: Option<&str>,
) -> Option<&'static str> {
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

pub(crate) fn entry_primary_asset(entry: &RemoteModelEntry) -> RemoteModelAsset {
    entry.base.clone().unwrap_or(RemoteModelAsset {
        version: None,
        filename: entry.filename.clone(),
        size_bytes: entry.size_bytes,
        sha256: entry.sha256.clone(),
        download_url: entry.download_url.clone(),
        quant: None,
    })
}

pub(crate) fn canonical_description_for_tier(logical_id: &str) -> String {
    match logical_id {
        LITE_MODEL_ID => {
            "Qwen3 架构任务专用 LoRA 矩阵（纠错 / 续写 / 提炼），极速轻量。".to_string()
        }
        STANDARD_MODEL_ID => {
            "Qwen3 进阶版，搭载语法纠错、行内续写与长文提炼三大任务专用 LoRA，能力全面。"
                .to_string()
        }
        PRO_MODEL_ID => "旗舰级深度长文创作、论文润色与逻辑重构（敬请期待）。".to_string(),
        _ => String::new(),
    }
}

pub(crate) fn sanitize_model_description(logical_id: &str, raw_desc: Option<&str>) -> String {
    let fallback = canonical_description_for_tier(logical_id);
    let Some(desc) = raw_desc else {
        return fallback;
    };
    let trimmed = desc.trim();
    if trimmed.is_empty() || trimmed.contains("任务专用 LoRA") || trimmed.contains("LoRA Adapter")
    {
        return fallback;
    }
    trimmed.to_string()
}

pub(crate) fn build_catalog_from_remote(remote: &RemoteManifest) -> Vec<LocalAiModelManifest> {
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

        let description = sanitize_model_description(logical_id, entry.description.as_deref());

        if let Some(existing) = catalog.iter_mut().find(|m| m.id == logical_id) {
            existing.version = remote_version.clone();
            existing.display_name = entry
                .display_name
                .clone()
                .unwrap_or_else(|| existing.display_name.clone());
            existing.description = description;
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
            description,
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
