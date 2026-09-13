use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use crate::window_chrome::{APP_MAIN_TRAFFIC_LIGHT_LEFT, APP_MAIN_TRAFFIC_LIGHT_VERTICAL_INSET};

const SETTINGS_WINDOW_LABEL: &str = "settings";
const SETTINGS_WINDOW_STARTS_VISIBLE: bool = false;
// 设置窗口必须等待前端主题应用完成后再显示，避免暴露 WebView 的白色首帧。
const _: () = assert!(!SETTINGS_WINDOW_STARTS_VISIBLE);
#[cfg(target_os = "macos")]
const SETTINGS_TRAFFIC_LIGHT_HORIZONTAL_COMPENSATION: f64 = -7.0;
#[cfg(target_os = "macos")]
const SETTINGS_TRAFFIC_LIGHT_VERTICAL_COMPENSATION: f64 = 5.0;
#[cfg(target_os = "macos")]
const SETTINGS_TRAFFIC_LIGHT_LEFT: f64 =
    APP_MAIN_TRAFFIC_LIGHT_LEFT + SETTINGS_TRAFFIC_LIGHT_HORIZONTAL_COMPENSATION;
#[cfg(target_os = "macos")]
const SETTINGS_TRAFFIC_LIGHT_VERTICAL_INSET: f64 =
    APP_MAIN_TRAFFIC_LIGHT_VERTICAL_INSET + SETTINGS_TRAFFIC_LIGHT_VERTICAL_COMPENSATION;

#[tauri::command]
pub(crate) async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    // 设置必须是单例窗口：菜单、快捷键和主窗口按钮都可能同时触发打开动作。
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        match window.is_visible() {
            Ok(true) => {
                if window.is_minimized().unwrap_or(false) {
                    let _ = window.unminimize();
                }
                let _ = window.show();
                let _ = window.set_focus();
                return Ok(());
            }
            Ok(false) => {
                // 如果窗口已存在但不可见（可能正处于初次渲染或被隐藏），尝试重新展示并聚焦
                let _ = window.show();
                let _ = window.set_focus();
                return Ok(());
            }
            Err(_) => {
                // 原窗口 handle 已失效或处于销毁中，清理并重新构建
                let _ = window.destroy();
            }
        }
    }

    let build_window = |app: &tauri::AppHandle| {
        #[allow(unused_mut)]
        let mut builder = WebviewWindowBuilder::new(
            app,
            SETTINGS_WINDOW_LABEL,
            WebviewUrl::App("index.html?window=settings".into()),
        )
        // 设置窗口是桌面偏好设置面板，不占用主编辑器布局，也不绑定主窗口文件菜单行为。
        .title("设置")
        .inner_size(840.0, 620.0)
        .min_inner_size(680.0, 460.0)
        .visible(SETTINGS_WINDOW_STARTS_VISIBLE)
        .center()
        .resizable(true);

        #[cfg(target_os = "macos")]
        {
            builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(tauri::LogicalPosition::new(
                    SETTINGS_TRAFFIC_LIGHT_LEFT,
                    SETTINGS_TRAFFIC_LIGHT_VERTICAL_INSET,
                ));
        }

        builder.build()
    };

    match build_window(&app) {
        Ok(_) => Ok(()),
        Err(error) => {
            // 如果因上一窗口异步销毁延迟导致重名报错，尝试销毁旧句柄并重试一次
            if let Some(existing) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
                let _ = existing.destroy();
                std::thread::sleep(std::time::Duration::from_millis(150));
                build_window(&app).map_err(tauri_error_to_string)?;
                Ok(())
            } else {
                Err(tauri_error_to_string(error))
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn close_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    // 取消按钮从前端走命令关闭设置窗口，避免 JS window.close 受能力配置或窗口上下文差异影响。
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        let _ = window.close();
    }

    Ok(())
}

fn tauri_error_to_string(error: tauri::Error) -> String {
    error.to_string()
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn dynamic_settings_window_tracks_main_window_traffic_light_baseline() {
        let config: Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid tauri config");
        let main_window = config
            .pointer("/app/windows/0")
            .expect("main window config exists");

        assert_eq!(
            main_window
                .pointer("/trafficLightPosition/x")
                .and_then(Value::as_f64),
            Some(APP_MAIN_TRAFFIC_LIGHT_LEFT)
        );
        assert_eq!(
            main_window
                .pointer("/trafficLightPosition/y")
                .and_then(Value::as_f64),
            Some(APP_MAIN_TRAFFIC_LIGHT_VERTICAL_INSET)
        );
        assert_eq!(
            SETTINGS_TRAFFIC_LIGHT_VERTICAL_INSET,
            APP_MAIN_TRAFFIC_LIGHT_VERTICAL_INSET + SETTINGS_TRAFFIC_LIGHT_VERTICAL_COMPENSATION
        );
        assert_eq!(
            SETTINGS_TRAFFIC_LIGHT_LEFT,
            APP_MAIN_TRAFFIC_LIGHT_LEFT + SETTINGS_TRAFFIC_LIGHT_HORIZONTAL_COMPENSATION
        );
    }
}
