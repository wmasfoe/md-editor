use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem},
    Manager, WebviewWindow,
};
use tauri_plugin_dialog::DialogExt;

const FILE_TREE_MENU_PREFIX: &str = "md-editor:file-tree:";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkdownDocumentFile {
    file_path: String,
    markdown: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkdownFolder {
    root_path: String,
    root_name: String,
    tree: MarkdownFileTreeNode,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkdownFileTreeNode {
    name: String,
    path: String,
    kind: MarkdownFileTreeNodeKind,
    children: Option<Vec<MarkdownFileTreeNode>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MarkdownFileTreeNodeKind {
    Directory,
    Markdown,
    Asset,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PastedImageFile {
    markdown_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileTreeMutationResult {
    folder: MarkdownFolder,
    affected_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThemeCssFile {
    path: String,
    css: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkedFileTarget {
    path: String,
    kind: LinkedFileKind,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LinkedFileKind {
    Markdown,
    Asset,
    File,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CreateTreeItemKind {
    Markdown,
    Directory,
}

#[derive(Clone, Copy)]
enum FileTreeContextMenuAction {
    NewMarkdown,
    NewMdx,
    NewFolder,
    CopyRelativePath,
    CopyAbsolutePath,
    RevealInFinder,
    Rename,
    Delete,
}

impl FileTreeContextMenuAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::NewMarkdown => "new-markdown",
            Self::NewMdx => "new-mdx",
            Self::NewFolder => "new-folder",
            Self::CopyRelativePath => "copy-relative-path",
            Self::CopyAbsolutePath => "copy-absolute-path",
            Self::RevealInFinder => "reveal-in-finder",
            Self::Rename => "rename",
            Self::Delete => "delete",
        }
    }
}

#[tauri::command]
pub(crate) async fn open_markdown_document(
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

#[tauri::command]
pub(crate) fn read_theme_css_file(path: String) -> Result<ThemeCssFile, String> {
    read_theme_css_path(canonicalize_existing_path(&path, "theme CSS")?)
}

fn read_theme_css_path(path: PathBuf) -> Result<ThemeCssFile, String> {
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

#[tauri::command]
pub(crate) async fn open_markdown_document_at_path(
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
    allow_asset_directory(&app, &path)?;
    Ok(Some(build_markdown_folder(&path)?))
}

#[tauri::command]
pub(crate) fn refresh_markdown_folder(root_path: String) -> Result<MarkdownFolder, String> {
    let root = canonicalize_existing_path(&root_path, "root folder")?;
    build_markdown_folder(&root)
}

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

#[tauri::command]
pub(crate) fn show_file_tree_context_menu(
    app: tauri::AppHandle,
    window: WebviewWindow,
    x: f64,
    y: f64,
    has_node: bool,
) -> Result<(), String> {
    let new_markdown = file_tree_context_menu_item(
        &app,
        FileTreeContextMenuAction::NewMarkdown,
        "新建文件",
        true,
    )?;
    let new_mdx = file_tree_context_menu_item(
        &app,
        FileTreeContextMenuAction::NewMdx,
        "新建 MDX 文件",
        true,
    )?;
    let new_folder = file_tree_context_menu_item(
        &app,
        FileTreeContextMenuAction::NewFolder,
        "新建文件夹",
        true,
    )?;
    let copy_relative_path = file_tree_context_menu_item(
        &app,
        FileTreeContextMenuAction::CopyRelativePath,
        "复制路径",
        has_node,
    )?;
    let copy_absolute_path = file_tree_context_menu_item(
        &app,
        FileTreeContextMenuAction::CopyAbsolutePath,
        "复制绝对路径",
        has_node,
    )?;
    let reveal_in_finder = file_tree_context_menu_item(
        &app,
        FileTreeContextMenuAction::RevealInFinder,
        "在 Finder 中显示",
        has_node,
    )?;
    let rename =
        file_tree_context_menu_item(&app, FileTreeContextMenuAction::Rename, "重命名", has_node)?;
    let delete =
        file_tree_context_menu_item(&app, FileTreeContextMenuAction::Delete, "删除", has_node)?;
    let separator_one = PredefinedMenuItem::separator(&app).map_err(tauri_error_to_string)?;
    let separator_two = PredefinedMenuItem::separator(&app).map_err(tauri_error_to_string)?;

    let menu = Menu::with_items(
        &app,
        &[
            &new_markdown,
            &new_mdx,
            &new_folder,
            &separator_one,
            &copy_relative_path,
            &copy_absolute_path,
            &reveal_in_finder,
            &separator_two,
            &rename,
            &delete,
        ],
    )
    .map_err(tauri_error_to_string)?;

    window
        .popup_menu_at(&menu, tauri::LogicalPosition::new(x, y))
        .map_err(|error| format!("Failed to open file tree context menu: {error}"))
}

#[tauri::command]
pub(crate) fn copy_file_tree_path(
    root_path: String,
    path: String,
    relative: bool,
) -> Result<(), String> {
    let root = canonicalize_existing_path(&root_path, "root folder")?;
    let target = canonicalize_existing_path(&path, "tree item")?;
    ensure_path_inside_root(&root, &target)?;

    let text = if relative {
        file_tree_relative_path(&root, &target)?
    } else {
        path_to_string(&target)
    };

    copy_text_to_clipboard(&text)
}

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

#[tauri::command]
pub(crate) async fn save_markdown_document(
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

fn resolve_linked_file_path(document_path: &str, href: &str) -> Result<PathBuf, String> {
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

fn link_href_to_path(href: &str) -> Result<PathBuf, String> {
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

fn is_external_url(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
}

fn open_with_system_default(target: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(target);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", target]);
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

fn is_css_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("css")
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

fn file_tree_relative_path(root: &Path, path: &Path) -> Result<String, String> {
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

fn reveal_target_path(path: &Path) -> PathBuf {
    if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| path.to_path_buf())
    }
}

#[cfg(target_os = "macos")]
fn copy_text_to_clipboard(text: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start pbcopy: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open pbcopy stdin.".to_string())?;
    stdin
        .write_all(text.as_bytes())
        .map_err(|error| format!("Failed to write text to clipboard: {error}"))?;
    drop(stdin);

    let status = child
        .wait()
        .map_err(|error| format!("Failed to wait for pbcopy: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("pbcopy exited with status {status}."))
    }
}

#[cfg(not(target_os = "macos"))]
fn copy_text_to_clipboard(_text: &str) -> Result<(), String> {
    Err("Copying file tree paths is only supported on macOS for now.".to_string())
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

fn enabled_menu_item(
    app: &tauri::AppHandle,
    id: &str,
    label: &str,
    enabled: bool,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    MenuItemBuilder::with_id(id, label)
        .enabled(enabled)
        .build(app)
}

fn file_tree_context_menu_item(
    app: &tauri::AppHandle,
    action: FileTreeContextMenuAction,
    label: &str,
    enabled: bool,
) -> Result<tauri::menu::MenuItem<tauri::Wry>, String> {
    enabled_menu_item(app, &file_tree_menu_id(action), label, enabled)
        .map_err(tauri_error_to_string)
}

fn file_tree_menu_id(action: FileTreeContextMenuAction) -> String {
    format!("{}{}", FILE_TREE_MENU_PREFIX, action.as_str())
}

fn tauri_error_to_string(error: tauri::Error) -> String {
    error.to_string()
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
    fn file_tree_relative_path_is_based_on_opened_folder() {
        let root = Path::new("/notes/book");
        let target = root.join("drafts/chapter-1.md");

        assert_eq!(
            file_tree_relative_path(root, &target).unwrap(),
            "drafts/chapter-1.md"
        );
    }

    #[test]
    fn reveal_target_path_opens_parent_for_files() {
        let root = unique_test_directory("reveal-target-parent");
        fs::create_dir_all(root.join("drafts")).unwrap();
        let file = root.join("drafts/chapter-1.md");
        fs::write(&file, "# Chapter").unwrap();

        assert_eq!(reveal_target_path(&file), root.join("drafts"));
        assert_eq!(
            reveal_target_path(&root.join("drafts")),
            root.join("drafts")
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn link_href_to_path_strips_suffixes_and_decodes_spaces() {
        assert_eq!(
            link_href_to_path("<docs/my%20post.md>?preview=true#intro").unwrap(),
            PathBuf::from("docs/my post.md")
        );
    }

    #[test]
    fn file_url_link_href_keeps_platform_absolute_path() {
        #[cfg(target_os = "windows")]
        assert_eq!(
            link_href_to_path("file:///C:/notes/post.md").unwrap(),
            PathBuf::from("C:/notes/post.md")
        );

        #[cfg(not(target_os = "windows"))]
        assert_eq!(
            link_href_to_path("file:///Users/me/notes/post.md").unwrap(),
            PathBuf::from("/Users/me/notes/post.md")
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
