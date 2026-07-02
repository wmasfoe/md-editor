# macOS 窗口 Chrome 规范

用途：约束 Tauri macOS 窗口的 Overlay 标题栏、原生 traffic lights 位置和前端拖拽区域，避免主窗口、设置窗口和后续新窗口出现细节不一致。

## 统一规则

- macOS 窗口如果使用 `TitleBarStyle::Overlay` 或 `titleBarStyle: "Overlay"`，必须使用同一套 traffic-light 位置。
- 统一基准是主窗口视觉位置；新增窗口不要按自己的标题栏高度重新推导坐标。
- 主窗口配置参数：
  - traffic-light 左侧 inset：`16px`
  - traffic-light 垂直 inset：`13px`
- 动态设置窗口参数：
  - traffic-light 左侧 inset：`9px`
  - traffic-light 垂直 inset：`18px`
  - `9px = 主窗口 16px + 动态窗口水平补偿 -7px`
  - `18px = 主窗口 13px + 动态窗口垂直补偿 5px`
- 这里的 `y` 不是普通 CSS 顶部坐标。Tauri/Wry 会把它作为 `traffic_light_inset` 处理；同一个 y 值在 `tauri.conf.json` 主窗口和 Rust 动态 `WebviewWindowBuilder` 创建的窗口里可能呈现出不同视觉位置。
- 不要用 `(标题栏高度 - 按钮尺寸) / 2` 这类公式重新计算。实际目标是让新窗口和主窗口的红黄绿按钮视觉对齐。
- 前端自绘标题栏继续优先复用 `AppTitleBar`，但原生按钮位置以主窗口 `trafficLightPosition` 为准。
- 设置窗口等动态创建窗口，必须显式记录相对主窗口的补偿值，并用测试锁住主窗口基线。

## 修改入口

- 主窗口：`apps/desktop/src-tauri/tauri.conf.json` 的 `app.windows[0].trafficLightPosition`。
- 动态设置窗口：`apps/desktop/src-tauri/src/settings_window.rs` 的 `APP_MAIN_TRAFFIC_LIGHT_LEFT`、`APP_MAIN_TRAFFIC_LIGHT_VERTICAL_INSET`、`SETTINGS_TRAFFIC_LIGHT_HORIZONTAL_COMPENSATION` 和 `SETTINGS_TRAFFIC_LIGHT_VERTICAL_COMPENSATION`。
- 一致性保护：`settings_window.rs` 里的 `dynamic_settings_window_tracks_main_window_traffic_light_baseline` 测试会校验动态窗口仍以主窗口配置为基线。

## 新增窗口时

1. 如果窗口使用系统默认标题栏，不需要套用本规范。
2. 如果窗口使用 overlay 标题栏，先确认是否能复用 `AppTitleBar`。
3. 如果是 `tauri.conf.json` 里的主窗口式配置，使用 `x=16`、`y=13`。
4. 如果是 Rust 动态 `WebviewWindowBuilder`，先从 `x=9`、`y=18` 开始，并用主窗口截图视觉对齐。
5. 给标题栏或非交互 header 区域保留可靠拖拽行为。
6. 修改后至少运行：
   - `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`
   - `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml settings_window`
