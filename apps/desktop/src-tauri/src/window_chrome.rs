#[cfg(target_os = "macos")]
use std::{ffi::c_void, fmt, ptr::NonNull, sync::Mutex, thread, time::Duration};

#[cfg(target_os = "macos")]
use block2::{DynBlock, RcBlock};
#[cfg(target_os = "macos")]
use objc2::{
    rc::Retained,
    runtime::{AnyObject, NSObjectProtocol, ProtocolObject},
};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSView, NSWindow, NSWindowButton, NSWindowDidEndLiveResizeNotification};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSNotification, NSNotificationCenter};
#[cfg(target_os = "macos")]
use tauri::Manager;

#[cfg(target_os = "macos")]
use crate::platform_contract::MAIN_WINDOW_LABEL;

#[cfg(target_os = "macos")]
pub(crate) const APP_MAIN_TRAFFIC_LIGHT_LEFT: f64 = 16.0;
#[cfg(target_os = "macos")]
pub(crate) const APP_MAIN_TRAFFIC_LIGHT_VERTICAL_INSET: f64 = 13.0;
#[cfg(target_os = "macos")]
const MAIN_TRAFFIC_LIGHT_LAYOUT_HORIZONTAL_COMPENSATION: f64 = -7.0;
#[cfg(target_os = "macos")]
const MAIN_TRAFFIC_LIGHT_LAYOUT_VERTICAL_COMPENSATION: f64 = 5.0;
#[cfg(target_os = "macos")]
const MAIN_TRAFFIC_LIGHT_LAYOUT_LEFT: f64 =
    APP_MAIN_TRAFFIC_LIGHT_LEFT + MAIN_TRAFFIC_LIGHT_LAYOUT_HORIZONTAL_COMPENSATION;
#[cfg(target_os = "macos")]
const MAIN_TRAFFIC_LIGHT_LAYOUT_VERTICAL_INSET: f64 =
    APP_MAIN_TRAFFIC_LIGHT_VERTICAL_INSET + MAIN_TRAFFIC_LIGHT_LAYOUT_VERTICAL_COMPENSATION;
#[cfg(target_os = "macos")]
const STARTUP_TRAFFIC_LIGHT_REFRESH_DELAYS_MS: [u64; 3] = [0, 120, 360];
#[cfg(target_os = "macos")]
const SCALE_FACTOR_TRAFFIC_LIGHT_REFRESH_DELAY_MS: u64 = 120;

#[cfg(target_os = "macos")]
#[derive(Default)]
pub(crate) struct MainWindowTrafficLightObserverState {
    live_resize_observer: Mutex<Option<LiveResizeTrafficLightObserver>>,
}

#[cfg(target_os = "macos")]
pub(crate) fn install_initial_main_window_traffic_light_refresh<R: tauri::Runtime + 'static>(
    app: &tauri::AppHandle<R>,
) {
    app.manage(MainWindowTrafficLightObserverState::default());

    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        eprintln!(
            "Failed to install macOS traffic-light refresh: main webview window was not found"
        );
        return;
    };

    install_main_window_live_resize_observer(app, &window);

    // `pnpm tauri dev` 刚启动时，页面首帧绘制前可能先露出 AppKit 默认按钮位置。
    // 这里先用配置基线修正一次，再覆盖早期 Tao/Wry titlebar layout 可能产生的回写。
    for delay_ms in STARTUP_TRAFFIC_LIGHT_REFRESH_DELAYS_MS {
        schedule_traffic_light_position_refresh::<R, _>(
            window.clone(),
            Duration::from_millis(delay_ms),
            TrafficLightPosition::configured_main_window(),
        );
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn refresh_main_window_traffic_lights_after_layout_event<R: tauri::Runtime + 'static>(
    window: &tauri::Window<R>,
    event: &tauri::WindowEvent,
) {
    if !should_refresh_main_window_traffic_lights(window.label(), event) {
        return;
    }

    let window = window.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(
            SCALE_FACTOR_TRAFFIC_LIGHT_REFRESH_DELAY_MS,
        ));
        apply_traffic_light_position(&window, TrafficLightPosition::layout_repaired_main_window());
    });
}

#[cfg(target_os = "macos")]
fn install_main_window_live_resize_observer<R: tauri::Runtime + 'static>(
    app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) {
    let state = app.state::<MainWindowTrafficLightObserverState>();
    let mut live_resize_observer = state
        .live_resize_observer
        .lock()
        .expect("traffic-light observer mutex should not be poisoned");

    if live_resize_observer.is_some() {
        return;
    }

    match create_main_window_live_resize_observer(window.clone()) {
        Ok(observer) => {
            live_resize_observer.replace(observer);
        }
        Err(error) => {
            eprintln!("Failed to install macOS live-resize traffic-light observer: {error}");
        }
    }
}

#[cfg(target_os = "macos")]
fn create_main_window_live_resize_observer<R: tauri::Runtime + 'static>(
    window: tauri::WebviewWindow<R>,
) -> Result<LiveResizeTrafficLightObserver, String> {
    let ns_window = window
        .ns_window()
        .map_err(|error| format!("failed to get main NSWindow: {error}"))?;
    let ns_window = unsafe { ns_window.cast::<NSWindow>().as_ref() }
        .ok_or_else(|| "main NSWindow pointer is null".to_string())?;
    let ns_window_object: &AnyObject = ns_window.as_ref();
    let center = NSNotificationCenter::defaultCenter();
    let callback_window = window.clone();
    let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        apply_traffic_light_position(
            &callback_window,
            TrafficLightPosition::layout_repaired_main_window(),
        );
    });
    let block: &DynBlock<dyn Fn(NonNull<NSNotification>)> = &block;

    // 只监听主窗口对应的 NSWindow，避免影响设置窗口。
    // 设置窗口的动态创建路径在 live resize 期间已经能稳定保持 traffic-light inset。
    let observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(NSWindowDidEndLiveResizeNotification),
            Some(ns_window_object),
            None,
            block,
        )
    };

    Ok(LiveResizeTrafficLightObserver { observer })
}

#[cfg(target_os = "macos")]
struct LiveResizeTrafficLightObserver {
    observer: Retained<ProtocolObject<dyn NSObjectProtocol>>,
}

// SAFETY: 这里持有的 retained object 只作为通知 observer token 使用。
// AppKit frame 修改仍然通过 `run_on_main_thread` 回到主线程执行。
#[cfg(target_os = "macos")]
unsafe impl Send for LiveResizeTrafficLightObserver {}
#[cfg(target_os = "macos")]
unsafe impl Sync for LiveResizeTrafficLightObserver {}

#[cfg(target_os = "macos")]
impl Drop for LiveResizeTrafficLightObserver {
    fn drop(&mut self) {
        let center = NSNotificationCenter::defaultCenter();
        let observer: &AnyObject = self.observer.as_ref();
        unsafe {
            center.removeObserver(observer);
        }
    }
}

#[cfg(target_os = "macos")]
fn schedule_traffic_light_position_refresh<R, W>(
    window: W,
    delay: Duration,
    position: TrafficLightPosition,
) where
    R: tauri::Runtime + 'static,
    W: NativeMacWindow<R>,
{
    thread::spawn(move || {
        if !delay.is_zero() {
            thread::sleep(delay);
        }
        apply_traffic_light_position(&window, position);
    });
}

#[cfg(target_os = "macos")]
fn apply_traffic_light_position<R, W>(window: &W, position: TrafficLightPosition)
where
    R: tauri::Runtime,
    W: NativeMacWindow<R>,
{
    let label = window.window_label().to_string();
    let window_for_main_thread = window.clone();
    let label_for_main_thread = label.clone();

    let result = window.run_on_main_thread(move || {
        let ns_window = match window_for_main_thread.ns_window() {
            Ok(ns_window) => ns_window,
            Err(error) => {
                eprintln!(
                    "Failed to get native NSWindow for traffic-light refresh on {label_for_main_thread}: {error}"
                );
                return;
            }
        };

        // SAFETY: `run_on_main_thread` 保证 AppKit 访问发生在主线程；
        // Tauri 返回的是当前窗口背后的 live NSWindow。
        if let Err(error) = unsafe {
            apply_traffic_light_position_to_ns_window(ns_window, position)
        } {
            eprintln!(
                "Failed to apply macOS traffic-light position on {label_for_main_thread}: {error}"
            );
        }
    });

    if let Err(error) = result {
        eprintln!("Failed to queue macOS traffic-light refresh on {label}: {error}");
    }
}

#[cfg(target_os = "macos")]
trait NativeMacWindow<R: tauri::Runtime>: Clone + Send + 'static {
    fn window_label(&self) -> &str;
    fn run_on_main_thread<F: FnOnce() + Send + 'static>(&self, f: F) -> tauri::Result<()>;
    fn ns_window(&self) -> tauri::Result<*mut c_void>;
}

#[cfg(target_os = "macos")]
impl<R: tauri::Runtime + 'static> NativeMacWindow<R> for tauri::Window<R> {
    fn window_label(&self) -> &str {
        self.label()
    }

    fn run_on_main_thread<F: FnOnce() + Send + 'static>(&self, f: F) -> tauri::Result<()> {
        self.run_on_main_thread(f)
    }

    fn ns_window(&self) -> tauri::Result<*mut c_void> {
        self.ns_window()
    }
}

#[cfg(target_os = "macos")]
impl<R: tauri::Runtime + 'static> NativeMacWindow<R> for tauri::WebviewWindow<R> {
    fn window_label(&self) -> &str {
        self.label()
    }

    fn run_on_main_thread<F: FnOnce() + Send + 'static>(&self, f: F) -> tauri::Result<()> {
        self.run_on_main_thread(f)
    }

    fn ns_window(&self) -> tauri::Result<*mut c_void> {
        self.ns_window()
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, PartialEq)]
struct TrafficLightPosition {
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
impl TrafficLightPosition {
    const fn configured_main_window() -> Self {
        Self {
            x: APP_MAIN_TRAFFIC_LIGHT_LEFT,
            y: APP_MAIN_TRAFFIC_LIGHT_VERTICAL_INSET,
        }
    }

    const fn layout_repaired_main_window() -> Self {
        // 主窗口 resize 是目前唯一会偏离启动/配置坐标系的路径。
        // 配置基线保持不变，只在 AppKit/Tao/Wry 完成 live resize 后，
        // 针对原生标题栏按钮被推向右上方的问题做一次补偿。
        Self {
            x: MAIN_TRAFFIC_LIGHT_LAYOUT_LEFT,
            y: MAIN_TRAFFIC_LIGHT_LAYOUT_VERTICAL_INSET,
        }
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, PartialEq)]
struct TrafficLightFrameInputs {
    window_height: f64,
    close_button_x: f64,
    close_button_height: f64,
    miniaturize_button_x: f64,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, PartialEq)]
struct TrafficLightFrameUpdate {
    title_bar_origin_y: f64,
    title_bar_height: f64,
    button_x_positions: [f64; 3],
}

#[cfg(target_os = "macos")]
fn calculate_traffic_light_frame_update(
    position: TrafficLightPosition,
    inputs: TrafficLightFrameInputs,
) -> Result<TrafficLightFrameUpdate, TrafficLightPositionError> {
    let button_spacing = inputs.miniaturize_button_x - inputs.close_button_x;
    if !button_spacing.is_finite() || button_spacing <= 0.0 {
        return Err(TrafficLightPositionError::InvalidButtonSpacing {
            close_x: inputs.close_button_x,
            miniaturize_x: inputs.miniaturize_button_x,
        });
    }

    let title_bar_height = inputs.close_button_height + position.y;
    if !title_bar_height.is_finite() || title_bar_height <= 0.0 {
        return Err(TrafficLightPositionError::InvalidTitleBarHeight {
            close_height: inputs.close_button_height,
            vertical_inset: position.y,
        });
    }

    Ok(TrafficLightFrameUpdate {
        title_bar_origin_y: inputs.window_height - title_bar_height,
        title_bar_height,
        button_x_positions: [
            position.x,
            position.x + button_spacing,
            position.x + (2.0 * button_spacing),
        ],
    })
}

#[cfg(target_os = "macos")]
unsafe fn apply_traffic_light_position_to_ns_window(
    ns_window: *mut c_void,
    position: TrafficLightPosition,
) -> Result<(), TrafficLightPositionError> {
    let ns_window = unsafe { ns_window.cast::<NSWindow>().as_ref() }
        .ok_or(TrafficLightPositionError::MissingNativeWindow)?;

    let close = ns_window
        .standardWindowButton(NSWindowButton::CloseButton)
        .ok_or(TrafficLightPositionError::MissingButton("close"))?;
    let miniaturize = ns_window
        .standardWindowButton(NSWindowButton::MiniaturizeButton)
        .ok_or(TrafficLightPositionError::MissingButton("miniaturize"))?;
    let zoom = ns_window
        .standardWindowButton(NSWindowButton::ZoomButton)
        .ok_or(TrafficLightPositionError::MissingButton("zoom"))?;

    // Tao/Wry 会把三个标准按钮放在一层 button row view 里；
    // 这层 view 的父级才是需要随 custom inset 调整高度和 origin 的 titlebar container。
    // 这里复刻 Tao/Wry 的 `inset_traffic_lights` 算法，并把 AppKit bridge 限定在原生窗口按钮视图内。
    let button_row = unsafe { close.superview() }
        .ok_or(TrafficLightPositionError::MissingSuperview("button row"))?;
    let title_bar_container = unsafe { button_row.superview() }.ok_or(
        TrafficLightPositionError::MissingSuperview("titlebar container"),
    )?;

    let close_rect = NSView::frame(&close);
    let miniaturize_rect = NSView::frame(&miniaturize);
    let update = calculate_traffic_light_frame_update(
        position,
        TrafficLightFrameInputs {
            window_height: ns_window.frame().size.height,
            close_button_x: close_rect.origin.x,
            close_button_height: close_rect.size.height,
            miniaturize_button_x: miniaturize_rect.origin.x,
        },
    )?;

    let mut title_bar_rect = NSView::frame(&title_bar_container);
    title_bar_rect.size.height = update.title_bar_height;
    title_bar_rect.origin.y = update.title_bar_origin_y;
    title_bar_container.setFrame(title_bar_rect);

    for (index, button) in [close, miniaturize, zoom].into_iter().enumerate() {
        let mut rect = NSView::frame(&button);
        rect.origin.x = update.button_x_positions[index];
        button.setFrameOrigin(rect.origin);
    }

    Ok(())
}

#[cfg(target_os = "macos")]
#[derive(Debug, PartialEq)]
enum TrafficLightPositionError {
    MissingNativeWindow,
    MissingButton(&'static str),
    MissingSuperview(&'static str),
    InvalidButtonSpacing {
        close_x: f64,
        miniaturize_x: f64,
    },
    InvalidTitleBarHeight {
        close_height: f64,
        vertical_inset: f64,
    },
}

#[cfg(target_os = "macos")]
impl fmt::Display for TrafficLightPositionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingNativeWindow => formatter.write_str("native NSWindow pointer is null"),
            Self::MissingButton(button) => write!(formatter, "missing {button} window button"),
            Self::MissingSuperview(view) => write!(formatter, "missing {view} superview"),
            Self::InvalidButtonSpacing {
                close_x,
                miniaturize_x,
            } => write!(
                formatter,
                "invalid window-button spacing: close x={close_x}, miniaturize x={miniaturize_x}"
            ),
            Self::InvalidTitleBarHeight {
                close_height,
                vertical_inset,
            } => write!(
                formatter,
                "invalid titlebar height: close height={close_height}, vertical inset={vertical_inset}"
            ),
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn should_refresh_main_window_traffic_lights(
    label: &str,
    event: &tauri::WindowEvent,
) -> bool {
    label == MAIN_WINDOW_LABEL && matches!(event, tauri::WindowEvent::ScaleFactorChanged { .. })
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn refresh_guard_only_targets_main_window_layout_events() {
        let resized = tauri::WindowEvent::Resized(tauri::PhysicalSize::new(1120, 760));
        let focused = tauri::WindowEvent::Focused(true);

        assert!(!should_refresh_main_window_traffic_lights(
            MAIN_WINDOW_LABEL,
            &resized
        ));
        assert!(!should_refresh_main_window_traffic_lights(
            "settings", &resized
        ));
        assert!(!should_refresh_main_window_traffic_lights(
            MAIN_WINDOW_LABEL,
            &focused
        ));
    }

    #[test]
    fn frame_update_matches_tao_traffic_light_inset_rules() {
        let update = calculate_traffic_light_frame_update(
            TrafficLightPosition::configured_main_window(),
            TrafficLightFrameInputs {
                window_height: 760.0,
                close_button_x: 12.0,
                close_button_height: 14.0,
                miniaturize_button_x: 32.0,
            },
        )
        .expect("valid button frames");

        assert_eq!(
            update,
            TrafficLightFrameUpdate {
                title_bar_origin_y: 733.0,
                title_bar_height: 27.0,
                button_x_positions: [16.0, 36.0, 56.0],
            }
        );
    }

    #[test]
    fn layout_repair_tracks_observed_post_resize_compensation() {
        assert_eq!(
            TrafficLightPosition::layout_repaired_main_window(),
            TrafficLightPosition {
                x: APP_MAIN_TRAFFIC_LIGHT_LEFT + MAIN_TRAFFIC_LIGHT_LAYOUT_HORIZONTAL_COMPENSATION,
                y: APP_MAIN_TRAFFIC_LIGHT_VERTICAL_INSET
                    + MAIN_TRAFFIC_LIGHT_LAYOUT_VERTICAL_COMPENSATION,
            }
        );
    }

    #[test]
    fn frame_update_rejects_uninitialized_button_spacing() {
        let error = calculate_traffic_light_frame_update(
            TrafficLightPosition::configured_main_window(),
            TrafficLightFrameInputs {
                window_height: 760.0,
                close_button_x: 12.0,
                close_button_height: 14.0,
                miniaturize_button_x: 12.0,
            },
        )
        .expect_err("zero spacing should not be applied");

        assert_eq!(
            error,
            TrafficLightPositionError::InvalidButtonSpacing {
                close_x: 12.0,
                miniaturize_x: 12.0,
            }
        );
    }
}
