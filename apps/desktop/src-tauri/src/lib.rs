use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItemBuilder, SubmenuBuilder},
    Emitter,
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
struct PastedImageFile {
    markdown_path: String,
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
            "md-editor:outline",
            "Jump to First Heading",
            "CmdOrCtrl+L",
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

    Ok(Some(MarkdownDocumentFile {
        file_path: path_to_string(&path),
        markdown,
    }))
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

    Ok(Some(MarkdownDocumentFile {
        file_path: path_to_string(&path),
        markdown,
    }))
}

#[tauri::command]
fn save_pasted_image(
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

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
