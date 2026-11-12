use std::{fs, path::PathBuf};

use super::{manifest::*, storage::*};

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
    assert_eq!(status.latest_version, "v1.4.0");
    assert!(status.has_update);
}

#[test]
fn sanitizes_corrupted_lora_task_description_to_canonical() {
    assert_eq!(
        sanitize_model_description(STANDARD_MODEL_ID, Some("任务专用 LoRA Adapter（distill）")),
        "高精度专业档：Google Gemma 4 端侧基座，原生推理与长句逻辑极强，无错识别率接近 100%"
    );
    assert_eq!(
        sanitize_model_description(LITE_MODEL_ID, Some("任务专用 LoRA Adapter (gec)")),
        "极速轻量档：内存占用 <300MB，首字延迟 <30ms，适合老旧轻薄本与快速输入"
    );
    assert_eq!(
        sanitize_model_description(STANDARD_MODEL_ID, Some("自定义标准版模型描述")),
        "自定义标准版模型描述"
    );
}

#[test]
fn downloading_status_preserves_current_version_for_updates() {
    let manifest = default_standard_model();
    let status = build_status(
        &manifest,
        "downloading",
        10_000,
        200_000_000,
        None,
        Some("v1.0.0".to_string()),
        None,
    );
    assert_eq!(status.status, "downloading");
    assert_eq!(status.version, Some("v1.0.0".to_string()));
    assert!(status.has_update);
    assert_eq!(status.total_bytes, 200_000_000);

    // 未下载全新安装时，version 为 None，has_update 为 false
    let fresh = build_status(
        &manifest,
        "downloading",
        10_000,
        200_000_000,
        None,
        None,
        None,
    );
    assert_eq!(fresh.version, None);
    assert!(!fresh.has_update);
}

#[test]
fn can_reuse_local_component_checks_sha256_and_size() {
    let temp_dir = std::env::temp_dir().join(format!("md_editor_test_{}", std::process::id()));
    let _ = fs::create_dir_all(&temp_dir);
    let test_file = temp_dir.join("test_base.gguf");
    let content = b"mock gguf model weights content 123456";
    fs::write(&test_file, content).unwrap();

    let sha = compute_sha256_hex(&test_file).unwrap();
    let spec = LocalAiFileSpec {
        filename: "base.gguf".to_string(),
        download_url: "https://example.com/base.gguf".to_string(),
        size_bytes: content.len() as u64,
        sha256: sha.clone(),
    };

    // 1. 命中持久化 manifest SHA 快速通道
    assert!(can_reuse_local_component(&test_file, &spec, Some(&sha)));

    // 2. 命中物理计算 SHA 兜底通道
    assert!(can_reuse_local_component(&test_file, &spec, None));

    // 3. 尺寸不匹配则拒绝复用
    let mut mismatch_size = spec.clone();
    mismatch_size.size_bytes += 1;
    assert!(!can_reuse_local_component(
        &test_file,
        &mismatch_size,
        Some(&sha)
    ));

    // 4. SHA 不匹配则拒绝复用
    let mut mismatch_sha = spec.clone();
    mismatch_sha.sha256 =
        "0000000000000000000000000000000000000000000000000000000000000000".to_string();
    assert!(!can_reuse_local_component(&test_file, &mismatch_sha, None));

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn builtin_and_remote_model_urls_use_inkpoint_editor_repository() {
    const RELEASE_PREFIX: &str = "https://github.com/inkpoint-editor/md-editor-models/";

    // Lite 权重在 GitHub Release 上。清单仍写迁移前的 wmasfoe 地址，
    // 内置条目保存 301 之后的 inkpoint-editor 地址。
    let lite = default_lite_model();
    assert!(
        lite.download_url.starts_with(RELEASE_PREFIX),
        "{}",
        lite.download_url
    );
    assert!(
        !lite.download_url.contains("wmasfoe/"),
        "{}",
        lite.download_url
    );
    for (_, adapter) in &lite.adapters {
        assert!(
            adapter.download_url.starts_with(RELEASE_PREFIX),
            "{}",
            adapter.download_url
        );
        assert!(
            !adapter.download_url.contains("wmasfoe/"),
            "{}",
            adapter.download_url
        );
    }

    // Standard 的 Q8_0 不在该 Release 资产中，下载地址是发布清单里的 Hugging Face URL。
    let standard = default_standard_model();
    assert!(
        standard
            .download_url
            .starts_with("https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/"),
        "{}",
        standard.download_url
    );
    assert!(
        !standard.download_url.contains("wmasfoe/"),
        "{}",
        standard.download_url
    );
    assert!(standard.adapters.is_empty());

    assert!(!REMOTE_MANIFEST_CANDIDATE_URLS.is_empty());
    for url in REMOTE_MANIFEST_CANDIDATE_URLS {
        assert!(
            url.contains("inkpoint-editor/md-editor-models"),
            "{url} must use the canonical model repository"
        );
        assert!(
            !url.contains("wmasfoe/"),
            "{url} must not keep the previous owner"
        );
    }
}

#[test]
fn default_manifests_have_valid_integrity_specs() {
    for manifest in [default_lite_model(), default_standard_model()] {
        assert_eq!(manifest.version, "v1.4.0");
        assert!(manifest.is_available);
        assert!(!manifest.filename.is_empty());
        assert!(manifest.download_url.starts_with("https://"));
        assert_eq!(manifest.sha256.len(), 64);
        assert!(manifest.sha256.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(manifest.size_bytes > 0);

        for (task, adapter) in &manifest.adapters {
            assert!(!task.is_empty());
            assert!(!adapter.filename.is_empty());
            assert!(adapter.download_url.starts_with("https://"));
            assert_eq!(
                adapter.sha256.len(),
                64,
                "Adapter {task} in {} must have 64-char hex SHA256",
                manifest.id
            );
            assert!(
                adapter.sha256.chars().all(|c| c.is_ascii_hexdigit()),
                "Adapter {task} in {} must have valid hex SHA256",
                manifest.id
            );
            assert!(
                adapter.size_bytes > 0,
                "Adapter {task} in {} must have positive size",
                manifest.id
            );
        }
    }
}

#[test]
fn parses_rfc004_v140_manifest_with_zero_lora_standard() {
    let json = r#"{
        "version": "1.4.0",
        "models": [
            {
                "modelId": "md-editor-writer-standard",
                "tier": "standard",
                "displayName": "Standard (Google Gemma 4 E2B)",
                "description": "高精度专业档",
                "base": {
                    "filename": "standard-base-gemma4-e2b-v1.4.0-Q4_K_M.gguf",
                    "sizeBytes": 1680000000,
                    "sha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
                    "downloadUrl": "https://example.com/standard.gguf"
                },
                "capabilities": {
                    "gec": {
                        "adapterId": null,
                        "filename": null,
                        "sizeBytes": 0,
                        "sha256": "",
                        "downloadUrl": ""
                    }
                }
            }
        ]
    }"#;
    let remote: RemoteManifest = serde_json::from_str(json).unwrap();
    let catalog = build_catalog_from_remote(&remote);
    let standard = catalog.iter().find(|m| m.id == STANDARD_MODEL_ID).unwrap();
    assert_eq!(standard.version, "v1.4.0");
    assert_eq!(standard.adapters.len(), 0); // adapterId: null 且 url 为空，成功忽略并不注册为下载项
    assert_eq!(standard.all_download_specs().len(), 1); // 仅有 base.gguf
    assert_eq!(standard.all_download_specs()[0].0, "base");
}

/// v1.4.0 清单里的 GitHub 地址仍指向迁移前仓库，实际 301 到 inkpoint-editor。
fn canonical_published_download_url(url: &str) -> String {
    url.replace(
        "https://github.com/wmasfoe/md-editor-models/",
        "https://github.com/inkpoint-editor/md-editor-models/",
    )
}

fn assert_builtin_asset_matches_published(
    label: &str,
    filename: &str,
    download_url: &str,
    size_bytes: u64,
    sha256: &str,
    published: &RemoteModelAsset,
) {
    assert_eq!(
        filename,
        published.filename.as_deref().unwrap(),
        "{label} filename"
    );
    assert_eq!(
        size_bytes,
        published.size_bytes.unwrap(),
        "{label} size_bytes"
    );
    assert_eq!(
        sha256,
        published.sha256.as_deref().unwrap(),
        "{label} sha256"
    );
    let published_url = published.download_url.as_deref().unwrap();
    assert_eq!(
        download_url,
        canonical_published_download_url(published_url),
        "{label} download_url"
    );
    if let Some(quant) = published.quant.as_deref() {
        assert!(
            filename.contains(quant),
            "{label} filename {filename} must carry quant {quant}"
        );
    }
}

#[test]
fn builtin_entries_match_published_v140_manifest() {
    let remote: RemoteManifest =
        serde_json::from_str(include_str!("fixtures/published-v1.4.0-manifest.json"))
            .expect("published v1.4.0 manifest fixture must parse");
    assert_eq!(remote.version, "1.4.0");
    assert_eq!(remote.context_size, Some(8192));

    let lite_entry = remote
        .models
        .iter()
        .find(|entry| entry.model_id.as_deref() == Some(LITE_MODEL_ID))
        .unwrap();
    let lite = default_lite_model();
    assert_builtin_asset_matches_published(
        "lite base",
        &lite.filename,
        &lite.download_url,
        lite.size_bytes,
        &lite.sha256,
        lite_entry.base.as_ref().unwrap(),
    );
    assert_eq!(lite.context_size, remote.context_size.unwrap());
    assert!(lite.is_available);
    let published_gec = lite_entry
        .capabilities
        .as_ref()
        .unwrap()
        .get("gec")
        .unwrap();
    assert_eq!(lite.adapters.len(), 1);
    let (task, adapter) = &lite.adapters[0];
    assert_eq!(task, "gec");
    assert_builtin_asset_matches_published(
        "lite gec",
        &adapter.filename,
        &adapter.download_url,
        adapter.size_bytes,
        &adapter.sha256,
        &published_gec.asset,
    );

    let standard_entry = remote
        .models
        .iter()
        .find(|entry| entry.model_id.as_deref() == Some(STANDARD_MODEL_ID))
        .unwrap();
    let standard = default_standard_model();
    let standard_base = standard_entry.base.as_ref().unwrap();
    assert_builtin_asset_matches_published(
        "standard base",
        &standard.filename,
        &standard.download_url,
        standard.size_bytes,
        &standard.sha256,
        standard_base,
    );
    // 非 GitHub 地址必须与清单原文一致，不能再改写成 Release 路径。
    assert_eq!(
        standard.download_url,
        standard_base.download_url.as_deref().unwrap()
    );
    assert!(standard.adapters.is_empty());
    assert_eq!(standard.all_download_specs().len(), 1);
    assert!(standard.is_available);
    assert_eq!(standard.context_size, remote.context_size.unwrap());

    let pro_entry = remote
        .models
        .iter()
        .find(|entry| entry.model_id.as_deref() == Some(PRO_MODEL_ID))
        .unwrap();
    let pro = default_pro_model();
    assert_eq!(pro_entry.is_available, Some(false));
    assert!(!pro.is_available);
    assert!(pro.download_url.is_empty());
    assert_eq!(pro.size_bytes, 0);
    assert!(pro.sha256.is_empty());
    assert!(pro.adapters.is_empty());
    assert!(pro.all_download_specs().is_empty());
}
