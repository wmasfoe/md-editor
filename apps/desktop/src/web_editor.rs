//! WKWebView host for the desktop's existing Markdown editor frontend.
//!
//! The view is created as a child of the GPUI window and is kept behind a
//! small transparent Canvas so GPUI remains responsible for its geometry.

use crate::settings::{self, preferences::Preferences};
use std::{
    borrow::Cow,
    cell::{Cell, RefCell},
    fs,
    ops::Range,
    path::{Path, PathBuf},
    rc::Rc,
};

use futures::{StreamExt, channel::mpsc};
use gpui_kit::{
    App, Bounds, Context, FocusHandle, IntoElement, Render, Subscription, Window, canvas, div,
    prelude::*,
};
use inkpoint_editor_gpui::{EditorCommand, PasteContext};
use serde::{Deserialize, Serialize};
use wry::{
    Rect,
    dpi::{LogicalPosition, LogicalSize},
    http::{Request, Response, header},
};

const EDITOR_ORIGIN: &str = "inkpoint://editor";

pub type MessageHandler = Rc<dyn Fn(HostEvent, &mut Window, &mut App) + 'static>;

#[derive(Clone, Debug)]
pub enum HostEvent {
    Command(HostCommand),
    Link(String),
    PasteImage,
    InsertResult(bool),
    Error(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostCommand {
    New,
    Open,
    OpenFolder,
    Save,
    SaveAs,
    Close,
    Outline,
    LocalAi,
    Settings,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum JsMessage {
    Ready,
    EditorFocus,
    Snapshot {
        generation: u64,
        revision: u64,
        markdown: String,
        from: usize,
        to: usize,
        composing: bool,
        mode: String,
    },
    Command {
        command: String,
    },
    Link {
        url: String,
    },
    PasteImage,
    InsertResult {
        applied: bool,
    },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum NativeMessage<'a> {
    Load {
        generation: u64,
        markdown: &'a str,
        readonly: bool,
        mdx: bool,
    },
    Readonly {
        readonly: bool,
    },
    ToggleMode,
    Settings {
        #[serde(flatten)]
        preferences: &'a Preferences,
    },
    Focus,
    Format {
        id: &'a str,
    },
    Seek {
        line: usize,
    },
    Insert {
        generation: u64,
        revision: u64,
        from: usize,
        to: usize,
        text: &'a str,
    },
}

enum HostMessage {
    Ipc(String),
    Flush(u64, Result<String, String>),
    Event(HostEvent),
}

type FlushCallback = Box<dyn FnOnce(Result<(), String>, &mut Window, &mut App) + 'static>;

/// Native wrapper around the bundled WYSIWYG/source editor.
pub struct WebEditor {
    webview: Rc<RefCell<Option<Rc<wry::WebView>>>>,
    focus_handle: FocusHandle,
    assets: PathBuf,
    document_parent: Option<PathBuf>,
    document_root: Rc<RefCell<Option<PathBuf>>>,
    document_generation: Rc<Cell<u64>>,
    document_path: Option<PathBuf>,
    generation: u64,
    revision: u64,
    renderer_revision: u64,
    markdown: String,
    selection: Range<usize>,
    composing: bool,
    source_mode: bool,
    readonly: bool,
    ready: bool,
    handler: MessageHandler,
    pending_flush: Vec<(u64, FlushCallback)>,
    tx: mpsc::UnboundedSender<HostMessage>,
    _rx_task: gpui_kit::Task<()>,
    _blur: Subscription,
}

impl WebEditor {
    pub fn new(window: &mut Window, cx: &mut Context<Self>, handler: MessageHandler) -> Self {
        let (tx, mut rx) = mpsc::unbounded::<HostMessage>();
        let task = cx.spawn_in(window, async move |this, cx| {
            while let Some(message) = rx.next().await {
                let _ = this.update_in(cx, |this, window, cx| this.receive(message, window, cx));
            }
        });
        let focus_handle = cx.focus_handle();
        let blur = cx.on_blur(&focus_handle, window, |this, window, _| {
            // Deactivating the window also emits a blur, but retains its logical focus.
            if !this.focus_handle.is_focused(window)
                && let Some(view) = this.webview.borrow().as_ref()
            {
                let _ = view.focus_parent();
            }
        });
        Self {
            webview: Rc::new(RefCell::new(None)),
            focus_handle,
            assets: editor_assets_dir(),
            document_parent: None,
            document_root: Rc::new(RefCell::new(None)),
            document_generation: Rc::new(Cell::new(0)),
            document_path: None,
            generation: 0,
            revision: 0,
            renderer_revision: 0,
            markdown: String::new(),
            selection: 0..0,
            composing: false,
            source_mode: false,
            readonly: false,
            ready: false,
            handler,
            pending_flush: Vec::new(),
            tx,
            _rx_task: task,
            _blur: blur,
        }
    }

    pub fn markdown(&self, _cx: &App) -> String {
        self.markdown.clone()
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn selected_range(&self, _cx: &App) -> Range<usize> {
        self.selection.clone()
    }
    pub fn composing(&self) -> bool {
        self.composing
    }
    pub fn source_mode(&self) -> bool {
        self.source_mode
    }

    pub fn focus(&self, window: &mut Window, cx: &mut Context<Self>) {
        // GPUI resolves key bindings using its own focus path, independently of AppKit.
        self.focus_handle.focus(window, cx);
        if let Some(view) = self.webview.borrow().as_ref() {
            let _ = view.focus();
        }
        self.send(&NativeMessage::Focus);
    }

    /// Replace content with a new document generation and remember its image root.
    pub fn replace_markdown(
        &mut self,
        markdown: &str,
        path: Option<&Path>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
        self.generation = self.generation.wrapping_add(1);
        self.document_generation.set(self.generation);
        self.revision = self.revision.wrapping_add(1);
        self.markdown = markdown.to_owned();
        self.selection = 0..0;
        self.composing = false;
        self.document_parent = path.and_then(Path::parent).map(Path::to_path_buf);
        *self.document_root.borrow_mut() = self.document_parent.clone();
        self.document_path = path.map(Path::to_path_buf);
        if self.ready {
            self.load_document();
        }
    }

    /// Update the image base after Save As without disturbing editor contents or undo history.
    pub fn set_document_path(&mut self, path: Option<&Path>) {
        self.document_parent = path.and_then(Path::parent).map(Path::to_path_buf);
        *self.document_root.borrow_mut() = self.document_parent.clone();
        self.document_path = path.map(Path::to_path_buf);
    }

    pub fn set_readonly(&mut self, readonly: bool, _cx: &mut Context<Self>) {
        self.readonly = readonly;
        if self.ready {
            self.send(&NativeMessage::Readonly { readonly });
        }
    }

    pub(crate) fn apply_preferences(&self, preferences: &Preferences) {
        if self.ready {
            self.send(&NativeMessage::Settings { preferences });
        }
    }

    pub fn execute_command(
        &mut self,
        command: EditorCommand,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) {
        match command {
            EditorCommand::ToggleSourceMode
            | EditorCommand::ShowSource
            | EditorCommand::ShowBlockEditor => {
                let should_source = command == EditorCommand::ShowSource;
                if command == EditorCommand::ToggleSourceMode || self.source_mode != should_source {
                    self.send(&NativeMessage::ToggleMode);
                }
            }
            EditorCommand::ShowSplitPreview => {}
            EditorCommand::FormatInline(format) => {
                let id = match format {
                    inkpoint_editor_gpui::InlineFormat::Bold => "format.bold",
                    inkpoint_editor_gpui::InlineFormat::Italic => "format.italic",
                    inkpoint_editor_gpui::InlineFormat::Strikethrough => "format.strikethrough",
                    inkpoint_editor_gpui::InlineFormat::Code => "format.inlineCode",
                };
                self.send(&NativeMessage::Format { id });
            }
            EditorCommand::FormatBlock(format) => {
                let id = match format {
                    inkpoint_editor_gpui::BlockFormat::Heading(level) => match level {
                        1 => "format.heading1",
                        2 => "format.heading2",
                        3 => "format.heading3",
                        4 => "format.heading4",
                        5 => "format.heading5",
                        6 => "format.heading6",
                        _ => return,
                    },
                    inkpoint_editor_gpui::BlockFormat::Quote => "format.blockquote",
                    inkpoint_editor_gpui::BlockFormat::UnorderedList => "format.bulletList",
                    inkpoint_editor_gpui::BlockFormat::OrderedList => "format.orderedList",
                    inkpoint_editor_gpui::BlockFormat::TaskList => "format.taskList",
                };
                self.send(&NativeMessage::Format { id });
            }
            EditorCommand::ToggleOutline => self.dispatch(HostEvent::Command(HostCommand::Outline)),
        }
    }

    pub fn seek_line(&mut self, line: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.focus(window, cx);
        self.send(&NativeMessage::Seek { line });
    }

    pub fn insert_if_unchanged(
        &mut self,
        expected_revision: u64,
        expected_range: Range<usize>,
        text: &str,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Result<(), String> {
        if !self.ready {
            return Err("editor is not ready".into());
        }
        if self.composing || self.revision != expected_revision || self.selection != expected_range
        {
            return Err("editor selection changed; request a new suggestion".into());
        }
        self.send(&NativeMessage::Insert {
            generation: self.generation,
            revision: self.renderer_revision,
            from: expected_range.start,
            to: expected_range.end,
            text,
        });
        Ok(())
    }

    pub fn insert_image_if_unchanged(
        &mut self,
        context: &PasteContext,
        reference: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        if !safe_image_reference(reference) {
            return Err("unsafe image reference".into());
        }
        self.insert_if_unchanged(
            context.revision,
            context.selection.clone(),
            &format!("![image]({reference})"),
            window,
            cx,
        )
    }

    /// Read the renderer's last committed state before a host operation such as Save.
    pub fn flush(
        &mut self,
        callback: impl FnOnce(Result<(), String>, &mut Window, &mut App) + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(view) = self
            .webview
            .borrow()
            .as_ref()
            .filter(|_| self.ready)
            .cloned()
        else {
            window.defer(cx, move |window, cx| callback(Ok(()), window, cx));
            return;
        };
        let id = self.generation;
        self.pending_flush.push((id, Box::new(callback)));
        let tx = self.tx.clone();
        // Wry already JSON-encodes JavaScript results on macOS.
        if let Err(error) =
            view.evaluate_script_with_callback("window.inkpointSnapshot?.() ?? null", move |json| {
                let _ = tx.unbounded_send(HostMessage::Flush(id, Ok(json)));
            })
        {
            let (_, callback) = self
                .pending_flush
                .pop()
                .expect("just inserted flush callback");
            let message = error.to_string();
            window.defer(cx, move |window, cx| callback(Err(message), window, cx));
        }
    }

    fn receive(&mut self, message: HostMessage, window: &mut Window, cx: &mut Context<Self>) {
        match message {
            HostMessage::Ipc(json) => match serde_json::from_str::<JsMessage>(&json) {
                Ok(JsMessage::Ready) => {
                    self.ready = true;
                    self.apply_preferences(settings::current(cx).read(cx));
                    self.load_document();
                    self.focus(window, cx);
                    cx.notify();
                }
                Ok(JsMessage::EditorFocus) => self.focus_handle.focus(window, cx),
                Ok(JsMessage::Snapshot {
                    generation,
                    revision,
                    markdown,
                    from,
                    to,
                    composing,
                    mode,
                }) if generation == self.generation => {
                    self.renderer_revision = revision;
                    let markdown_changed = self.markdown != markdown;
                    self.markdown = markdown;
                    if markdown_changed {
                        self.revision = self.revision.wrapping_add(1);
                    }
                    let len = self.markdown.len();
                    let start = clamp_boundary(&self.markdown, from.min(len));
                    let end = clamp_boundary(&self.markdown, to.min(len)).max(start);
                    self.selection = start..end;
                    self.composing = composing;
                    self.source_mode = mode == "source";
                    cx.notify();
                }
                Ok(JsMessage::Command { command }) => {
                    if let Some(command) = parse_command(&command) {
                        self.dispatch(HostEvent::Command(command));
                    }
                }
                Ok(JsMessage::Link { url }) => self.dispatch(HostEvent::Link(url)),
                Ok(JsMessage::PasteImage) => self.dispatch(HostEvent::PasteImage),
                Ok(JsMessage::InsertResult { applied }) => {
                    self.dispatch(HostEvent::InsertResult(applied))
                }
                Ok(JsMessage::Snapshot { .. }) => {}
                Err(error) => {
                    self.dispatch(HostEvent::Error(format!("Invalid editor message: {error}")))
                }
            },
            HostMessage::Flush(generation, result) => {
                let parsed = result.and_then(|json| {
                    let snapshot: FlushSnapshot = serde_json::from_str(&json)
                        .map_err(|_| "Could not read the document from the editor.".to_owned())?;
                    if snapshot.generation != generation || snapshot.composing {
                        return Err("editor snapshot is stale or composing".into());
                    }
                    Ok(snapshot)
                });
                let outcome = match parsed {
                    Ok(snapshot) if generation == self.generation => {
                        if self.markdown != snapshot.markdown {
                            self.revision = self.revision.wrapping_add(1);
                        }
                        self.markdown = snapshot.markdown;
                        self.renderer_revision = snapshot.revision;
                        let len = self.markdown.len();
                        let start = clamp_boundary(&self.markdown, snapshot.from.min(len));
                        let end = clamp_boundary(&self.markdown, snapshot.to.min(len)).max(start);
                        self.selection = start..end;
                        self.source_mode = snapshot.mode == "source";
                        self.composing = snapshot.composing;
                        cx.notify();
                        Ok(())
                    }
                    Ok(_) => Err("editor document changed while saving".into()),
                    Err(error) => Err(error),
                };
                if let Some(index) = self
                    .pending_flush
                    .iter()
                    .position(|(id, _)| *id == generation)
                {
                    let (_, callback) = self.pending_flush.remove(index);
                    window.defer(cx, move |window, app| callback(outcome, window, app));
                }
            }
            HostMessage::Event(event) => {
                let handler = self.handler.clone();
                window.defer(cx, move |window, app| handler(event, window, app));
            }
        }
    }

    fn send(&self, message: &NativeMessage<'_>) {
        if let Some(view) = self.webview.borrow().as_ref()
            && let Ok(json) = serde_json::to_string(message)
            && let Err(error) = view.evaluate_script(&format!("window.inkpointReceive?.({json})"))
        {
            self.dispatch(HostEvent::Error(error.to_string()));
        }
    }

    fn dispatch(&self, event: HostEvent) {
        let _ = self.tx.unbounded_send(HostMessage::Event(event));
    }

    fn load_document(&self) {
        self.send(&NativeMessage::Load {
            generation: self.generation,
            markdown: &self.markdown,
            readonly: self.readonly,
            mdx: self.document_path.as_deref().is_some_and(is_mdx),
        });
    }
}

fn ensure_view(
    webview: &Rc<RefCell<Option<Rc<wry::WebView>>>>,
    assets: &Path,
    documents: &Rc<RefCell<Option<PathBuf>>>,
    document_generation: &Rc<Cell<u64>>,
    tx: &mpsc::UnboundedSender<HostMessage>,
    bounds: Bounds<gpui_kit::Pixels>,
    window: &mut Window,
) {
    let rect = Rect {
        position: LogicalPosition::new(bounds.origin.x.as_f32(), bounds.origin.y.as_f32()).into(),
        size: LogicalSize::new(bounds.size.width.as_f32(), bounds.size.height.as_f32()).into(),
    };
    if let Some(view) = webview.borrow().as_ref() {
        let _ = view.set_bounds(rect);
        return;
    }
    let assets = assets.to_path_buf();
    let documents = documents.clone();
    let document_generation = document_generation.clone();
    let tx = tx.clone();
    let ipc_tx = tx.clone();
    let origin = EDITOR_ORIGIN.to_string();
    let builder = wry::WebViewBuilder::new()
        .with_bounds(rect)
        .with_transparent(true)
        .with_custom_protocol("inkpoint".to_owned(), move |_, request| {
            serve_request(
                &assets,
                documents.borrow().as_deref(),
                document_generation.get(),
                &origin,
                request,
            )
        })
        .with_ipc_handler(move |request: Request<String>| {
            if request.uri().scheme_str() == Some("inkpoint")
                && request.uri().host() == Some("editor")
                && request.uri().path() == "/editor.html"
            {
                let _ = ipc_tx.unbounded_send(HostMessage::Ipc(request.into_body()));
            }
        })
        .with_navigation_handler(|url| url == format!("{EDITOR_ORIGIN}/editor.html"))
        .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny);
    match builder
        .with_url(format!("{EDITOR_ORIGIN}/editor.html"))
        .build_as_child(window)
    {
        Ok(view) => *webview.borrow_mut() = Some(Rc::new(view)),
        Err(error) => {
            let _ = tx.unbounded_send(HostMessage::Event(HostEvent::Error(format!(
                "Unable to create editor view: {error}"
            ))));
        }
    }
}

impl Render for WebEditor {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        let webview = self.webview.clone();
        let assets = self.assets.clone();
        let documents = self.document_root.clone();
        let document_generation = self.document_generation.clone();
        let tx = self.tx.clone();
        div().size_full().track_focus(&self.focus_handle).child(
            canvas(
                move |bounds, window, _app| {
                    ensure_view(
                        &webview,
                        &assets,
                        &documents,
                        &document_generation,
                        &tx,
                        bounds,
                        window,
                    );
                },
                |_, (), _, _| {},
            )
            .size_full(),
        )
    }
}

#[derive(Deserialize)]
struct FlushSnapshot {
    generation: u64,
    revision: u64,
    markdown: String,
    from: usize,
    to: usize,
    composing: bool,
    mode: String,
}

fn editor_assets_dir() -> PathBuf {
    if let Ok(executable) = std::env::current_exe()
        && let Some(resources) = executable
            .parent()
            .and_then(Path::parent)
            .map(|path| path.join("Resources/editor"))
        && resources.is_dir()
    {
        return resources;
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("editor-dist")
}

fn serve_request(
    assets: &Path,
    document_parent: Option<&Path>,
    document_generation: u64,
    origin: &str,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    if request.uri().scheme_str() != Some("inkpoint")
        || request.uri().host() != Some("editor")
        || origin != EDITOR_ORIGIN
    {
        return response_with_status(
            Vec::new(),
            "text/plain; charset=utf-8",
            wry::http::StatusCode::FORBIDDEN,
        );
    }
    let path = request.uri().path();
    if let Some(relative) = path.strip_prefix("/document-assets/") {
        let requested_generation = request
            .uri()
            .query()
            .and_then(|query| {
                url::form_urlencoded::parse(query.as_bytes()).find(|(key, _)| key == "document")
            })
            .and_then(|(_, value)| value.parse::<u64>().ok());
        if requested_generation != Some(document_generation) {
            return response_with_status(
                Vec::new(),
                "text/plain; charset=utf-8",
                wry::http::StatusCode::NOT_FOUND,
            );
        }
        if let Some(root) = document_parent
            && let Some((bytes, mime)) = serve_document_image(root, relative)
        {
            return response(bytes, mime);
        }
        return response_with_status(
            Vec::new(),
            "text/plain; charset=utf-8",
            wry::http::StatusCode::NOT_FOUND,
        );
    }
    let relative = path.trim_start_matches('/');
    let Some(asset_path) = safe_asset_path(assets, relative) else {
        return response(Vec::new(), "text/plain; charset=utf-8");
    };
    match fs::read(&asset_path) {
        Ok(bytes) => response(
            bytes,
            mime_for(&asset_path).unwrap_or("application/octet-stream"),
        ),
        Err(_) => response(Vec::new(), "text/plain; charset=utf-8"),
    }
}

fn response(bytes: Vec<u8>, mime: &'static str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Cow::Owned(bytes))
        .unwrap()
}

fn response_with_status(
    bytes: Vec<u8>,
    mime: &'static str,
    status: wry::http::StatusCode,
) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Cow::Owned(bytes))
        .unwrap()
}

fn safe_asset_path(root: &Path, relative: &str) -> Option<PathBuf> {
    let decoded = decode_path(relative)?;
    if decoded
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return None;
    }
    let root = root.canonicalize().ok()?;
    let candidate = root.join(decoded).canonicalize().ok()?;
    candidate.starts_with(root).then_some(candidate)
}

fn serve_document_image(root: &Path, relative: &str) -> Option<(Vec<u8>, &'static str)> {
    let path = safe_asset_path(root, relative)?;
    let mime = image_mime(&path)?;
    Some((fs::read(path).ok()?, mime))
}

fn image_mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn mime_for(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "html" => Some("text/html; charset=utf-8"),
        "js" | "mjs" => Some("text/javascript; charset=utf-8"),
        "css" => Some("text/css; charset=utf-8"),
        "json" => Some("application/json"),
        "svg" => Some("image/svg+xml"),
        "wasm" => Some("application/wasm"),
        "woff" => Some("font/woff"),
        "woff2" => Some("font/woff2"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn decode_path(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn clamp_boundary(text: &str, mut index: usize) -> usize {
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn is_mdx(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mdx"))
}
fn safe_image_reference(reference: &str) -> bool {
    reference.starts_with("./assets/") && !reference.contains("..") && !reference.contains('\\')
}
fn parse_command(command: &str) -> Option<HostCommand> {
    Some(match command {
        "new" => HostCommand::New,
        "open" => HostCommand::Open,
        "open-folder" => HostCommand::OpenFolder,
        "save" => HostCommand::Save,
        "save-as" => HostCommand::SaveAs,
        "close" => HostCommand::Close,
        "outline" => HostCommand::Outline,
        "local-ai" => HostCommand::LocalAi,
        "settings" => HostCommand::Settings,
        _ => return None,
    })
}
