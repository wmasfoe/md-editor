use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::app_menu::{detect_menu_locale, AppMenuLocale};
#[cfg(target_os = "macos")]
use crate::window_chrome::{APP_MAIN_TRAFFIC_LIGHT_LEFT, APP_MAIN_TRAFFIC_LIGHT_VERTICAL_INSET};

const ABOUT_WINDOW_LABEL: &str = "about";
const ABOUT_WINDOW_STARTS_VISIBLE: bool = false;
// 关于窗口与设置窗口一样，必须等待前端主题应用完成后再显示，避免暴露 WebView 的白色首帧。
const _: () = assert!(!ABOUT_WINDOW_STARTS_VISIBLE);
// 关于窗口内容固定、无需拉伸；尺寸按内容一次定死，避免出现可拖拽却无信息增量的空白。
const ABOUT_WINDOW_WIDTH: f64 = 460.0;
const ABOUT_WINDOW_HEIGHT: f64 = 560.0;
#[cfg(target_os = "macos")]
const ABOUT_TRAFFIC_LIGHT_HORIZONTAL_COMPENSATION: f64 = -7.0;
#[cfg(target_os = "macos")]
const ABOUT_TRAFFIC_LIGHT_VERTICAL_COMPENSATION: f64 = 5.0;
#[cfg(target_os = "macos")]
const ABOUT_TRAFFIC_LIGHT_LEFT: f64 =
    APP_MAIN_TRAFFIC_LIGHT_LEFT + ABOUT_TRAFFIC_LIGHT_HORIZONTAL_COMPENSATION;
#[cfg(target_os = "macos")]
const ABOUT_TRAFFIC_LIGHT_VERTICAL_INSET: f64 =
    APP_MAIN_TRAFFIC_LIGHT_VERTICAL_INSET + ABOUT_TRAFFIC_LIGHT_VERTICAL_COMPENSATION;

/// 关于窗口标题随界面语言切换，与原生菜单共用同一套本地化判断。
fn about_window_title(locale: AppMenuLocale) -> &'static str {
    match locale {
        AppMenuLocale::Zh => "关于 Inkpoint",
        AppMenuLocale::ZhHant => "關於 Inkpoint",
        AppMenuLocale::Ja => "Inkpoint について",
        AppMenuLocale::En => "About Inkpoint",
    }
}

/// 打开（或聚焦）单例关于窗口。
/// 菜单项、命令面板与设置入口都走这一个入口，避免出现第二个「关于」窗口。
#[tauri::command]
pub(crate) async fn open_about_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(ABOUT_WINDOW_LABEL) {
        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
        }
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let build_window = |app: &tauri::AppHandle| {
        #[allow(unused_mut)]
        let mut builder = WebviewWindowBuilder::new(
            app,
            ABOUT_WINDOW_LABEL,
            WebviewUrl::App("index.html?window=about".into()),
        )
        .title(about_window_title(detect_menu_locale()))
        .inner_size(ABOUT_WINDOW_WIDTH, ABOUT_WINDOW_HEIGHT)
        .visible(ABOUT_WINDOW_STARTS_VISIBLE)
        .center()
        .resizable(false)
        .maximizable(false)
        .minimizable(false);

        #[cfg(target_os = "macos")]
        {
            builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(tauri::LogicalPosition::new(
                    ABOUT_TRAFFIC_LIGHT_LEFT,
                    ABOUT_TRAFFIC_LIGHT_VERTICAL_INSET,
                ));
        }

        builder.build()
    };

    match build_window(&app) {
        Ok(_) => Ok(()),
        Err(error) => {
            // 上一窗口异步销毁尚未完成时会出现重名报错，销毁旧句柄后重试一次。
            if let Some(existing) = app.get_webview_window(ABOUT_WINDOW_LABEL) {
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

fn tauri_error_to_string(error: tauri::Error) -> String {
    error.to_string()
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn about_window_tracks_main_window_traffic_light_baseline() {
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
            ABOUT_TRAFFIC_LIGHT_VERTICAL_INSET,
            APP_MAIN_TRAFFIC_LIGHT_VERTICAL_INSET + ABOUT_TRAFFIC_LIGHT_VERTICAL_COMPENSATION
        );
        assert_eq!(
            ABOUT_TRAFFIC_LIGHT_LEFT,
            APP_MAIN_TRAFFIC_LIGHT_LEFT + ABOUT_TRAFFIC_LIGHT_HORIZONTAL_COMPENSATION
        );
    }
}
