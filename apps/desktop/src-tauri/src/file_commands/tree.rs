//! # File Tree Operations
//!
//! 负责递归扫描文件系统目录结构、过滤构建工作区 Markdown 与资产节点树，
//! 并向 Tauri 注册资产协议访问权限。

use std::{fs, path::Path};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use super::{
    path_utils::{
        canonicalize_existing_path, folder_name, is_image_asset_path, is_markdown_path,
        path_to_string,
    },
    types::{MarkdownFileTreeNode, MarkdownFileTreeNodeKind, MarkdownFolder},
};

/// 打开本地文件夹对话框并解析返回 Markdown 目录树结构。
#[tauri::command]
pub(crate) async fn open_markdown_folder(
    app: tauri::AppHandle,
) -> Result<Option<MarkdownFolder>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Open Folder")
        .blocking_pick_folder();

    let Some(folder_path) = selected else {
        return Ok(None);
    };

    let path = folder_path
        .into_path()
        .map_err(|error| format!("Selected folder path is not readable: {error}"))?;
    let _ = allow_asset_directory(&app, &path);
    Ok(Some(build_markdown_folder(&path)?))
}

/// 重新扫描已打开的 Markdown 根目录并返回最新的目录树。
#[tauri::command]
pub(crate) fn refresh_markdown_folder(root_path: String) -> Result<MarkdownFolder, String> {
    let root = canonicalize_existing_path(&root_path, "root folder")?;
    build_markdown_folder(&root)
}

/// 授予 Tauri asset 协议对指定目录的访问权限（供 webview 加载图片预览）。
pub(crate) fn allow_asset_directory(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(path, true)
        .map_err(|error| {
            format!(
                "Failed to allow image preview access for {}: {error}",
                path.display()
            )
        })
}

/// 构建完整的 MarkdownFolder 结构体。
pub(crate) fn build_markdown_folder(path: &Path) -> Result<MarkdownFolder, String> {
    let tree = build_markdown_tree(path)?.unwrap_or_else(|| MarkdownFileTreeNode {
        name: folder_name(path),
        path: path_to_string(path),
        kind: MarkdownFileTreeNodeKind::Directory,
        children: Some(Vec::new()),
    });

    Ok(MarkdownFolder {
        root_name: folder_name(path),
        root_path: path_to_string(path),
        tree,
    })
}

/// 递归构建指定路径的文件树节点，自动跳过隐藏文件和构建输出目录。
pub(crate) fn build_markdown_tree(path: &Path) -> Result<Option<MarkdownFileTreeNode>, String> {
    if path.is_file() {
        return Ok(if is_markdown_path(path) || is_image_asset_path(path) {
            Some(MarkdownFileTreeNode {
                name: folder_name(path),
                path: path_to_string(path),
                kind: if is_markdown_path(path) {
                    MarkdownFileTreeNodeKind::Markdown
                } else {
                    MarkdownFileTreeNodeKind::Asset
                },
                children: None,
            })
        } else {
            None
        });
    }

    let mut children = Vec::new();
    let entries = fs::read_dir(path)
        .map_err(|error| format!("Failed to read folder {}: {error}", path.display()))?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read folder entry: {error}"))?;
        let entry_path = entry.path();
        let name = folder_name(&entry_path);

        // 隐藏生成物和依赖目录；它们通常很大，也不是写作导航目标。
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" {
            continue;
        }

        if let Some(node) = build_markdown_tree(&entry_path)? {
            children.push(node);
        }
    }

    children.sort_by(|left, right| match (&left.kind, &right.kind) {
        (MarkdownFileTreeNodeKind::Directory, MarkdownFileTreeNodeKind::Markdown)
        | (MarkdownFileTreeNodeKind::Directory, MarkdownFileTreeNodeKind::Asset) => {
            std::cmp::Ordering::Less
        }
        (MarkdownFileTreeNodeKind::Markdown, MarkdownFileTreeNodeKind::Directory)
        | (MarkdownFileTreeNodeKind::Asset, MarkdownFileTreeNodeKind::Directory) => {
            std::cmp::Ordering::Greater
        }
        _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
    });

    Ok(Some(MarkdownFileTreeNode {
        name: folder_name(path),
        path: path_to_string(path),
        kind: MarkdownFileTreeNodeKind::Directory,
        children: Some(children),
    }))
}
