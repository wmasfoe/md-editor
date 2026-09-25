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
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum AppMenuLocale {
    Zh,
    ZhHant,
    Ja,
    En,
}

#[cfg(target_os = "macos")]
pub(crate) fn detect_menu_locale() -> AppMenuLocale {
    let settings = settings::load_app_settings();
    match settings.language.as_deref() {
        Some("zh") => AppMenuLocale::Zh,
        Some("zh-Hant") => AppMenuLocale::ZhHant,
        Some("ja") => AppMenuLocale::Ja,
        Some("en") => AppMenuLocale::En,
        _ => {
            let lang = std::env::var("LANG").unwrap_or_default().to_lowercase();
            if lang.starts_with("zh-tw")
                || lang.starts_with("zh-hk")
                || lang.starts_with("zh-mo")
                || lang.starts_with("zh-hant")
            {
                AppMenuLocale::ZhHant
            } else if lang.starts_with("zh") {
                AppMenuLocale::Zh
            } else if lang.starts_with("ja") {
                AppMenuLocale::Ja
            } else {
                AppMenuLocale::En
            }
        }
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

#[cfg(test)]
#[cfg(target_os = "macos")]
mod menu_accelerator_collision_tests {
    use super::{menu_accelerator_for_shortcut, MENU_ACCELERATOR_SHORTCUTS};

    /// muda 解析时对键名 `to_uppercase()` 后匹配，故归一必须大小写不敏感。
    fn normalize(accelerator: &str) -> String {
        accelerator.to_uppercase()
    }

    fn menu_accelerators() -> Vec<(String, String)> {
        MENU_ACCELERATOR_SHORTCUTS
            .iter()
            .map(|(id, fallback)| {
                (
                    (*id).to_string(),
                    normalize(&menu_accelerator_for_shortcut(fallback)),
                )
            })
            .collect()
    }

    /// S1 回归锁：已删除的「编辑模式 (Cmd+1)」菜单项不得被重新加回加速键表。
    #[test]
    fn removed_edit_mode_menu_item_stays_removed() {
        assert!(
            MENU_ACCELERATOR_SHORTCUTS
                .iter()
                .all(|(id, _)| *id != "md-editor:mode-wysiwyg"),
            "「编辑模式」菜单项已按 S1 删除（编辑轴与视图轴正交；源码双向切换由 Mod-/ 覆盖），不得重新加入",
        );
    }

    /// 守卫自证：归一必须真的能抓住大小写碰撞，否则下面的“两两不同”是假保证。
    #[test]
    fn normalization_treats_uppercase_and_lowercase_as_the_same_accelerator() {
        assert_eq!(
            normalize(&menu_accelerator_for_shortcut("Mod-Alt-t")),
            normalize(&menu_accelerator_for_shortcut("Mod-Alt-T")),
            "归一自证：Mod-Alt-t 与 Mod-Alt-T 必须被判为同一 OS 级加速键",
        );
    }

    #[test]
    fn all_menu_accelerators_are_pairwise_distinct() {
        let entries = menu_accelerators();
        for (index, (id, accelerator)) in entries.iter().enumerate() {
            for (other_id, other) in entries.iter().skip(index + 1) {
                assert_ne!(
                    accelerator, other,
                    "菜单加速键碰撞：{id} 与 {other_id} 归一后相同（{accelerator}）",
                );
            }
        }
    }

    /// 回归锁：打字机模式曾用 `Mod-Alt-t`，与既有表格 `Mod-Alt-T` 碰撞。
    #[test]
    fn typewriter_mode_does_not_collide_with_table_insert() {
        let typewriter = MENU_ACCELERATOR_SHORTCUTS
            .iter()
            .find(|(id, _)| *id == "view.toggleTypewriterMode")
            .map(|(_, fallback)| normalize(&menu_accelerator_for_shortcut(fallback)))
            .expect("打字机模式必须在加速键表内登记");
        let table = normalize(&menu_accelerator_for_shortcut("Mod-Alt-T"));
        assert_ne!(typewriter, table, "打字机模式不得与表格插入共用加速键");
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // 菜单项 id 是原生命令契约的一半，React 再映射回 editor-core command id。
    let locale = detect_menu_locale();
    let open_recent_menu = recent_files::build_open_recent_menu(app, locale)?;
    // D-2 勾选态：从镜像状态读取（默认全关，与 renderer StateField 初始态一致）。
    let mode_checks = app
        .state::<ModeMenuState>()
        .0
        .lock()
        .map(|guard| *guard)
        .unwrap_or_default();

    let file_title = match locale {
        AppMenuLocale::Zh => "文件",
        AppMenuLocale::ZhHant => "檔案",
        AppMenuLocale::Ja => "ファイル",
        AppMenuLocale::En => "File",
    };
    let new_title = match locale {
        AppMenuLocale::Zh => "新建",
        AppMenuLocale::ZhHant => "新增",
        AppMenuLocale::Ja => "新規作成",
        AppMenuLocale::En => "New",
    };
    let open_title = match locale {
        AppMenuLocale::Zh => "打开...",
        AppMenuLocale::ZhHant => "開啟...",
        AppMenuLocale::Ja => "開く...",
        AppMenuLocale::En => "Open...",
    };
    let open_folder_title = match locale {
        AppMenuLocale::Zh => "打开文件夹...",
        AppMenuLocale::ZhHant => "開啟資料夾...",
        AppMenuLocale::Ja => "フォルダーを開く...",
        AppMenuLocale::En => "Open Folder...",
    };
    let save_title = match locale {
        AppMenuLocale::Zh => "保存",
        AppMenuLocale::ZhHant => "儲存",
        AppMenuLocale::Ja => "保存",
        AppMenuLocale::En => "Save",
    };
    let save_as_title = match locale {
        AppMenuLocale::Zh => "另存为...",
        AppMenuLocale::ZhHant => "另存為...",
        AppMenuLocale::Ja => "名前を付けて保存...",
        AppMenuLocale::En => "Save As...",
    };

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

    let edit_title = match locale {
        AppMenuLocale::Zh => "编辑",
        AppMenuLocale::ZhHant => "編輯",
        AppMenuLocale::Ja => "編集",
        AppMenuLocale::En => "Edit",
    };
    let insert_table_title = match locale {
        AppMenuLocale::Zh => "插入表格...",
        AppMenuLocale::ZhHant => "插入表格...",
        AppMenuLocale::Ja => "テーブルを挿入...",
        AppMenuLocale::En => "Insert Table...",
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
            &shortcut_accelerator("table.insert"),
        )?)
        .build()?;

    let view_title = match locale {
        AppMenuLocale::Zh => "视图",
        AppMenuLocale::ZhHant => "檢視",
        AppMenuLocale::Ja => "表示",
        AppMenuLocale::En => "View",
    };
    let toggle_source_title = match locale {
        AppMenuLocale::Zh => "切换源码模式",
        AppMenuLocale::ZhHant => "切換原始碼模式",
        AppMenuLocale::Ja => "ソースコードモード切替",
        AppMenuLocale::En => "Toggle Source Mode",
    };
    let toggle_sidebar_title = match locale {
        AppMenuLocale::Zh => "切换文件树 / 大纲",
        AppMenuLocale::ZhHant => "切換檔案樹 / 大綱",
        AppMenuLocale::Ja => "ファイルツリー / アウトライン切替",
        AppMenuLocale::En => "Toggle File Tree / Outline",
    };
    let focus_mode_title = match locale {
        AppMenuLocale::Zh => "专注模式",
        AppMenuLocale::ZhHant => "專注模式",
        AppMenuLocale::Ja => "フォーカスモード",
        AppMenuLocale::En => "Focus Mode",
    };
    let typewriter_mode_title = match locale {
        AppMenuLocale::Zh => "打字机模式",
        AppMenuLocale::ZhHant => "打字機模式",
        AppMenuLocale::Ja => "タイプライターモード",
        AppMenuLocale::En => "Typewriter Mode",
    };

    let view_menu = SubmenuBuilder::new(app, view_title)
        // S1（编辑器交互 bug 批）：**删除「编辑模式 (Cmd+1)」菜单项**。
        //
        // 理由（属主确认的模型）：编辑轴（源码 ↔ 所见即所得）与视图轴（专注/打字机）**正交**，
        // 不在同一组里；源码模式的**双向**切换已由下方 `Mod-/` 一项覆盖，
        // 故不再单列“只回所见即所得”的菜单项（命令 `view.showWysiwyg` 仍供侧栏/命令面板使用）。
        .item(&menu_item(
            app,
            "md-editor:toggle-source",
            toggle_source_title,
            &shortcut_accelerator("view.toggleSource"),
        )?)
        .separator()
        .item(&menu_item(
            app,
            "md-editor:toggle-sidebar-primary",
            toggle_sidebar_title,
            &shortcut_accelerator("view.toggleSidebarPrimary"),
        )?)
        .separator()
        // D-2：两个独立勾选项（A1 已压测：两模式可叠加，单一 item 无法表达）。
        // 键位 = 属主从全量占用盘点选定的 ①；其中打字机模式因与既有表格 `Mod-Alt-T`
        // 在 muda 归一后**同一加速键**（键名 `to_uppercase()` 后匹配，`T` 与 `t` 等价）
        // 而改选 `Mod-Alt-y` —— 见 MENU_ACCELERATOR_SHORTCUTS 的说明与碰撞守卫测试。
        .item(&check_menu_item(
            app,
            "md-editor:toggle-focus-mode",
            focus_mode_title,
            &shortcut_accelerator("view.toggleFocusMode"),
            mode_checks.focus,
        )?)
        .item(&check_menu_item(
            app,
            "md-editor:toggle-typewriter-mode",
            typewriter_mode_title,
            &shortcut_accelerator("view.toggleTypewriterMode"),
            mode_checks.typewriter,
        )?)
        .build()?;

    let settings_title = match locale {
        AppMenuLocale::Zh => "设置",
        AppMenuLocale::ZhHant => "設定",
        AppMenuLocale::Ja => "設定",
        AppMenuLocale::En => "Settings",
    };
    let settings_item_title = match locale {
        AppMenuLocale::Zh => "设置...",
        AppMenuLocale::ZhHant => "設定...",
        AppMenuLocale::Ja => "設定...",
        AppMenuLocale::En => "Settings...",
    };
    let settings_menu = SubmenuBuilder::new(app, settings_title)
        .item(&menu_item(
            app,
            "md-editor:settings",
            settings_item_title,
            &shortcut_accelerator("settings.open"),
        )?)
        .build()?;

    let about_desc = match locale {
        AppMenuLocale::Zh => "简洁的本地 Markdown 和 MDX 桌面编辑器",
        AppMenuLocale::ZhHant => "簡潔的本機 Markdown 和 MDX 桌面編輯器",
        AppMenuLocale::Ja => {
            "洗練されたローカルファーストの Markdown および MDX デスクトップエディタ"
        }
        AppMenuLocale::En => "A sleek, local-first Markdown and MDX desktop editor",
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

/// 设置驱动的菜单加速键：`(settings 快捷键 id, 内联默认值)`。
///
/// 仅在 macOS 编译：原生菜单本体（`build_app_menu`）与 `menu_accelerator_for_shortcut`
/// 均为 `cfg(target_os = "macos")`，故本表与两个取用函数一并按平台门控，
/// 否则在 Linux/Windows 构建里会成为未使用项而被 `-D warnings` 判错（CI 实测）。
/// 碰撞守卫测试同样限 macOS —— 加速键只在 macOS 菜单上真实生效。
///
/// **id 必须与 JS 侧真实快捷键/命令 id 同名**（如 `view.toggleSource` ↔ `defaults.ts` 行 id），
/// 否则 `settings::shortcut_key` 永远命中不到用户配置、只能走内联默认值（曾经的缺陷：
/// 用了 `view.focusMode` 而真实 id 是 `view.toggleFocusMode`）。
///
/// ⚠️ **碰撞判定必须大小写不敏感**：muda 解析加速键时对键名做 `to_uppercase()`
///（`muda/src/accelerator.rs` 的 `parse_code`，`"KEYT" | "T" => KeyT`），
/// 故 `Mod-Alt-T` 与 `Mod-Alt-t` 是**同一个** OS 级加速键，不能靠大小写区分。
/// 该表由 `menu_accelerator_collision_tests` 锁定两两不同。
#[cfg(target_os = "macos")]
const MENU_ACCELERATOR_SHORTCUTS: &[(&str, &str)] = &[
    ("table.insert", "Mod-Alt-T"),
    ("view.toggleSource", "Mod-/"),
    ("view.toggleSidebarPrimary", "Mod-Shift-B"),
    ("view.toggleFocusMode", "Mod-Alt-f"),
    ("view.toggleTypewriterMode", "Mod-Alt-y"),
    ("settings.open", "Mod-,"),
];

/// 取某菜单项的加速键：设置里若有同 id 配置则用用户键，否则用表内默认值。
/// 未登记 id 直接 panic（程序错误应当显式失败，不静默产出空加速键）。
#[cfg(target_os = "macos")]
fn shortcut_accelerator(id: &str) -> String {
    let fallback = MENU_ACCELERATOR_SHORTCUTS
        .iter()
        .find(|(candidate, _)| *candidate == id)
        .map(|(_, fallback)| *fallback)
        .unwrap_or_else(|| panic!("menu accelerator table is missing shortcut id: {id}"));
    menu_accelerator_for_shortcut(&settings::shortcut_key(id, fallback))
}
