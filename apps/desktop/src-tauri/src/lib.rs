use tauri::Emitter;

mod app_menu;
mod file_commands;
mod local_ai_completion;
mod local_ai_model;
mod local_ai_runtime;
mod recent_files;
mod settings;
mod settings_window;

use app_menu::MENU_ACTION_EVENT;
use app_menu::{build_app_menu, save_app_settings_and_update_menu, update_recent_files_menu};
use file_commands::{
    copy_file_tree_path, create_markdown_tree_item, delete_markdown_tree_item, inspect_linked_file,
    open_external_target, open_markdown_document, open_markdown_document_at_path,
    open_markdown_folder, pick_theme_css_file, read_theme_css_file, refresh_markdown_folder,
    rename_markdown_tree_item, reveal_file_tree_item_in_finder, save_markdown_document,
    save_pasted_image, show_file_tree_context_menu,
};
use local_ai_completion::request_local_ai_continuation;
use local_ai_model::{
    cancel_local_ai_model_download, delete_local_ai_model, download_local_ai_model,
    get_local_ai_model_status,
};
use recent_files::{load_recent_files, save_recent_files};
use settings::load_app_settings;
use settings_window::{close_settings_window, open_settings_window};

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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(local_ai_runtime::LocalAiRuntimeState::default())
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
            pick_theme_css_file,
            read_theme_css_file,
            show_file_tree_context_menu,
            copy_file_tree_path,
            reveal_file_tree_item_in_finder,
            load_recent_files,
            load_app_settings,
            get_local_ai_model_status,
            download_local_ai_model,
            cancel_local_ai_model_download,
            delete_local_ai_model,
            request_local_ai_continuation,
            open_settings_window,
            close_settings_window,
            save_app_settings_and_update_menu,
            inspect_linked_file,
            open_external_target
        ])
        .run(tauri::generate_context!())
        .expect("error while running Markdown Editor");
}
