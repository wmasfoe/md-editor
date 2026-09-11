//! # Asset & Media Operations
//!
//! 提供图片资产粘贴落盘、自定义主题 CSS 选取与载入、以及 Markdown 内联链接与图片目标的解析。

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri_plugin_dialog::DialogExt;

use super::{
    document::{allow_asset_directory_for_file, write_atomically},
    path_utils::{
        canonicalize_existing_path, is_css_path, is_image_asset_path, is_markdown_path,
        markdown_relative_path_with_preference, normalize_path_without_fs, path_to_string,
    },
    tree::allow_asset_directory,
    types::{LinkedFileKind, LinkedFileTarget, PastedImageFile, ThemeCssFile},
};

/// 将剪贴板粘贴的图片二进制数据写入文档资产目录，并返回格式化后的 Markdown 相对路径。
#[tauri::command]
pub(crate) fn save_pasted_image(
    app: tauri::AppHandle,
    document_path: String,
    default_assets_dir: String,
    preferred_name: Option<String>,
    mime_type: String,
    bytes: Vec<u8>,
) -> Result<PastedImageFile, String> {
    // 粘贴图片写入当前文档旁边的资源目录，返回给 Markdown 的路径必须保持相对路径。
    let extension = image_extension(&mime_type)
        .ok_or_else(|| format!("Unsupported image type: {mime_type}"))?;
    let doc_path = Path::new(&document_path);
    let document_directory = doc_path
        .parent()
        .ok_or_else(|| format!("Cannot resolve parent directory for {document_path}"))?;
    let file_stem = doc_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("document");

    let assets_directory =
        resolve_assets_directory(document_directory, file_stem, &default_assets_dir)?;
    fs::create_dir_all(&assets_directory).map_err(|error| {
        format!(
            "Failed to create image assets directory {}: {error}",
            assets_directory.display()
        )
    })?;

    let image_path = next_image_path(&assets_directory, extension, preferred_name.as_deref());
    write_atomically(&image_path, &bytes)?;
    allow_asset_directory(&app, &assets_directory)?;

    let md_path = markdown_relative_path_with_preference(
        document_directory,
        &image_path,
        &default_assets_dir,
    )?;

    Ok(PastedImageFile {
        markdown_path: md_path,
    })
}

/// 弹出系统对话框选取本地 CSS 主题文件。
#[tauri::command]
pub(crate) async fn pick_theme_css_file(
    app: tauri::AppHandle,
) -> Result<Option<ThemeCssFile>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Choose Theme CSS")
        .add_filter("CSS", &["css"])
        .blocking_pick_file();

    let Some(file_path) = selected else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|error| format!("Selected CSS path is not readable: {error}"))?;
    read_theme_css_path(path).map(Some)
}

/// 读取指定绝对路径的自定义主题 CSS 内容。
#[tauri::command]
pub(crate) fn read_theme_css_file(path: String) -> Result<ThemeCssFile, String> {
    read_theme_css_path(canonicalize_existing_path(&path, "theme CSS")?)
}

pub(crate) fn read_theme_css_path(path: PathBuf) -> Result<ThemeCssFile, String> {
    if !is_css_path(&path) {
        return Err("主题文件必须使用 .css 扩展名。".to_string());
    }

    let css = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read theme CSS {}: {error}", path.display()))?;

    Ok(ThemeCssFile {
        path: path_to_string(&path),
        css,
    })
}

/// 检查链接目标并判断其类型（Markdown 文档、媒体资产或其他本地文件）。
#[tauri::command]
pub(crate) fn inspect_linked_file(
    app: tauri::AppHandle,
    document_path: String,
    href: String,
) -> Result<LinkedFileTarget, String> {
    let target = resolve_linked_file_path(&document_path, &href)?;
    allow_asset_directory_for_file(&app, &target)?;

    let kind = if is_markdown_path(&target) {
        LinkedFileKind::Markdown
    } else if is_image_asset_path(&target) {
        LinkedFileKind::Asset
    } else {
        LinkedFileKind::File
    };

    Ok(LinkedFileTarget {
        path: path_to_string(&target),
        kind,
    })
}

pub(crate) fn resolve_linked_file_path(document_path: &str, href: &str) -> Result<PathBuf, String> {
    let document = canonicalize_existing_path(document_path, "document")?;
    let document_directory = document
        .parent()
        .ok_or_else(|| format!("Cannot resolve parent directory for {}", document.display()))?;
    let link_path = link_href_to_path(href)?;
    let path = if link_path.is_absolute() {
        link_path
    } else {
        document_directory.join(link_path)
    };

    fs::canonicalize(&path).map_err(|error| {
        format!(
            "Failed to resolve linked file {} from {}: {error}",
            href,
            document.display()
        )
    })
}

pub(crate) fn link_href_to_path(href: &str) -> Result<PathBuf, String> {
    let target = strip_link_href_suffix(href.trim());
    if target.is_empty() {
        return Err("Link target is empty.".to_string());
    }

    if let Some(path) = target.strip_prefix("file://") {
        let decoded = percent_decode(path);
        #[cfg(target_os = "windows")]
        let decoded = decoded.trim_start_matches('/').to_string();
        return Ok(PathBuf::from(decoded));
    }

    let unwrapped = target
        .strip_prefix('<')
        .and_then(|inner| inner.strip_suffix('>'))
        .unwrap_or(target);

    Ok(PathBuf::from(percent_decode(unwrapped)))
}

fn strip_link_href_suffix(href: &str) -> &str {
    let query_index = href.find('?').unwrap_or(href.len());
    let fragment_index = href.find('#').unwrap_or(href.len());
    let end = query_index.min(fragment_index);

    &href[..end]
}

fn percent_decode(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let input_bytes = input.as_bytes();
    let mut index = 0;

    while index < input_bytes.len() {
        if input_bytes[index] == b'%' && index + 2 < input_bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                bytes.push(hex);
                index += 3;
                continue;
            }
        }

        bytes.push(input_bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&bytes).into_owned()
}

pub(crate) fn image_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

pub(crate) fn resolve_assets_directory(
    document_directory: &Path,
    file_stem: &str,
    assets_dir: &str,
) -> Result<PathBuf, String> {
    let interpolated = assets_dir.replace("${filename}", file_stem);
    let requested = PathBuf::from(&interpolated);
    let directory = if requested.is_absolute() {
        requested
    } else {
        document_directory.join(requested)
    };
    Ok(normalize_path_without_fs(&directory))
}

pub(crate) fn next_image_path(
    directory: &Path,
    extension: &str,
    preferred_name: Option<&str>,
) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let base_name = preferred_name
        .and_then(sanitize_image_base_name)
        .unwrap_or_else(|| format!("image-{timestamp}"));
    let mut index = 1;

    loop {
        let suffix = if index == 1 {
            String::new()
        } else {
            format!("-{index}")
        };
        let candidate = directory.join(format!("{base_name}{suffix}.{extension}"));

        // 文件名冲突通常只来自同一毫秒内的连续粘贴；循环避开即可。
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

pub(crate) fn sanitize_image_base_name(name: &str) -> Option<String> {
    let file_stem = Path::new(name)
        .file_stem()?
        .to_string_lossy()
        .to_lowercase();
    let mut output = String::new();
    let mut previous_dash = false;

    for character in file_stem.chars() {
        if character.is_ascii_alphanumeric() || character == '_' {
            output.push(character);
            previous_dash = false;
        } else if (character == '-' || character.is_whitespace())
            && !previous_dash
            && !output.is_empty()
        {
            output.push('-');
            previous_dash = true;
        }
    }

    while output.ends_with('-') {
        output.pop();
    }

    if output.is_empty() {
        None
    } else {
        output.truncate(80);
        Some(output)
    }
}
