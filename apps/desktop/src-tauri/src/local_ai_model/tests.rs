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
    assert_eq!(status.latest_version, "v1.3.0");
    assert!(status.has_update);
}

#[test]
fn sanitizes_corrupted_lora_task_description_to_canonical() {
    assert_eq!(
        sanitize_model_description(STANDARD_MODEL_ID, Some("任务专用 LoRA Adapter（distill）")),
        "Qwen3 进阶版，搭载语法纠错、行内续写与长文提炼三大任务专用 LoRA，能力全面。"
    );
    assert_eq!(
        sanitize_model_description(LITE_MODEL_ID, Some("任务专用 LoRA Adapter (gec)")),
        "Qwen3 架构任务专用 LoRA 矩阵（纠错 / 续写 / 提炼），极速轻量。"
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
