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

mod recent_files;
mod settings;

use recent_files::{load_recent_files, save_recent_files};
use settings::{load_app_settings, save_app_settings};

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    current_version: String,
    state: String,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum CreateTreeItemKind {
    Markdown,
    Directory,
}

pub fn run() {
    // Rust 只保留桌面能力边界：菜单、弹窗、文件访问授权和持久化；Markdown 编辑语义在 TS 层。
    tauri::Builder::default()
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            let action = event.id().as_ref();
            if action.starts_with("md-editor:") {
                // Tauri v2 这里广播给所有 webview，避免依赖固定窗口 label。
                let _ = app.emit(MENU_ACTION_EVENT, action);
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
            save_pasted_image,
            save_recent_files,
            update_recent_files_menu,
            load_recent_files,
            load_app_settings,
            save_app_settings_and_update_menu,
            check_for_updates
        ])
        .run(tauri::generate_context!())
        .expect("error while running Markdown Editor");
}

fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // 菜单项 id 是原生命令契约的一半，React 再映射回 editor-core command id。
    let app_menu = SubmenuBuilder::new(app, "Markdown Editor")
        .about(None)
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
        .build()?;

    let open_recent_menu = recent_files::build_open_recent_menu(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&menu_item(app, "md-editor:new", "New", "CmdOrCtrl+N")?)
        .item(&menu_item(app, "md-editor:open", "Open...", "CmdOrCtrl+O")?)
        .items(&[&open_recent_menu])
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
            &menu_accelerator_for_shortcut(&settings::shortcut_key("view.toggleSource", "Mod-/")),
        )?)
        .separator()
        .item(&menu_item(
            app,
            "md-editor:toggle-sidebar-primary",
            "Toggle File Tree / Outline",
            &menu_accelerator_for_shortcut(&settings::shortcut_key(
                "view.toggleSidebarPrimary",
                "Mod-Shift-B",
            )),
        )?)
        .build()?;

    let settings_menu = SubmenuBuilder::new(app, "Settings")
        .item(&menu_item(
            app,
            "md-editor:settings",
            "Settings...",
            &menu_accelerator_for_shortcut(&settings::shortcut_key("settings.open", "Mod-,")),
        )?)
        .build()?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &settings_menu,
        ],
    )
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

fn menu_accelerator_for_shortcut(shortcut: &str) -> String {
    // 前端 keymap 使用 ProseMirror 风格的 Mod；Tauri 菜单加速键使用 CmdOrCtrl。
    shortcut.replace("Mod", "CmdOrCtrl").replace('-', "+")
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
    // 保存和另存为共享一个命令：前端负责 dirty 状态，Rust 负责原生弹窗。
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
    default_assets_dir: String,
    preferred_name: Option<String>,
    mime_type: String,
    bytes: Vec<u8>,
) -> Result<PastedImageFile, String> {
    // 粘贴图片写入当前文档旁边的资源目录，返回给 Markdown 的路径必须保持相对路径。
    let extension = image_extension(&mime_type)
        .ok_or_else(|| format!("Unsupported image type: {mime_type}"))?;
    let document_directory = Path::new(&document_path)
        .parent()
        .ok_or_else(|| format!("Cannot resolve parent directory for {document_path}"))?;
    let assets_directory =
        normalize_child_assets_directory(document_directory, &default_assets_dir)?;
    fs::create_dir_all(&assets_directory).map_err(|error| {
        format!(
            "Failed to create image assets directory {}: {error}",
            assets_directory.display()
        )
    })?;

    let image_path = next_image_path(&assets_directory, extension, preferred_name.as_deref());
    write_atomically(&image_path, &bytes)?;
    allow_asset_directory(&app, &assets_directory)?;

    Ok(PastedImageFile {
        markdown_path: markdown_relative_path(document_directory, &image_path)?,
    })
}

#[tauri::command]
fn update_recent_files_menu(app: tauri::AppHandle) -> Result<(), String> {
    let new_menu =
        build_app_menu(&app).map_err(|error| format!("Failed to build menu: {error}"))?;

    app.set_menu(new_menu)
        .map_err(|error| format!("Failed to set menu: {error}"))?;

    Ok(())
}

#[tauri::command]
fn save_app_settings_and_update_menu(
    app: tauri::AppHandle,
    settings: settings::AppSettings,
) -> Result<(), String> {
    save_app_settings(settings)?;
    let new_menu =
        build_app_menu(&app).map_err(|error| format!("Failed to build menu: {error}"))?;

    app.set_menu(new_menu)
        .map_err(|error| format!("Failed to set menu: {error}"))?;

    Ok(())
}

#[tauri::command]
fn check_for_updates() -> UpdateStatus {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    // 先保留产品入口，但不伪装成已接入自动更新；真正检查更新需要签名发布源和 updater 插件。
    UpdateStatus {
        current_version: current_version.clone(),
        state: "unconfigured".to_string(),
        message: format!(
            "当前版本 {current_version}。自动更新源尚未配置，请通过 GitHub Release 或 Homebrew 获取新版本。"
        ),
    }
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

    let temporary_path = temporary_save_path(path)?;

    // 先写同级临时文件，再 rename 覆盖目标；写入失败时保留原 Markdown 文件。
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

fn temporary_save_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Cannot resolve parent directory for {}", path.display()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Cannot resolve file name for {}", path.display()))?
        .to_string_lossy();
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Failed to create temporary save path: {error}"))?
        .as_nanos();

    Ok(parent.join(format!(".{file_name}.tmp-{}-{suffix}", std::process::id())))
}

fn allow_asset_directory_for_file(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };

    allow_asset_directory(app, parent)
}

fn allow_asset_directory(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    // Tauri 的 file-src 转换只允许已授权路径；打开文件夹/文档时放开读权限用于图片预览。
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

fn normalize_child_assets_directory(
    document_directory: &Path,
    assets_dir: &str,
) -> Result<PathBuf, String> {
    let requested = PathBuf::from(assets_dir);
    let directory = if requested.is_absolute() {
        requested
    } else {
        document_directory.join(requested)
    };
    let normalized_document_directory = normalize_path_without_fs(document_directory);
    let normalized_directory = normalize_path_without_fs(&directory);

    if !normalized_directory.starts_with(&normalized_document_directory) {
        return Err(format!(
            "Image assets directory must be inside {}",
            document_directory.display()
        ));
    }

    Ok(normalized_directory)
}

fn markdown_relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(root).map_err(|error| {
        format!(
            "Failed to derive relative image path from {}: {error}",
            path.display()
        )
    })?;

    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

fn normalize_path_without_fs(path: &Path) -> PathBuf {
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

fn next_image_path(directory: &Path, extension: &str, preferred_name: Option<&str>) -> PathBuf {
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

fn sanitize_image_base_name(name: &str) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_tree_keeps_empty_directories_visible() {
        let root = unique_test_directory("empty-directories-visible");
        fs::create_dir_all(root.join("drafts")).unwrap();
        fs::write(root.join("notes.txt"), "not markdown").unwrap();

        let folder = build_markdown_folder(&root).unwrap();
        let children = folder.tree.children.as_deref().unwrap();

        assert!(children.iter().any(|child| {
            child.name == "drafts" && matches!(child.kind, MarkdownFileTreeNodeKind::Directory)
        }));
        assert!(!children.iter().any(|child| child.name == "notes.txt"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn creating_directory_returns_refreshed_tree_with_new_empty_directory() {
        let root = unique_test_directory("create-directory-tree-refresh");
        fs::create_dir_all(&root).unwrap();

        let result = create_markdown_tree_item(
            path_to_string(&root),
            path_to_string(&root),
            "drafts".to_string(),
            CreateTreeItemKind::Directory,
        )
        .unwrap();
        let children = result.folder.tree.children.as_deref().unwrap();

        assert!(children.iter().any(|child| {
            child.name == "drafts" && matches!(child.kind, MarkdownFileTreeNodeKind::Directory)
        }));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn markdown_relative_path_uses_custom_assets_directory() {
        let root = Path::new("/notes/post");
        let image = root.join("images/pasted.png");

        assert_eq!(
            markdown_relative_path(root, &image).unwrap(),
            "images/pasted.png"
        );
    }

    #[test]
    fn atomic_save_ignores_stale_fixed_process_temp_file() {
        let root = unique_test_directory("atomic-save-stale-temp");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("post.md");
        let stale_temp = root.join(format!(".post.md.tmp-{}", std::process::id()));
        fs::write(&path, "old").unwrap();
        fs::write(&stale_temp, "stale").unwrap();

        write_atomically(&path, b"new").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(fs::read_to_string(&stale_temp).unwrap(), "stale");

        fs::remove_dir_all(root).unwrap();
    }

    fn unique_test_directory(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();

        std::env::temp_dir().join(format!("md-editor-{label}-{}-{suffix}", std::process::id()))
    }
}
