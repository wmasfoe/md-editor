#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};

#[cfg(target_os = "macos")]
use crate::recent_files;
use crate::settings;

#[cfg(target_os = "macos")]
pub(crate) const MENU_ACTION_EVENT: &str = "md-editor-menu-action";

#[cfg(target_os = "macos")]
fn is_zh_locale() -> bool {
    let settings = settings::load_app_settings();
    match settings.language.as_deref() {
        Some("zh") => true,
        Some("en") => false,
        _ => std::env::var("LANG")
            .map(|l| l.to_lowercase().starts_with("zh"))
            .unwrap_or(false),
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // 菜单项 id 是原生命令契约的一半，React 再映射回 editor-core command id。
    let is_zh = is_zh_locale();
    let open_recent_menu = recent_files::build_open_recent_menu(app, is_zh)?;

    let file_title = if is_zh { "文件" } else { "File" };
    let new_title = if is_zh { "新建" } else { "New" };
    let open_title = if is_zh { "打开..." } else { "Open..." };
    let open_folder_title = if is_zh {
        "打开文件夹..."
    } else {
        "Open Folder..."
    };
    let save_title = if is_zh { "保存" } else { "Save" };
    let save_as_title = if is_zh { "另存为..." } else { "Save As..." };

    let file_menu = SubmenuBuilder::new(app, file_title)
        .item(&menu_item(app, "md-editor:new", new_title, "CmdOrCtrl+N")?)
        .item(&menu_item(
            app,
            "md-editor:open",
            open_title,
            "CmdOrCtrl+O",
        )?)
        .items(&[&open_recent_menu])
        .item(&menu_item(
            app,
            "md-editor:open-folder",
            open_folder_title,
            "CmdOrCtrl+Shift+O",
        )?)
        .separator()
        .item(&menu_item(
            app,
            "md-editor:save",
            save_title,
            "CmdOrCtrl+S",
        )?)
        .item(&menu_item(
            app,
            "md-editor:save-as",
            save_as_title,
            "CmdOrCtrl+Shift+S",
        )?)
        .build()?;

    let edit_title = if is_zh { "编辑" } else { "Edit" };
    let edit_menu = SubmenuBuilder::new(app, edit_title)
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_title = if is_zh { "视图" } else { "View" };
    let mode_wysiwyg_title = if is_zh { "编辑模式" } else { "Edit Mode" };
    let toggle_source_title = if is_zh {
        "切换源码模式"
    } else {
        "Toggle Source Mode"
    };
    let toggle_sidebar_title = if is_zh {
        "切换文件树 / 大纲"
    } else {
        "Toggle File Tree / Outline"
    };

    let view_menu = SubmenuBuilder::new(app, view_title)
        .item(&menu_item(
            app,
            "md-editor:mode-wysiwyg",
            mode_wysiwyg_title,
            "CmdOrCtrl+1",
        )?)
        .item(&menu_item(
            app,
            "md-editor:toggle-source",
            toggle_source_title,
            &menu_accelerator_for_shortcut(&settings::shortcut_key("view.toggleSource", "Mod-/")),
        )?)
        .separator()
        .item(&menu_item(
            app,
            "md-editor:toggle-sidebar-primary",
            toggle_sidebar_title,
            &menu_accelerator_for_shortcut(&settings::shortcut_key(
                "view.toggleSidebarPrimary",
                "Mod-Shift-B",
            )),
        )?)
        .build()?;

    let settings_title = if is_zh { "设置" } else { "Settings" };
    let settings_item_title = if is_zh { "设置..." } else { "Settings..." };
    let settings_menu = SubmenuBuilder::new(app, settings_title)
        .item(&menu_item(
            app,
            "md-editor:settings",
            settings_item_title,
            &menu_accelerator_for_shortcut(&settings::shortcut_key("settings.open", "Mod-,")),
        )?)
        .build()?;

    let app_menu = SubmenuBuilder::new(app, "Inkpoint")
        .about(None)
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
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
    #[cfg(target_os = "macos")]
    {
        let new_menu =
            build_app_menu(&app).map_err(|error| format!("Failed to build menu: {error}"))?;

        app.set_menu(new_menu)
            .map_err(|error| format!("Failed to set menu: {error}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    let _ = app;

    Ok(())
}

#[tauri::command]
pub(crate) fn save_app_settings_and_update_menu(
    app: tauri::AppHandle,
    settings: settings::AppSettings,
) -> Result<(), String> {
    settings::save_app_settings(settings)?;

    #[cfg(target_os = "macos")]
    {
        let new_menu =
            build_app_menu(&app).map_err(|error| format!("Failed to build menu: {error}"))?;

        app.set_menu(new_menu)
            .map_err(|error| format!("Failed to set menu: {error}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    let _ = app;

    Ok(())
}

#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
fn menu_accelerator_for_shortcut(shortcut: &str) -> String {
    // 前端 keymap 使用 ProseMirror 风格的 Mod；Tauri 菜单加速键使用 CmdOrCtrl。
    shortcut.replace("Mod", "CmdOrCtrl").replace('-', "+")
}
