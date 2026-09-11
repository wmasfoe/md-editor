//! # File Tree Context Menu
//!
//! 负责构建文件树右键原生上下文弹出菜单并分发选中事件。

use tauri::{
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem},
    WebviewWindow,
};

use super::types::{FileTreeContextMenuAction, FILE_TREE_MENU_PREFIX};

/// 在指定视口坐标弹出文件树右键快捷操作菜单。
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

pub(crate) fn enabled_menu_item(
    app: &tauri::AppHandle,
    id: &str,
    label: &str,
    enabled: bool,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    MenuItemBuilder::with_id(id, label)
        .enabled(enabled)
        .build(app)
}

pub(crate) fn file_tree_context_menu_item(
    app: &tauri::AppHandle,
    action: FileTreeContextMenuAction,
    label: &str,
    enabled: bool,
) -> Result<tauri::menu::MenuItem<tauri::Wry>, String> {
    enabled_menu_item(
        app,
        &format!("{FILE_TREE_MENU_PREFIX}{}", action.as_str()),
        label,
        enabled,
    )
    .map_err(tauri_error_to_string)
}

pub(crate) fn tauri_error_to_string(error: tauri::Error) -> String {
    error.to_string()
}
