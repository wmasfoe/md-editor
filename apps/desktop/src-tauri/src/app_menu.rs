#[cfg(target_os = "macos")]
use tauri::menu::{
    AboutMetadataBuilder, CheckMenuItemBuilder, Menu, MenuItemBuilder, SubmenuBuilder,
};
use tauri::Manager;

#[cfg(target_os = "macos")]
use crate::recent_files;
use crate::settings;

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

/// D-2：View 菜单勾选态的**镜像**（单一事实在 renderer 的 focusModeField / typewriterModeField）。
/// 前端每次切换后 invoke `set_mode_menu_checked` 写入本状态，菜单重建时按状态应用 `checked`
/// —— 从而 AC-D2-1 的「勾选态与实际开关一致」由构造成立（两端各只有一个写入路径）。
#[derive(Default)]
pub(crate) struct ModeMenuState(pub(crate) std::sync::Mutex<ModeMenuChecks>);

#[derive(Default, Clone, Copy)]
pub(crate) struct ModeMenuChecks {
    pub(crate) focus: bool,
    pub(crate) typewriter: bool,
}

impl ModeMenuState {
    /// 写入单个模式的勾选镜像（ai-slop-cleaner Pass 4：抽为可单测的纯状态变更，
    /// 不依赖 AppHandle/菜单重建）。
    pub(crate) fn apply(&self, mode: &str, checked: bool) -> Result<(), String> {
        let mut guard = self
            .0
            .lock()
            .map_err(|error| format!("mode check lock poisoned: {error}"))?;
        match mode {
            "focus" => guard.focus = checked,
            "typewriter" => guard.typewriter = checked,
            other => return Err(format!("unknown view mode: {other}")),
        }
        Ok(())
    }
}

#[cfg(test)]
mod mode_menu_tests {
    use super::ModeMenuState;

    #[test]
    fn mirrors_focus_and_typewriter_independently() {
        let state = ModeMenuState::default();
        // 初始全关（与 renderer StateField 默认一致）
        assert!(!state.0.lock().unwrap().focus);
        assert!(!state.0.lock().unwrap().typewriter);

        // 开专注：只动 focus（A1 压测：两模式可叠加 → 必须是独立布尔）
        state.apply("focus", true).unwrap();
        assert!(state.0.lock().unwrap().focus);
        assert!(!state.0.lock().unwrap().typewriter);

        // 再开打字机：focus 不被清 —— 勾选态一致性镜像的关键不变量
        state.apply("typewriter", true).unwrap();
        assert!(state.0.lock().unwrap().focus);
        assert!(state.0.lock().unwrap().typewriter);

        // 未知 mode 显式报错（不静默）
        assert!(state.apply("nope", true).is_err());
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // 菜单项 id 是原生命令契约的一半，React 再映射回 editor-core command id。
    let is_zh = is_zh_locale();
    let open_recent_menu = recent_files::build_open_recent_menu(app, is_zh)?;
    // D-2 勾选态：从镜像状态读取（默认全关，与 renderer StateField 初始态一致）。
    let mode_checks = app
        .state::<ModeMenuState>()
        .0
        .lock()
        .map(|guard| *guard)
        .unwrap_or_default();

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
    let insert_table_title = if is_zh {
        "插入表格..."
    } else {
        "Insert Table..."
    };
    let edit_menu = SubmenuBuilder::new(app, edit_title)
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&menu_item(
            app,
            "md-editor:insert-table",
            insert_table_title,
            &menu_accelerator_for_shortcut(&settings::shortcut_key("table.insert", "Mod-Alt-T")),
        )?)
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
    let focus_mode_title = if is_zh { "专注模式" } else { "Focus Mode" };
    let typewriter_mode_title = if is_zh {
        "打字机模式"
    } else {
        "Typewriter Mode"
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
        .separator()
        // D-2：两个独立勾选项（A1 已压测：两模式可叠加，单一 item 无法表达）。
        // 键位 = 属主从全量占用盘点选定的 ①：Mod-Alt-f / Mod-Alt-t（与表格 Mod-Alt-T 区分大小写不冲突）。
        .item(&check_menu_item(
            app,
            "md-editor:toggle-focus-mode",
            focus_mode_title,
            &menu_accelerator_for_shortcut(&settings::shortcut_key("view.focusMode", "Mod-Alt-f")),
            mode_checks.focus,
        )?)
        .item(&check_menu_item(
            app,
            "md-editor:toggle-typewriter-mode",
            typewriter_mode_title,
            &menu_accelerator_for_shortcut(&settings::shortcut_key(
                "view.typewriterMode",
                "Mod-Alt-t",
            )),
            mode_checks.typewriter,
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

    let about_desc = if is_zh {
        "简洁的本地 Markdown 和 MDX 桌面编辑器"
    } else {
        "A sleek, local-first Markdown and MDX desktop editor"
    };
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("Inkpoint"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some(about_desc))
        .license(Some("GPL-3.0"))
        .website(Some("https://editor.jiaqi.im"))
        .website_label(Some("editor.jiaqi.im"))
        .build();

    let app_menu = SubmenuBuilder::new(app, "Inkpoint")
        .about(Some(about_metadata))
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

/// D-2：写入 View 菜单勾选态镜像并重建菜单（macOS）。
/// `mode` = `"focus"` / `"typewriter"`；`checked` 为 renderer 切换后的权威状态。
#[tauri::command]
pub(crate) fn set_mode_menu_checked(
    app: tauri::AppHandle,
    mode: String,
    checked: bool,
) -> Result<(), String> {
    {
        let state = app.state::<ModeMenuState>();
        state.apply(&mode, checked)?;
    }

    // 照抄 update_recent_files_menu 的重建惯用法：重建时 build_app_menu 读镜像状态应用 checked。
    #[cfg(target_os = "macos")]
    {
        let new_menu =
            build_app_menu(&app).map_err(|error| format!("Failed to build menu: {error}"))?;

        app.set_menu(new_menu)
            .map_err(|error| format!("Failed to set menu: {error}"))?;
    }

    Ok(())
}

/// LOW-3：按镜像状态重建菜单（菜单点击会自旋勾选；前端在 renderer ports 不可用时
/// 无法写镜像 → 本命令重建读回真实镜像，让原生勾选回退，避免误导性勾选悬置）。
#[tauri::command]
pub(crate) fn reapply_app_menu(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let new_menu =
            build_app_menu(&app).map_err(|error| format!("Failed to build menu: {error}"))?;
        app.set_menu(new_menu)
            .map_err(|error| format!("Failed to set menu: {error}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    let _ = &app;

    Ok(())
}

#[cfg(target_os = "macos")]
fn check_menu_item(
    app: &tauri::AppHandle,
    id: &str,
    label: &str,
    accelerator: &str,
    checked: bool,
) -> tauri::Result<tauri::menu::CheckMenuItem<tauri::Wry>> {
    CheckMenuItemBuilder::with_id(id, label)
        .checked(checked)
        .accelerator(accelerator)
        .build(app)
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
