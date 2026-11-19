mod chrome;

use self::chrome::OutlineEntry;
use std::{collections::HashMap, ops::Range, path::PathBuf, rc::Rc, sync::Arc};

#[cfg(target_os = "macos")]
use crate::web_editor::{HostCommand, HostEvent, WebEditor as DesktopEditor};
use crate::{
    APP_NAME,
    document::{Document, is_markdown},
    folder::FolderEntry,
    image_assets::store_image,
    local_ai::LocalAiService,
    settings,
};
use gpui_kit::{component::tree::TreeState, *};
#[cfg(not(target_os = "macos"))]
use inkpoint_editor_gpui::EditorView as DesktopEditor;
use inkpoint_editor_gpui::PasteContext;

actions!(
    inkpoint,
    [
        NewDocument,
        OpenDocument,
        OpenFolder,
        SaveDocument,
        SaveAs,
        CloseDocument,
        ContinueWithLocalAi
    ]
);

enum FileAction {
    New,
    Open,
    OpenPath(PathBuf),
    Close,
    PasteImage(Image, PasteContext),
}

struct Suggestion {
    revision: u64,
    selection: Range<usize>,
    text: String,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum SidebarTab {
    Files,
    Outline,
}

pub(crate) struct Workspace {
    editor: Entity<DesktopEditor>,
    document: Arc<Document>,
    has_active_document: bool,
    welcome_focus: FocusHandle,
    folder: Entity<TreeState>,
    folder_files: HashMap<SharedString, PathBuf>,
    folder_loaded: bool,
    sidebar_visible: bool,
    sidebar_tab: SidebarTab,
    outline: Option<(u64, Vec<OutlineEntry>)>,
    file_busy: bool,
    status: SharedString,
    ai: Option<Arc<LocalAiService>>,
    ai_busy: bool,
    suggestion: Option<Suggestion>,
    _editor_observer: Subscription,
    _appearance_observer: Subscription,
    #[cfg(target_os = "macos")]
    _preferences_observer: Subscription,
    _ai_shutdown: Subscription,
}

impl Workspace {
    pub(crate) fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let owner = cx.weak_entity();
        #[cfg(target_os = "macos")]
        let editor = cx.new(|cx| {
            DesktopEditor::new(
                window,
                cx,
                Rc::new(move |event, window, cx| {
                    if let Some(owner) = owner.upgrade() {
                        owner.update(cx, |this, cx| this.handle_editor_event(event, window, cx));
                    }
                }),
            )
        });
        #[cfg(not(target_os = "macos"))]
        let editor = cx.new(|cx| {
            let mut editor = DesktopEditor::new(window, cx, "").without_toolbar();
            editor.set_paste_handler(
                Some(Rc::new(move |clipboard, target, window, cx| {
                    let Some(image) = clipboard.entries.iter().find_map(|entry| match entry {
                        ClipboardEntry::Image(image) => Some(image),
                        _ => None,
                    }) else {
                        return false;
                    };
                    let Some(owner) = owner.upgrade() else {
                        return false;
                    };
                    owner.update(cx, |workspace, cx| {
                        workspace.paste_image(image.clone(), target, window, cx);
                    });
                    true
                })),
                cx,
            );
            editor
        });
        let _editor_observer =
            cx.observe_in(&editor, window, |this, _, window, cx| {
                this.update_title(window, cx);
                if this.suggestion.as_ref().is_some_and(|suggestion| {
                    this.editor.read(cx).revision() != suggestion.revision
                }) {
                    this.suggestion = None;
                }
                cx.notify();
            });
        #[cfg(target_os = "macos")]
        let preferences_observer = {
            let preferences = settings::current(cx).clone();
            cx.observe_in(&preferences, window, |this, preferences, _, cx| {
                let preferences = preferences.read(cx).clone();
                this.editor
                    .update(cx, |editor, _| editor.apply_preferences(&preferences));
            })
        };
        let appearance_observer = window.observe_window_appearance(settings::sync_system_theme);
        let owner = cx.weak_entity();
        window.on_window_should_close(cx, move |window, cx| {
            if let Some(entity) = owner.upgrade() {
                return entity.update(cx, |this, cx| {
                    if this.file_busy {
                        return false;
                    }
                    if cfg!(target_os = "macos") || this.dirty(cx) {
                        this.file_action(FileAction::Close, window, cx);
                        return false;
                    }
                    true
                });
            }
            true
        });
        let ai = local_ai_service().map(Arc::new);
        let ai_shutdown = cx.on_app_quit({
            let ai = ai.clone();
            move |_, _| {
                let ai = ai.clone();
                async move {
                    if let Some(ai) = ai {
                        ai.shutdown();
                    }
                }
            }
        });
        let view = Self {
            editor,
            document: Arc::default(),
            has_active_document: false,
            welcome_focus: cx.focus_handle(),
            folder: cx.new(|cx| TreeState::new(cx)),
            folder_files: HashMap::new(),
            folder_loaded: false,
            sidebar_visible: true,
            sidebar_tab: SidebarTab::Files,
            outline: None,
            file_busy: false,
            status: "Ready".into(),
            ai,
            ai_busy: false,
            suggestion: None,
            _editor_observer,
            _appearance_observer: appearance_observer,
            #[cfg(target_os = "macos")]
            _preferences_observer: preferences_observer,
            _ai_shutdown: ai_shutdown,
        };
        view.welcome_focus.focus(window, cx);
        view.update_title(window, cx);
        view
    }

    fn dirty(&self, cx: &App) -> bool {
        let editor = self.editor.read(cx);
        #[cfg(not(target_os = "macos"))]
        if editor.has_unsaved_rich_changes(cx) {
            return true;
        }
        editor.markdown(cx) != self.document.markdown
    }

    fn document_name(&self) -> std::borrow::Cow<'_, str> {
        self.document
            .path
            .as_ref()
            .and_then(|path| path.file_name())
            .map(|name| name.to_string_lossy())
            .unwrap_or_else(|| "Untitled".into())
    }

    fn update_title(&self, window: &mut Window, cx: &App) {
        if !self.has_active_document {
            window.set_window_title(APP_NAME);
            return;
        }
        let name = self.document_name();
        let marker = if self.dirty(cx) { " •" } else { "" };
        window.set_window_title(&format!("{name}{marker} — {APP_NAME}"));
    }

    fn message(&mut self, message: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.status = message.into();
        cx.notify();
    }

    fn show_outline(&mut self, cx: &mut Context<Self>) {
        if self.sidebar_visible && self.sidebar_tab == SidebarTab::Outline {
            self.sidebar_visible = false;
        } else {
            self.sidebar_visible = true;
            self.sidebar_tab = SidebarTab::Outline;
        }
        cx.notify();
    }

    #[cfg(target_os = "macos")]
    fn handle_editor_event(
        &mut self,
        event: HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            HostEvent::Command(command) => match command {
                HostCommand::New => self.file_action(FileAction::New, window, cx),
                HostCommand::Open => self.file_action(FileAction::Open, window, cx),
                HostCommand::OpenFolder => self.open_folder(window, cx),
                HostCommand::Save => self.save(false, None, window, cx),
                HostCommand::SaveAs => self.save(true, None, window, cx),
                HostCommand::Close => self.file_action(FileAction::Close, window, cx),
                HostCommand::Outline => self.show_outline(cx),
                HostCommand::LocalAi => self.request_completion(window, cx),
                HostCommand::Settings => settings::open(cx),
            },
            HostEvent::Link(target) => {
                if let Ok(url) = url::Url::parse(&target)
                    && matches!(url.scheme(), "https" | "http" | "mailto")
                {
                    cx.open_url(url.as_str());
                }
            }
            HostEvent::PasteImage => self.after_editor_flush(window, cx, |this, window, cx| {
                let image = cx.read_from_clipboard().and_then(|item| {
                    item.entries.into_iter().find_map(|entry| match entry {
                        ClipboardEntry::Image(image) => Some(image),
                        _ => None,
                    })
                });
                if let Some(image) = image {
                    let editor = this.editor.read(cx);
                    let target = PasteContext {
                        revision: editor.revision(),
                        selection: editor.selected_range(cx),
                    };
                    this.paste_image(image, target, window, cx);
                }
            }),
            HostEvent::InsertResult(true) => self.message("Inserted", cx),
            HostEvent::InsertResult(false) => {
                self.message("The document or selection changed before insertion.", cx);
            }
            HostEvent::Error(error) => self.message(error, cx),
        }
    }

    fn install_document(
        &mut self,
        document: Document,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.has_active_document = true;
        self.editor.update(cx, |editor, cx| {
            #[cfg(target_os = "macos")]
            editor.replace_markdown(&document.markdown, document.path.as_deref(), window, cx);
            #[cfg(not(target_os = "macos"))]
            editor.replace_markdown(&document.markdown, window, cx);
            editor.focus(window, cx);
        });
        self.document = Arc::new(document);
        self.suggestion = None;
        self.update_title(window, cx);
        self.message("Ready", cx);
    }

    fn file_action(&mut self, action: FileAction, window: &mut Window, cx: &mut Context<Self>) {
        self.after_editor_flush(window, cx, move |this, window, cx| {
            this.file_action_from_snapshot(action, window, cx);
        });
    }

    fn after_editor_flush(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
        action: impl FnOnce(&mut Self, &mut Window, &mut Context<Self>) + 'static,
    ) {
        if self.file_busy {
            return;
        }
        #[cfg(not(target_os = "macos"))]
        action(self, window, cx);
        #[cfg(target_os = "macos")]
        {
            // Native menu and window actions can arrive before the latest WebKit IPC message.
            self.file_busy = true;
            let owner = cx.weak_entity();
            self.editor.update(cx, |editor, cx| {
                editor.flush(
                    move |result, window, cx| {
                        if let Some(owner) = owner.upgrade() {
                            owner.update(cx, |this, cx| {
                                this.file_busy = false;
                                match result {
                                    Ok(()) => action(this, window, cx),
                                    Err(error) => this.message(error, cx),
                                }
                            });
                        }
                    },
                    window,
                    cx,
                );
            });
        }
    }

    fn file_action_from_snapshot(
        &mut self,
        action: FileAction,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.dirty(cx) {
            self.run_file_action(action, window, cx);
            return;
        }

        self.file_busy = true;
        let answer = window.prompt(
            PromptLevel::Warning,
            "Keep your changes?",
            Some("Save this document before continuing, or discard the unsaved edits."),
            &["Save", "Discard Changes", "Cancel"],
            cx,
        );
        cx.spawn_in(window, async move |workspace, cx| {
            let answer = answer.await;
            let _ = workspace.update_in(cx, |this, window, cx| {
                this.file_busy = false;
                match answer {
                    Ok(0) => this.save(false, Some(action), window, cx),
                    Ok(1) => this.run_file_action(action, window, cx),
                    _ => cx.notify(),
                }
            });
        })
        .detach();
        cx.notify();
    }

    fn open_folder(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.file_busy {
            return;
        }
        let response = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Open Markdown Folder".into()),
        });
        self.file_busy = true;
        cx.spawn_in(window, async move |workspace, cx| {
            let path = response
                .await
                .ok()
                .and_then(|result| result.ok())
                .flatten()
                .and_then(|paths| paths.into_iter().next());

            let folder = if let Some(path) = path {
                let executor = cx.background_executor();
                Some(executor.spawn(async move { FolderEntry::scan(path) }).await)
            } else {
                None
            };
            let _ = workspace.update_in(cx, |this, _, cx| {
                this.file_busy = false;
                match folder {
                    Some(Ok(folder)) => {
                        let (root, files) = folder.into_tree();
                        this.folder
                            .update(cx, |tree, cx| tree.set_items(vec![root], cx));
                        this.folder_files = files;
                        this.folder_loaded = true;
                        this.sidebar_visible = true;
                        this.sidebar_tab = SidebarTab::Files;
                        this.message("Opened folder", cx);
                    }
                    Some(Err(error)) => this.message(format!("Open folder failed: {error}"), cx),
                    None => cx.notify(),
                }
            });
        })
        .detach();
        self.message("Opening folder…", cx);
    }

    pub(crate) fn open_path(&mut self, path: PathBuf, window: &mut Window, cx: &mut Context<Self>) {
        self.file_action(FileAction::OpenPath(path), window, cx);
    }

    fn run_file_action(&mut self, action: FileAction, window: &mut Window, cx: &mut Context<Self>) {
        match action {
            FileAction::New => self.install_document(Document::default(), window, cx),
            FileAction::Close => window.remove_window(),
            FileAction::OpenPath(path) => self.load_document(path, window, cx),
            FileAction::PasteImage(image, target) => self.paste_image(image, target, window, cx),
            FileAction::Open => {
                let response = cx.prompt_for_paths(PathPromptOptions {
                    files: true,
                    directories: false,
                    multiple: false,
                    prompt: Some("Open Markdown".into()),
                });
                self.editor
                    .update(cx, |editor, cx| editor.set_readonly(true, cx));
                self.file_busy = true;
                cx.spawn_in(window, async move |workspace, cx| {
                    let path = response
                        .await
                        .ok()
                        .and_then(|result| result.ok())
                        .flatten()
                        .and_then(|paths| paths.into_iter().next());
                    let _ = workspace.update_in(cx, |this, window, cx| {
                        this.file_busy = false;
                        if let Some(path) = path {
                            this.load_document(path, window, cx);
                        } else {
                            this.editor
                                .update(cx, |editor, cx| editor.set_readonly(false, cx));
                            cx.notify();
                        }
                    });
                })
                .detach();
                cx.notify();
            }
        }
    }

    pub(crate) fn load_document(
        &mut self,
        path: PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !is_markdown(&path) {
            self.editor
                .update(cx, |editor, cx| editor.set_readonly(false, cx));
            self.message("Choose a Markdown or MDX file.", cx);
            return;
        }
        self.editor
            .update(cx, |editor, cx| editor.set_readonly(true, cx));
        self.file_busy = true;
        self.message("Opening document…", cx);
        let job = cx
            .background_executor()
            .spawn(async move { Document::open(path) });
        cx.spawn_in(window, async move |workspace, cx| {
            let result = job.await;
            let _ = workspace.update_in(cx, |this, window, cx| {
                this.file_busy = false;
                this.editor
                    .update(cx, |editor, cx| editor.set_readonly(false, cx));
                match result {
                    Ok(document) => this.install_document(document, window, cx),
                    Err(error) => this.message(format!("Open failed: {error}"), cx),
                }
            });
        })
        .detach();
    }

    fn save(
        &mut self,
        save_as: bool,
        next: Option<FileAction>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.has_active_document {
            return;
        }
        self.after_editor_flush(window, cx, move |this, window, cx| {
            this.save_snapshot(save_as, next, window, cx);
        });
    }

    fn save_snapshot(
        &mut self,
        save_as: bool,
        next: Option<FileAction>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        #[cfg(not(target_os = "macos"))]
        if let Err(error) = self
            .editor
            .update(cx, |editor, cx| editor.commit_pending_rich_edit(window, cx))
        {
            self.message(error, cx);
            return;
        }
        if !save_as && let Some(path) = &self.document.path {
            self.write_document(path.clone(), next, window, cx);
            return;
        }
        let current = self.document.path.as_deref();
        let directory = current
            .and_then(std::path::Path::parent)
            .map(ToOwned::to_owned)
            .or_else(dirs::document_dir)
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| ".".into());
        let name = current
            .and_then(std::path::Path::file_name)
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.md");
        let response = cx.prompt_for_new_path(&directory, Some(name));
        self.file_busy = true;
        cx.spawn_in(window, async move |workspace, cx| {
            let response = response.await;
            let _ = workspace.update_in(cx, |this, window, cx| {
                this.file_busy = false;
                match response {
                    Ok(Ok(Some(path))) => {
                        this.after_editor_flush(window, cx, move |this, window, cx| {
                            this.write_document(path, next, window, cx);
                        })
                    }
                    Ok(Err(error)) => this.message(format!("Save failed: {error}"), cx),
                    _ => cx.notify(),
                }
            });
        })
        .detach();
        cx.notify();
    }

    fn write_document(
        &mut self,
        path: PathBuf,
        next: Option<FileAction>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let markdown = self.editor.read(cx).markdown(cx);
        let document = self.document.clone();
        self.file_busy = true;
        self.message("Saving document…", cx);
        let job = cx
            .background_executor()
            .spawn(async move { document.save(path, markdown) });
        cx.spawn_in(window, async move |workspace, cx| {
            let result = job.await;
            let _ = workspace.update_in(cx, |this, window, cx| {
                this.file_busy = false;
                match result {
                    Ok(saved) => {
                        #[cfg(target_os = "macos")]
                        this.editor.update(cx, |editor, _| {
                            editor.set_document_path(saved.path.as_deref())
                        });
                        this.document = Arc::new(saved);
                        this.update_title(window, cx);
                        if let Some(next) = next {
                            this.after_editor_flush(window, cx, move |this, window, cx| {
                                if this.dirty(cx) {
                                    this.message(
                                        "Saved a snapshot. Newer edits are still unsaved.",
                                        cx,
                                    );
                                } else {
                                    this.message("Saved", cx);
                                    this.run_file_action(next, window, cx);
                                }
                            });
                        } else {
                            let status = if this.dirty(cx) {
                                "Saved a snapshot. Newer edits are still unsaved."
                            } else {
                                "Saved"
                            };
                            this.message(status, cx);
                        }
                    }
                    Err(error) => this.message(format!("Save failed: {error}"), cx),
                }
            });
        })
        .detach();
    }

    fn paste_image(
        &mut self,
        image: Image,
        target: PasteContext,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.file_busy {
            self.message(
                "Wait for the current file operation before pasting an image.",
                cx,
            );
            return;
        }
        let Some(path) = self.document.path.clone() else {
            self.save(
                false,
                Some(FileAction::PasteImage(image, target)),
                window,
                cx,
            );
            return;
        };

        let job = cx
            .background_executor()
            .spawn(async move { store_image(&path, &image) });
        cx.spawn_in(window, async move |workspace, cx| {
            let result = job.await;
            let _ = workspace.update_in(cx, |this, window, cx| {
                let reference = match result {
                    Ok(reference) => reference,
                    Err(error) => {
                        this.message(format!("Image could not be saved: {error}"), cx);
                        return;
                    }
                };
                let inserted = this.editor.update(cx, |editor, cx| {
                    editor.insert_image_if_unchanged(&target, &reference, window, cx)
                });
                match inserted {
                    #[cfg(not(target_os = "macos"))]
                    Ok(()) => this.message("Image inserted", cx),
                    #[cfg(target_os = "macos")]
                    Ok(()) => {}
                    Err(error) => this.message(format!("Image saved at {reference}. {error}"), cx),
                }
            });
        })
        .detach();
        self.message("Saving pasted image…", cx);
    }

    fn request_completion(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.has_active_document && !self.ai_busy {
            self.after_editor_flush(window, cx, Self::request_snapshot_completion);
        }
    }

    fn request_snapshot_completion(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(ai) = self.ai.clone() else {
            self.message("The local AI runtime is unavailable in this build.", cx);
            return;
        };
        let editor = self.editor.read(cx);
        #[cfg(not(target_os = "macos"))]
        if editor.has_pending_rich_edit() {
            self.message(
                "Apply or cancel the current block edit before asking AI.",
                cx,
            );
            return;
        }
        let markdown = editor.markdown(cx);
        let revision = editor.revision();
        let selection = editor.selected_range(cx);
        let Some(prefix) = markdown.get(..selection.start) else {
            return;
        };
        let Some(suffix) = markdown.get(selection.end..) else {
            return;
        };
        let before = prefix
            .char_indices()
            .rev()
            .nth(1_799)
            .map_or(prefix, |(offset, _)| &prefix[offset..]);
        let after = suffix
            .char_indices()
            .nth(600)
            .map_or(suffix, |(offset, _)| &suffix[..offset]);
        if before.trim().is_empty() {
            self.message("Write a few words before requesting a continuation.", cx);
            return;
        }
        let before = before.to_owned();
        let after = after.to_owned();
        self.suggestion = None;
        self.ai_busy = true;
        self.message("Generating a local suggestion…", cx);
        let job = cx
            .background_executor()
            .spawn(async move { ai.complete(&before, &after) });
        cx.spawn_in(window, async move |workspace, cx| {
            let response = job.await;
            let _ = workspace.update_in(cx, |this, _, cx| {
                this.ai_busy = false;
                let editor = this.editor.read(cx);
                #[cfg(target_os = "macos")]
                let unstable = editor.composing();
                #[cfg(not(target_os = "macos"))]
                let unstable = editor.has_pending_rich_edit();
                if unstable
                    || editor.revision() != revision
                    || editor.selected_range(cx) != selection
                {
                    this.message(
                        "Suggestion expired because the document or selection changed.",
                        cx,
                    );
                    return;
                }
                match response {
                    Ok(text) if !text.trim().is_empty() => {
                        this.suggestion = Some(Suggestion {
                            revision,
                            selection,
                            text,
                        });
                        this.message("Local AI suggestion", cx);
                    }
                    Ok(_) => this.message("Local AI returned an empty suggestion.", cx),
                    Err(error) => this.message(format!("Local AI: {error}"), cx),
                }
            });
        })
        .detach();
    }

    fn accept_completion(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(suggestion) = self.suggestion.take() else {
            return;
        };
        let result = self.editor.update(cx, |editor, cx| {
            editor.insert_if_unchanged(
                suggestion.revision,
                suggestion.selection,
                &suggestion.text,
                window,
                cx,
            )
        });
        match result {
            Err(error) => self.message(error, cx),
            #[cfg(not(target_os = "macos"))]
            Ok(()) => self.message("Suggestion inserted", cx),
            #[cfg(target_os = "macos")]
            Ok(()) => cx.notify(),
        }
    }
}

fn local_ai_service() -> Option<LocalAiService> {
    let executable = std::env::current_exe().ok()?;
    let resources = executable.parent()?.parent()?.join("Resources");
    let sidecar = resources.join("llama/llama-server");
    Some(LocalAiService::new(
        sidecar,
        dirs::data_dir()?.join("md-editor"),
    ))
}
