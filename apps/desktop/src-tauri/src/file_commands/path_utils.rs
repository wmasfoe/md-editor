//! # Path Utilities
//!
//! 提供跨平台路径规范化、相对路径计算、安全根目录边界检查及文件名校验。

use std::{
    fs,
    path::{Path, PathBuf},
};

/// 检查路径是否为 Markdown 文件格式（.md / .mdx / .markdown）。
pub(crate) fn is_markdown_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "mdx" | "markdown")
    )
}

/// 检查路径是否为 CSS 文件格式（.css）。
pub(crate) fn is_css_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("css")
    )
}

/// 检查路径是否属于支持的图像媒体资产。
pub(crate) fn is_image_asset_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "gif" | "svg")
    )
}

/// 获取目录或文件的友好名称字符串。
pub(crate) fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

/// 将 Path 转为标准无损 UTF-8 字符串。
pub(crate) fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// 计算目标路径相对于工作区根目录的相对路径。
pub(crate) fn file_tree_relative_path(root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map(path_to_string)
        .map_err(|error| {
            format!(
                "Failed to compute path for {} relative to {}: {error}",
                path.display(),
                root.display()
            )
        })
}

/// 计算在文件管理器中定位时的目标路径（如果是文件则定位到其父目录）。
pub(crate) fn reveal_target_path(path: &Path) -> PathBuf {
    if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| path.to_path_buf())
    }
}

/// 将给定路径规范化解析为存在且合法的绝对路径。
pub(crate) fn canonicalize_existing_path(path: &str, label: &str) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|error| format!("Failed to resolve {label} {path}: {error}"))
}

/// 安全审计：确保目标路径位于已打开的工作区根目录内，防止路径遍历攻击。
pub(crate) fn ensure_path_inside_root(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        return Ok(());
    }

    Err(format!(
        "{} is outside opened folder {}.",
        path.display(),
        root.display()
    ))
}

/// 校验新建子项的文件名或目录名是否合法（非空、非相对导航符号、不含路径分隔符）。
pub(crate) fn valid_child_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err("Name cannot be empty.".to_string());
    }

    if trimmed == "." || trimmed == ".." || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Name must be a single file or folder name.".to_string());
    }

    Ok(trimmed)
}

/// 确保路径具有 Markdown 扩展名（若无扩展名则默认追加 `.md`）。
pub(crate) fn ensure_markdown_extension(path: PathBuf) -> PathBuf {
    if path.extension().is_none() {
        path.with_extension("md")
    } else {
        path
    }
}

/// 不访问真实文件系统的前提下，纯逻辑折叠 `.` 和 `..` 路径分量。
pub(crate) fn normalize_path_without_fs(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }

    normalized
}

/// 计算两个绝对或相对路径之间的相对导航路径。
pub(crate) fn relative_path_between(base: &Path, target: &Path) -> PathBuf {
    let base_norm = normalize_path_without_fs(base);
    let target_norm = normalize_path_without_fs(target);
    let base_comps: Vec<_> = base_norm.components().collect();
    let target_comps: Vec<_> = target_norm.components().collect();

    // 如果前缀或根不同（如 Windows 上不同盘符 C: vs D:），直接返回 target_norm
    if !base_comps.is_empty() && !target_comps.is_empty() && base_comps[0] != target_comps[0] {
        return target_norm;
    }

    let mut common = 0;
    while common < base_comps.len()
        && common < target_comps.len()
        && base_comps[common] == target_comps[common]
    {
        common += 1;
    }

    let mut rel = PathBuf::new();
    for _ in common..base_comps.len() {
        rel.push("..");
    }
    for comp in &target_comps[common..] {
        rel.push(comp.as_os_str());
    }
    rel
}

#[allow(dead_code)]
pub(crate) fn markdown_relative_path(root: &Path, path: &Path) -> Result<String, String> {
    markdown_relative_path_with_preference(root, path, "")
}

/// 根据用户偏好的路径模式（如 `./assets`）计算相对路径并格式化。
pub(crate) fn markdown_relative_path_with_preference(
    root: &Path,
    path: &Path,
    pattern: &str,
) -> Result<String, String> {
    let rel = relative_path_between(root, path);
    let joined = rel
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");

    // 如果用户显式配置以 ./ 开头，且相对路径没有以 ./ 或 ../ 开头，则保留 ./ 前缀
    let clean_pattern = pattern.replace('\\', "/");
    if clean_pattern.starts_with("./") && !joined.starts_with("./") && !joined.starts_with("../") {
        Ok(format!("./{joined}"))
    } else {
        Ok(joined)
    }
}
