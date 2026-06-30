use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const SETTINGS_WINDOW_LABEL: &str = "settings";

#[tauri::command]
pub(crate) async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    // 设置必须是单例窗口：菜单、快捷键和主窗口按钮都可能同时触发打开动作。
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        window.show().map_err(tauri_error_to_string)?;
        if window.is_minimized().unwrap_or(false) {
            window.unminimize().map_err(tauri_error_to_string)?;
        }
        return window.set_focus().map_err(tauri_error_to_string);
    }

    let mut builder = WebviewWindowBuilder::new(
        &app,
        SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("index.html?window=settings".into()),
    )
    // 设置窗口是桌面偏好设置面板，不占用主编辑器布局，也不绑定主窗口文件菜单行为。
    .title("设置")
    .inner_size(840.0, 620.0)
    .min_inner_size(680.0, 460.0)
    .center()
    .resizable(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 13.0));
    }

    builder.build().map_err(tauri_error_to_string)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn close_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    // 取消按钮从前端走命令关闭设置窗口，避免 JS window.close 受能力配置或窗口上下文差异影响。
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        window.close().map_err(tauri_error_to_string)?;
    }

    Ok(())
}

fn tauri_error_to_string(error: tauri::Error) -> String {
    error.to_string()
}
