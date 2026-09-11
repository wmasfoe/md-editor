//! # Local AI Model Management
//!
//! 本模块负责 md-editor 本地大模型生态的管理体系，包括：
//! 1. `manifest`：内置模型规格、远端清单拉取与 LoRA Adapter 结构定义；
//! 2. `storage`：本地已下载模型管理、SHA-256 完整性校验、组件复用与状态持久化；
//! 3. `downloader`：调用原生 curl 进程断点续传与安全 staging 替换下载管道。

pub(crate) mod downloader;
pub(crate) mod manifest;
pub(crate) mod storage;

#[cfg(test)]
mod tests;

#[allow(unused_imports)]
pub(crate) use downloader::{
    cancel_local_ai_model_download, download_local_ai_model, DOWNLOAD_CANCEL_FILE_NAME,
    LOCAL_AI_DOWNLOAD_CANCELLED_MESSAGE,
};
#[allow(unused_imports)]
pub(crate) use manifest::{
    build_catalog_from_remote, default_lite_model, default_pro_model, default_standard_model,
    fetch_remote_manifest, resolve_all_manifests, resolve_manifest, sanitize_model_description,
    LocalAiFileSpec, LocalAiModelManifest, RemoteManifest, DEFAULT_MODEL_ID, LEGACY_MODEL_ID,
    LITE_MODEL_ID, PRO_MODEL_ID, STANDARD_MODEL_ID,
};
#[allow(unused_imports)]
pub(crate) use storage::{
    check_local_ai_model_updates, delete_local_ai_model, get_all_local_ai_models_status,
    get_available_local_ai_model, get_local_ai_model_status, LocalAiModelFile, LocalAiModelStatus,
};
