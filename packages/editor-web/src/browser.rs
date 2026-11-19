use std::{borrow::Cow, cell::RefCell, rc::Rc, sync::Arc};

use gpui_kit::{
    assets::Assets,
    web::{CanvasFontFallback, WebBackendPreference, WebPlatform},
    *,
};
use inkpoint_editor_gpui::EditorView;
use wasm_bindgen::prelude::*;

thread_local! {
    static APPLICATION: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
    static EDITOR: RefCell<Option<(AnyWindowHandle, Entity<EditorView>)>> = const { RefCell::new(None) };
}

#[wasm_bindgen]
pub fn run(
    initial_markdown: Option<String>,
    asset_base_path: Option<String>,
) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    gpui_kit::platform::web_init();

    let platform = Rc::new(WebPlatform::new_with_backend_and_font_fallback(
        false,
        WebBackendPreference::Auto,
        CanvasFontFallback::EmojiAndCjk,
    ));
    let http_client = Arc::new(platform.fetch_http_client());
    let application = Application::with_platform(platform)
        .with_http_client(http_client)
        .with_assets(Assets::new(
            asset_base_path.unwrap_or_else(|| "/playground/".to_owned()),
        ));

    APPLICATION.with(|handle| {
        *handle.borrow_mut() = Some(application.run_embedded(move |cx| {
            gpui_kit::init(cx);
            gpui_kit::component::Theme::update(cx, |theme| {
                theme.font_family = "Inter".into();
                theme.mono_font_family = "Fira Mono".into();
            });
            load_fonts(cx);
            let initial_markdown = initial_markdown.unwrap_or_default();
            let window = WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    size(px(1100.), px(760.)),
                    cx,
                ))),
                ..Default::default()
            };
            let (window, editor) = gpui_kit::open_window(window, cx, |window, cx| {
                cx.new(|cx| EditorView::new(window, cx, &initial_markdown))
            })
            .expect("open GPUI Playground window");
            EDITOR.with(|current| *current.borrow_mut() = Some((window, editor)));
            cx.activate(true);
        }));
    });

    Ok(())
}

#[wasm_bindgen]
pub fn get_markdown() -> Result<String, JsValue> {
    with_editor(|application, _, editor| {
        Ok(application.update(|cx| cx.read_entity(editor, |editor, cx| editor.markdown(cx))))
    })
}

#[wasm_bindgen]
pub fn get_revision() -> Result<u64, JsValue> {
    with_editor(|application, _, editor| {
        Ok(application.update(|cx| cx.read_entity(editor, |editor, _| editor.revision())))
    })
}

#[wasm_bindgen]
pub fn set_markdown(markdown: String) -> Result<(), JsValue> {
    with_editor(|application, window, editor| {
        application.update(|cx| {
            cx.update_window(*window, |_, window, cx| {
                editor.update(cx, |editor, cx| {
                    editor.replace_markdown(&markdown, window, cx)
                })
            })
            .map_err(|error| JsValue::from_str(&error.to_string()))
        })
    })
}

#[wasm_bindgen]
pub fn set_readonly(readonly: bool) -> Result<(), JsValue> {
    with_editor(|application, window, editor| {
        application.update(|cx| {
            cx.update_window(*window, |_, _, cx| {
                editor.update(cx, |editor, cx| editor.set_readonly(readonly, cx))
            })
            .map_err(|error| JsValue::from_str(&error.to_string()))
        })
    })
}

/// 把当前 Markdown 写入系统剪贴板。
///
/// 浏览器宿主无需再手写 `navigator.clipboard.writeText`：`gpui-pre-web` 的
/// `Platform::write_to_clipboard` 已经封装了 `navigator.clipboard.write_text`，
/// 并且与桌面端走同一条路径。注意浏览器要求调用发生在用户激活（点击）
/// 的同步栈内，所以 JS 侧应在 click 处理函数里直接调用本函数，不要先 await。
#[wasm_bindgen]
pub fn copy_markdown() -> Result<(), JsValue> {
    with_editor(|application, _, editor| {
        application.update(|cx| {
            let markdown = cx.read_entity(editor, |editor, cx| editor.markdown(cx));
            cx.write_to_clipboard(ClipboardItem::new_string(markdown));
            Ok(())
        })
    })
}

fn with_editor<R>(
    f: impl FnOnce(&ApplicationHandle, &AnyWindowHandle, &Entity<EditorView>) -> Result<R, JsValue>,
) -> Result<R, JsValue> {
    APPLICATION.with(|application| {
        let application = application.borrow();
        let application = application
            .as_ref()
            .ok_or_else(|| JsValue::from_str("GPUI Playground has not been started"))?;
        EDITOR.with(|editor| {
            let editor = editor.borrow();
            let (window, editor) = editor
                .as_ref()
                .ok_or_else(|| JsValue::from_str("GPUI editor has not been mounted"))?;
            f(application, window, editor)
        })
    })
}

fn load_fonts(cx: &mut App) {
    let fonts = vec![
        Cow::Borrowed(include_bytes!("../assets/Inter-Regular.ttf").as_slice()),
        Cow::Borrowed(include_bytes!("../assets/FiraMono-Medium.ttf").as_slice()),
        Cow::Borrowed(include_bytes!("../assets/NotoSans-Regular.ttf").as_slice()),
    ];
    cx.text_system()
        .add_fonts(fonts)
        .expect("load GPUI Web fonts");
}
