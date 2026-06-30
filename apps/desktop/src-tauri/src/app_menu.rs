use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};

use crate::{recent_files, settings};

pub(crate) const MENU_ACTION_EVENT: &str = "md-editor-menu-action";

pub(crate) fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
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

#[tauri::command]
pub(crate) fn update_recent_files_menu(app: tauri::AppHandle) -> Result<(), String> {
    let new_menu =
        build_app_menu(&app).map_err(|error| format!("Failed to build menu: {error}"))?;

    app.set_menu(new_menu)
        .map_err(|error| format!("Failed to set menu: {error}"))?;

    Ok(())
}

#[tauri::command]
pub(crate) fn save_app_settings_and_update_menu(
    app: tauri::AppHandle,
    settings: settings::AppSettings,
) -> Result<(), String> {
    settings::save_app_settings(settings)?;
    let new_menu =
        build_app_menu(&app).map_err(|error| format!("Failed to build menu: {error}"))?;

    app.set_menu(new_menu)
        .map_err(|error| format!("Failed to set menu: {error}"))?;

    Ok(())
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
