//! # File Tree Mutations
//!
//! 提供工作区文件与目录的增、删、改、路径复制以及系统级定位（在 Finder / 资源管理器中打开）。

use std::{fs, path::Path, process::Command};

use super::{
    document::write_atomically,
    path_utils::{
        canonicalize_existing_path, ensure_markdown_extension, ensure_path_inside_root,
        file_tree_relative_path, is_markdown_path, path_to_string, reveal_target_path,
        valid_child_name,
    },
    tree::build_markdown_folder,
    types::{CreateTreeItemKind, FileTreeMutationResult},
};

/// 在工作区指定父目录下创建新的 Markdown 文件或子文件夹。
#[tauri::command]
pub(crate) fn create_markdown_tree_item(
    root_path: String,
    parent_path: String,
    name: String,
    kind: CreateTreeItemKind,
) -> Result<FileTreeMutationResult, String> {
    let root = canonicalize_existing_path(&root_path, "root folder")?;
    let parent = canonicalize_existing_path(&parent_path, "parent folder")?;
    ensure_path_inside_root(&root, &parent)?;

    if !parent.is_dir() {
        return Err(format!("{} is not a folder.", parent.display()));
    }

    let path = match kind {
        CreateTreeItemKind::Markdown => {
            let path = ensure_markdown_extension(parent.join(valid_child_name(&name)?));
            if !is_markdown_path(&path) {
                return Err("Markdown files must use .md, .mdx, or .markdown.".to_string());
            }
            if path.exists() {
                return Err(format!("{} already exists.", path.display()));
            }
            write_atomically(&path, b"")?;
            path
        }
        CreateTreeItemKind::Directory => {
            let path = parent.join(valid_child_name(&name)?);
            if path.exists() {
                return Err(format!("{} already exists.", path.display()));
            }
            fs::create_dir(&path)
                .map_err(|error| format!("Failed to create folder {}: {error}", path.display()))?;
            path
        }
    };

    Ok(FileTreeMutationResult {
        folder: build_markdown_folder(&root)?,
        affected_path: Some(path_to_string(&path)),
    })
}

/// 重命名工作区中的文件或文件夹。
#[tauri::command]
pub(crate) fn rename_markdown_tree_item(
    root_path: String,
    path: String,
    name: String,
) -> Result<FileTreeMutationResult, String> {
    let root = canonicalize_existing_path(&root_path, "root folder")?;
    let current_path = canonicalize_existing_path(&path, "tree item")?;
    ensure_path_inside_root(&root, &current_path)?;

    if current_path == root {
        return Err("Cannot rename the opened root folder.".to_string());
    }

    let parent = current_path.parent().ok_or_else(|| {
        format!(
            "Cannot resolve parent directory for {}",
            current_path.display()
        )
    })?;
    let next_path = if current_path.is_file() {
        let path = ensure_markdown_extension(parent.join(valid_child_name(&name)?));
        if !is_markdown_path(&path) {
            return Err("Markdown files must use .md, .mdx, or .markdown.".to_string());
        }
        path
    } else {
        parent.join(valid_child_name(&name)?)
    };

    if next_path.exists() {
        return Err(format!("{} already exists.", next_path.display()));
    }

    fs::rename(&current_path, &next_path).map_err(|error| {
        format!(
            "Failed to rename {} to {}: {error}",
            current_path.display(),
            next_path.display()
        )
    })?;

    Ok(FileTreeMutationResult {
        folder: build_markdown_folder(&root)?,
        affected_path: Some(path_to_string(&next_path)),
    })
}

/// 从工作区删除目标文件或目录（包含其所有子项）。
#[tauri::command]
pub(crate) fn delete_markdown_tree_item(
    root_path: String,
    path: String,
) -> Result<FileTreeMutationResult, String> {
    let root = canonicalize_existing_path(&root_path, "root folder")?;
    let target = canonicalize_existing_path(&path, "tree item")?;
    ensure_path_inside_root(&root, &target)?;

    if target == root {
        return Err("Cannot delete the opened root folder.".to_string());
    }

    if target.is_dir() {
        fs::remove_dir_all(&target)
            .map_err(|error| format!("Failed to delete folder {}: {error}", target.display()))?;
    } else {
        fs::remove_file(&target)
            .map_err(|error| format!("Failed to delete file {}: {error}", target.display()))?;
    }

    Ok(FileTreeMutationResult {
        folder: build_markdown_folder(&root)?,
        affected_path: None,
    })
}

/// 复制工作区树中选中项的相对路径或绝对路径。
#[tauri::command]
pub(crate) fn copy_file_tree_path(
    root_path: String,
    path: String,
    relative: bool,
) -> Result<String, String> {
    let root = canonicalize_existing_path(&root_path, "root folder")?;
    let target = canonicalize_existing_path(&path, "tree item")?;
    ensure_path_inside_root(&root, &target)?;

    let text = if relative {
        file_tree_relative_path(&root, &target)?
    } else {
        path_to_string(&target)
    };

    Ok(text)
}

/// 在系统原生文件管理器（macOS Finder / Windows 资源管理器 / Linux 文件管理器）中定位该项。
#[tauri::command]
pub(crate) fn reveal_file_tree_item_in_finder(
    root_path: String,
    path: String,
) -> Result<(), String> {
    let root = canonicalize_existing_path(&root_path, "root folder")?;
    let target = canonicalize_existing_path(&path, "tree item")?;
    ensure_path_inside_root(&root, &target)?;

    open_with_system_default(&path_to_string(&reveal_target_path(&target)))
}

/// 检查给定路径是否存在于本地文件系统。
#[tauri::command]
pub(crate) fn check_path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// 打开外部 URL 链接或本地目标文件。
#[tauri::command]
pub(crate) fn open_external_target(target: String) -> Result<(), String> {
    let target = target.trim();
    if target.is_empty() {
        return Err("Link target is empty.".to_string());
    }

    let resolved_target = if is_external_url(target) {
        target.to_string()
    } else {
        path_to_string(&canonicalize_existing_path(target, "linked file")?)
    };

    open_with_system_default(&resolved_target)
}

/// 判断目标字符串是否为网络外部超链接或邮件链接。
pub(crate) fn is_external_url(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
}

/// 调用系统原生默认程序打开目标（URL 或本地路径）。
pub(crate) fn open_with_system_default(target: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(target);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", target]);
        command.creation_flags(0x08000000);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(target);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open link target {target}: {error}"))
}
