use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager,
};
use tauri_plugin_dialog::DialogExt;

const MENU_ACTION_EVENT: &str = "md-editor-menu-action";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownDocumentFile {
    file_path: String,
    markdown: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownFolder {
    root_path: String,
    root_name: String,
    tree: MarkdownFileTreeNode,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownFileTreeNode {
    name: String,
    path: String,
    kind: MarkdownFileTreeNodeKind,
    children: Option<Vec<MarkdownFileTreeNode>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
enum MarkdownFileTreeNodeKind {
    Directory,
    Markdown,
    Asset,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PastedImageFile {
    markdown_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileTreeMutationResult {
    folder: MarkdownFolder,
    affected_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum CreateTreeItemKind {
    Markdown,
    Directory,
}

pub fn run() {
    // v0.1 只开放对话框和文件系统能力，先满足打开/保存流程，
    // 避免过早增加无关的原生接口面。
    tauri::Builder::default()
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            let action = event.id().as_ref();
            if action.starts_with("md-editor:") {
                let _ = app.emit_to("main", MENU_ACTION_EVENT, action);
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            open_markdown_document,
            open_markdown_document_at_path,
            open_markdown_folder,
            refresh_markdown_folder,
            create_markdown_tree_item,
            rename_markdown_tree_item,
            delete_markdown_tree_item,
            save_markdown_document,
            save_pasted_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running Markdown Editor");
}

fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let app_menu = SubmenuBuilder::new(app, "Markdown Editor")
        .about(None)
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&menu_item(app, "md-editor:new", "New", "CmdOrCtrl+N")?)
        .item(&menu_item(app, "md-editor:open", "Open...", "CmdOrCtrl+O")?)
        .item(&menu_item(
            app,
            "md-editor:open-folder",
            "Open Folder...",
            "CmdOrCtrl+Shift+O",
        )?)
        .separator()
        .item(&menu_item(app, "md-editor:save", "Save", "CmdOrCtrl+S")?)
        .item(&menu_item(
            app,
            "md-editor:save-as",
            "Save As...",
            "CmdOrCtrl+Shift+S",
        )?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&menu_item(
            app,
            "md-editor:mode-wysiwyg",
            "Edit Mode",
            "CmdOrCtrl+1",
        )?)
        .item(&menu_item(
            app,
            "md-editor:toggle-source",
            "Toggle Source Mode",
            "CmdOrCtrl+/",
        )?)
        .separator()
        .item(&menu_item(
            app,
            "md-editor:toggle-sidebar-primary",
            "Toggle File Tree / Outline",
            "CmdOrCtrl+Shift+1",
        )?)
        .build()?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu])
}

fn menu_item(
    app: &tauri::AppHandle,
    id: &str,
    label: &str,
    accelerator: &str,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    MenuItemBuilder::with_id(id, label)
        .accelerator(accelerator)
        .build(app)
}

#[tauri::command]
async fn open_markdown_document(
    app: tauri::AppHandle,
) -> Result<Option<MarkdownDocumentFile>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Open Markdown")
        .add_filter("Markdown", &["md", "mdx", "markdown"])
        .blocking_pick_file();

    let Some(file_path) = selected else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|error| format!("Selected file path is not readable: {error}"))?;
    let markdown = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    allow_asset_directory_for_file(&app, &path)?;

    Ok(Some(MarkdownDocumentFile {
        file_path: path_to_string(&path),
        markdown,
    }))
}

#[tauri::command]
async fn open_markdown_document_at_path(
    app: tauri::AppHandle,
    path: String,
) -> Result<MarkdownDocumentFile, String> {
    let path = PathBuf::from(path);
    let markdown = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    allow_asset_directory_for_file(&app, &path)?;

    Ok(MarkdownDocumentFile {
        file_path: path_to_string(&path),
        markdown,
    })
}

#[tauri::command]
async fn open_markdown_folder(app: tauri::AppHandle) -> Result<Option<MarkdownFolder>, String> {
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
    allow_asset_directory(&app, &path)?;
    Ok(Some(build_markdown_folder(&path)?))
}

#[tauri::command]
fn refresh_markdown_folder(root_path: String) -> Result<MarkdownFolder, String> {
    let root = canonicalize_existing_path(&root_path, "root folder")?;
    build_markdown_folder(&root)
}

#[tauri::command]
fn create_markdown_tree_item(
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

#[tauri::command]
fn rename_markdown_tree_item(
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

    let parent = current_path
        .parent()
        .ok_or_else(|| format!("Cannot resolve parent directory for {}", current_path.display()))?;
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

#[tauri::command]
fn delete_markdown_tree_item(
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

#[tauri::command]
async fn save_markdown_document(
    app: tauri::AppHandle,
    file_path: Option<String>,
    markdown: String,
    force_dialog: bool,
) -> Result<Option<MarkdownDocumentFile>, String> {
    let path = if force_dialog {
        let Some(path) = choose_save_path(&app, file_path.as_deref())? else {
            return Ok(None);
        };
        path
    } else if let Some(file_path) = file_path {
        PathBuf::from(file_path)
    } else {
        let Some(path) = choose_save_path(&app, None)? else {
            return Ok(None);
        };
        path
    };

    let path = ensure_markdown_extension(path);
    write_atomically(&path, markdown.as_bytes())?;
    allow_asset_directory_for_file(&app, &path)?;

    Ok(Some(MarkdownDocumentFile {
        file_path: path_to_string(&path),
        markdown,
    }))
}

#[tauri::command]
fn save_pasted_image(
    app: tauri::AppHandle,
    document_path: String,
    mime_type: String,
    bytes: Vec<u8>,
) -> Result<PastedImageFile, String> {
    let extension = image_extension(&mime_type)
        .ok_or_else(|| format!("Unsupported image type: {mime_type}"))?;
    let document_directory = Path::new(&document_path)
        .parent()
        .ok_or_else(|| format!("Cannot resolve parent directory for {document_path}"))?;
    let assets_directory = document_directory.join("assets");
    fs::create_dir_all(&assets_directory).map_err(|error| {
        format!(
            "Failed to create image assets directory {}: {error}",
            assets_directory.display()
        )
    })?;

    let image_path = next_image_path(&assets_directory, extension);
    write_atomically(&image_path, &bytes)?;
    allow_asset_directory(&app, &assets_directory)?;

    Ok(PastedImageFile {
        markdown_path: format!(
            "assets/{}",
            image_path
                .file_name()
                .ok_or_else(|| format!("Cannot resolve file name for {}", image_path.display()))?
                .to_string_lossy()
        ),
    })
}

fn choose_save_path(
    app: &tauri::AppHandle,
    current_path: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save Markdown")
        .add_filter("Markdown", &["md", "mdx", "markdown"])
        .set_can_create_directories(true);

    if let Some(path) = current_path.map(Path::new) {
        if let Some(parent) = path.parent() {
            dialog = dialog.set_directory(parent);
        }
        if let Some(file_name) = path.file_name() {
            dialog = dialog.set_file_name(file_name.to_string_lossy());
        }
    } else {
        dialog = dialog.set_file_name("Untitled.md");
    }

    dialog
        .blocking_save_file()
        .map(|path| {
            path.into_path()
                .map_err(|error| format!("Selected save path is not writable: {error}"))
        })
        .transpose()
}

fn ensure_markdown_extension(path: PathBuf) -> PathBuf {
    if path.extension().is_some() {
        return path;
    }

    // 用户在保存面板里不写扩展名时，默认补 .md，降低日常写作摩擦。
    path.with_extension("md")
}

fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Cannot resolve parent directory for {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;

    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Cannot resolve file name for {}", path.display()))?
        .to_string_lossy();
    let temporary_path = parent.join(format!(".{file_name}.tmp-{}", std::process::id()));

    // 先写临时文件再替换目标文件；如果写入失败，原文件仍然保持不变。
    if let Err(error) = fs::write(&temporary_path, bytes) {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!("Failed to write {}: {error}", path.display()));
    }

    if let Err(error) = fs::rename(&temporary_path, path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!("Failed to replace {}: {error}", path.display()));
    }

    Ok(())
}

fn allow_asset_directory_for_file(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };

    allow_asset_directory(app, parent)
}

fn allow_asset_directory(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    app.state::<tauri::scope::Scopes>()
        .allow_directory(path, true)
        .map_err(|error| {
            format!(
                "Failed to allow image preview access for {}: {error}",
                path.display()
            )
        })
}

fn image_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

fn next_image_path(directory: &Path, extension: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let mut index = 1;

    loop {
        let suffix = if index == 1 {
            String::new()
        } else {
            format!("-{index}")
        };
        let candidate = directory.join(format!("image-{timestamp}{suffix}.{extension}"));

        // 文件名冲突通常只来自同一毫秒内的连续粘贴；循环避开即可。
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

fn build_markdown_folder(path: &Path) -> Result<MarkdownFolder, String> {
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

fn build_markdown_tree(path: &Path) -> Result<Option<MarkdownFileTreeNode>, String> {
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

    if children.is_empty() {
        return Ok(None);
    }

    Ok(Some(MarkdownFileTreeNode {
        name: folder_name(path),
        path: path_to_string(path),
        kind: MarkdownFileTreeNodeKind::Directory,
        children: Some(children),
    }))
}

fn is_markdown_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "mdx" | "markdown")
    )
}

fn is_image_asset_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "gif" | "svg")
    )
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn canonicalize_existing_path(path: &str, label: &str) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|error| format!("Failed to resolve {label} {path}: {error}"))
}

fn ensure_path_inside_root(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        return Ok(());
    }

    Err(format!(
        "{} is outside opened folder {}.",
        path.display(),
        root.display()
    ))
}

fn valid_child_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err("Name cannot be empty.".to_string());
    }

    if trimmed == "." || trimmed == ".." || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Name must be a single file or folder name.".to_string());
    }

    Ok(trimmed)
}
