mod chrome;

pub(crate) use self::chrome::DocumentMetricKind;
use self::chrome::OutlineEntry;
use std::{collections::HashMap, ops::Range, path::PathBuf, sync::Arc};

use crate::{
    APP_NAME,
    document::{Document, is_markdown},
    folder::FolderEntry,
    image_assets::{create_missing_directories, resolve_destination, store_image_in},
    local_ai::LocalAiService,
    settings,
};
use gpui_kit::{component::tree::TreeState, *};
use inkpoint_editor_gpui::{
    ImagePaste, LinkAction, LinkActivated, PasteTarget, TypesetTypography,
    TypesetView as DesktopEditor,
};

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
    PasteImage(Image, PasteTarget),
}

struct Suggestion {
    revision: u64,
    /// The presentation generation the suggestion was computed in.
    ///
    /// A mode switch changes what these byte offsets mean, and it does not
    /// change the revision, so the revision check alone would let a suggestion
    /// from the other mode be accepted (AI-01).
    mode_generation: u64,
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
    document_generation: u64,
    welcome_focus: FocusHandle,
    folder: Entity<TreeState>,
    folder_files: HashMap<SharedString, PathBuf>,
    folder_loaded: bool,
    sidebar_visible: bool,
    sidebar_tab: SidebarTab,
    outline: Option<(u64, Vec<OutlineEntry>)>,
    file_busy: bool,
    status: SharedString,
    /// Whether the status bar is currently showing an editor rejection.
    editor_error_shown: bool,
    ai: Option<Arc<LocalAiService>>,
    ai_busy: bool,
    suggestion: Option<Suggestion>,
    pub(crate) pending_draft: Option<crate::session::PendingDraftInfo>,
    pub(crate) draft_preview_open: bool,
    pub(crate) metric_kind: DocumentMetricKind,
    _editor_observer: Subscription,
    _image_paste_subscription: Subscription,
    _link_activated_subscription: Subscription,
    _appearance_observer: Subscription,
    _settings_observer: Subscription,
    _ai_shutdown: Subscription,
    _session_quit: Subscription,
}

impl Workspace {
    pub(crate) fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let editor = cx.new(|cx| {
            let mut editor = DesktopEditor::new(window, cx, "");
            editor.set_image_paste_enabled(true);
            editor
        });
        let apply_typography = |editor: &Entity<DesktopEditor>, cx: &mut App| {
            let preferences = &settings::current(cx).read(cx).editor;
            let typography = TypesetTypography {
                body_font_size: f32::from(preferences.wysiwyg_font_size),
                prose_font_family: preferences.prose_font_family.clone(),
                code_font_family: preferences.code_font_family.clone(),
            };
            editor.update(cx, |editor, cx| editor.set_typography(typography, cx));
        };
        apply_typography(&editor, cx);
        let settings_entity = settings::current(cx).clone();
        let _settings_observer = cx.observe(&settings_entity, move |this, _, cx| {
            apply_typography(&this.editor, cx);
        });
        let _editor_observer = cx.observe_in(&editor, window, |this, _, window, cx| {
            this.update_title(window, cx);
            // Drop the suggestion when the document moved on *or* the
            // presentation changed. The observer fires on editor changes,
            // which includes the mode switch, so this is where a stale
            // suggestion disappears from the UI (AI-01).
            if this.suggestion.as_ref().is_some_and(|suggestion| {
                let editor = this.editor.read(cx);
                editor.revision() != suggestion.revision
                    || editor.mode_generation() != suggestion.mode_generation
            }) {
                this.suggestion = None;
            }
            // A rejected edit — typing into a read-only document, or past a
            // boundary — used to be silent. Report it once, when it appears,
            // rather than leaving the user with a key that does nothing.
            let error = this.editor.read(cx).last_error().map(ToString::to_string);
            let has_error = error.is_some();
            match error {
                Some(error) => {
                    if this.status.as_ref() != error {
                        this.message(error, cx);
                    }
                }
                None if this.editor_error_shown => {
                    // The rejection was resolved by a later successful edit,
                    // so the stale message goes away instead of sitting there.
                    this.message("Ready", cx);
                }
                None => {}
            }
            this.editor_error_shown = has_error;
            cx.notify();
        });
        let image_paste_subscription = cx.subscribe_in(
            &editor,
            window,
            |this, _, event: &ImagePaste, window, cx| {
                if this.has_active_document {
                    this.paste_image(event.image.clone(), event.target.clone(), window, cx);
                }
            },
        );
        // Following a link is a host decision: the editor classifies the target,
        // the host opens it. A fragment never reaches here because the editor
        // resolves those itself.
        let link_activated_subscription = cx.subscribe_in(
            &editor,
            window,
            |this, _, event: &LinkActivated, window, cx| {
                this.follow_link(event.action.clone(), window, cx);
            },
        );
        let appearance_observer = window.observe_window_appearance(settings::sync_system_theme);
        let owner = cx.weak_entity();
        window.on_window_should_close(cx, move |window, cx| {
            if let Some(entity) = owner.upgrade() {
                return entity.update(cx, |this, cx| {
                    if this.file_busy {
                        return false;
                    }
                    if this.editor.read(cx).composing() {
                        this.message("Finish the current text composition before closing.", cx);
                        return false;
                    }
                    if this.dirty(cx) {
                        this.save_hot_exit_session(cx);
                        this.file_action(FileAction::Close, window, cx);
                        return false;
                    }
                    true
                });
            }
            true
        });
        let owner_quit = cx.weak_entity();
        let session_quit = cx.on_app_quit(move |_, cx| {
            if let Some(entity) = owner_quit.upgrade() {
                entity.update(cx, |this, cx| {
                    if this.dirty(cx) {
                        this.save_hot_exit_session(cx);
                    }
                });
            }
            async move {}
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
            document_generation: 0,
            welcome_focus: cx.focus_handle(),
            folder: cx.new(|cx| TreeState::new(cx)),
            folder_files: HashMap::new(),
            folder_loaded: false,
            sidebar_visible: true,
            sidebar_tab: SidebarTab::Files,
            outline: None,
            file_busy: false,
            status: "Ready".into(),
            editor_error_shown: false,
            ai,
            ai_busy: false,
            suggestion: None,
            pending_draft: None,
            draft_preview_open: false,
            metric_kind: DocumentMetricKind::Words,
            _editor_observer,
            _image_paste_subscription: image_paste_subscription,
            _link_activated_subscription: link_activated_subscription,
            _appearance_observer: appearance_observer,
            _settings_observer,
            _ai_shutdown: ai_shutdown,
            _session_quit: session_quit,
        };
        view.welcome_focus.focus(window, cx);
        view.update_title(window, cx);
        view
    }

    fn dirty(&self, cx: &App) -> bool {
        self.editor.read(cx).markdown() != self.document.markdown
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

    fn install_document(
        &mut self,
        document: Document,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.has_active_document = true;
        self.document_generation = self.document_generation.wrapping_add(1);
        // Relative image references resolve against this document's folder. Set
        // before the first parse so the very first frame can load local images
        // instead of fetching them over HTTP (IMAGE-01).
        let document_directory = document
            .path
            .as_ref()
            .and_then(|path| path.parent())
            .map(|parent| parent.to_path_buf());
        self.editor.update(cx, |editor, cx| {
            editor.set_document_directory(document_directory, cx);
            editor.replace_markdown(&document.markdown, cx);
            editor.focus(window, cx);
        });
        self.document = Arc::new(document);
        self.suggestion = None;
        self.draft_preview_open = false;
        self.pending_draft = crate::session::check_pending_draft(
            self.document.path.as_deref(),
            &self.document.markdown,
        );
        self.update_title(window, cx);
        // A file the parser cannot structure still opens, so the user keeps
        // their buffer, but saying so beats an unexplained empty page.
        let parse_error = self.editor.read(cx).parse_error().map(ToString::to_string);
        match parse_error {
            Some(error) => self.message(
                format!("Opened, but the Markdown did not parse: {error}"),
                cx,
            ),
            None => self.message("Ready", cx),
        }
    }

    fn file_action(&mut self, action: FileAction, window: &mut Window, cx: &mut Context<Self>) {
        self.with_committed_editor(window, cx, move |this, window, cx| {
            this.file_action_from_snapshot(action, window, cx);
        });
    }

    /// Runs an action when the editor has committed its current composition.
    fn with_committed_editor(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
        action: impl FnOnce(&mut Self, &mut Window, &mut Context<Self>),
    ) {
        if self.file_busy {
            return;
        }
        if self.editor.read(cx).composing() {
            self.message("Finish the current text composition before continuing.", cx);
            return;
        }
        action(self, window, cx);
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

    /// Acts on a link the editor classified and asked the host to follow.
    ///
    /// Fragments never arrive here: the editor resolves those itself, because
    /// they are document navigation rather than a host capability. This handles
    /// only the three outcomes that need the platform.
    fn follow_link(&mut self, action: LinkAction, window: &mut Window, cx: &mut Context<Self>) {
        match action {
            LinkAction::External(url) => {
                // The editor only classifies whitelisted schemes as external, so
                // no further check is needed here; the whitelist is the gate.
                cx.open_url(&url);
                self.message(format!("Opened {url}"), cx);
            }
            LinkAction::Local(target) => {
                // A local resource resolves against the active document's folder.
                // Without a saved document there is no base path, so report it
                // instead of guessing.
                let Some(base) = self.document.path.as_ref().and_then(|path| path.parent()) else {
                    self.message("Save the document before opening local links.", cx);
                    return;
                };
                let resolved = base.join(&target);
                if !resolved.exists() {
                    self.message(format!("Could not find {target}"), cx);
                    return;
                }
                // A local Markdown file opens as a document; anything else goes
                // to the system handler (images, PDFs, and so on).
                if is_markdown(&resolved) {
                    self.open_path(resolved, window, cx);
                } else {
                    cx.open_with_system(&resolved);
                    self.message(format!("Opened {target}"), cx);
                }
            }
            LinkAction::Refused(target) => {
                // Editable text, never opened. Saying so is better than a click
                // that appears to do nothing.
                self.message(format!("This link cannot be opened: {target}"), cx);
            }
        }
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
        self.with_committed_editor(window, cx, move |this, window, cx| {
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
                        this.with_committed_editor(window, cx, move |this, window, cx| {
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
        let markdown = self.editor.read(cx).markdown().to_string();
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
                        this.document = Arc::new(saved);
                        this.update_title(window, cx);
                        if !this.dirty(cx) {
                            let _ = crate::session::HotExitSession::clear();
                            this.pending_draft = None;
                        }
                        if let Some(next) = next {
                            this.with_committed_editor(window, cx, move |this, window, cx| {
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
        target: PasteTarget,
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

        // Resolve the configured directory against this document. An untitled
        // document has no folder to be relative to, so it takes the save path
        // above instead of guessing a location.
        let setting = settings::current(cx)
            .read(cx)
            .editor
            .image_directory
            .clone();
        let Some(destination) = resolve_destination(Some(&path), &setting) else {
            self.message(
                "The image directory could not be resolved from this document's location.",
                cx,
            );
            return;
        };

        // Creating folders inside the user's workspace is their decision, so a
        // missing directory is confirmed first. Cancelling leaves the document
        // and the filesystem exactly as they were.
        if let Some(missing) = destination.missing_directory.clone() {
            self.confirm_image_directory(missing, image, target, path, window, cx);
            return;
        }
        self.write_pasted_image(image, target, path, destination.directory, window, cx);
    }

    /// Asks before creating a directory that does not exist yet.
    fn confirm_image_directory(
        &mut self,
        missing: PathBuf,
        image: Image,
        target: PasteTarget,
        document_path: PathBuf,
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
        self.file_busy = true;
        let answer = window.prompt(
            PromptLevel::Warning,
            "Create the image folder?",
            Some(&format!(
                "The image would be copied to {}, which does not exist yet. Create it?",
                missing.display()
            )),
            &["Create Folder", "Cancel"],
            cx,
        );
        cx.spawn_in(window, async move |workspace, cx| {
            let answer = answer.await;
            let _ = workspace.update_in(cx, |this, window, cx| {
                this.file_busy = false;
                if !matches!(answer, Ok(0)) {
                    // Cancelled: no directory, no file, no document change.
                    this.message("Image insert cancelled", cx);
                    return;
                }
                this.write_pasted_image(image, target, document_path, missing, window, cx);
            });
        })
        .detach();
    }

    /// Writes the image into `directory` and inserts the reference.
    fn write_pasted_image(
        &mut self,
        image: Image,
        target: PasteTarget,
        path: PathBuf,
        directory: PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let generation = self.document_generation;
        let image_path = path.clone();
        let job = cx.background_executor().spawn(async move {
            create_missing_directories(&directory)?;
            store_image_in(&path, &directory, &image)
        });
        cx.spawn_in(window, async move |workspace, cx| {
            let result = job.await;
            let _ = workspace.update_in(cx, |this, _window, cx| {
                let reference = match result {
                    Ok(reference) => reference,
                    Err(error) => {
                        this.message(format!("Image could not be saved: {error}"), cx);
                        return;
                    }
                };
                // A newly opened document can have the same revision and selection.
                if this.document_generation != generation
                    || this.document.path.as_ref() != Some(&image_path)
                {
                    this.message(
                        format!("Image saved at {reference}; the document changed."),
                        cx,
                    );
                    return;
                }
                let inserted = this.editor.update(cx, |editor, cx| {
                    editor.insert_image_if_unchanged(&target, &reference, cx)
                });
                match inserted {
                    Ok(()) => this.message("Image inserted", cx),
                    Err(error) => this.message(format!("Image saved at {reference}. {error}"), cx),
                }
            });
        })
        .detach();
        self.message("Saving pasted image…", cx);
    }

    fn request_completion(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.has_active_document && !self.ai_busy {
            self.with_committed_editor(window, cx, Self::request_snapshot_completion);
        }
    }

    fn request_snapshot_completion(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(ai) = self.ai.clone() else {
            self.message("The local AI runtime is unavailable in this build.", cx);
            return;
        };
        let editor = self.editor.read(cx);
        let markdown = editor.markdown().to_string();
        let revision = editor.revision();
        let mode_generation = editor.mode_generation();
        let selection = editor.selected_range();
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
                let unstable = editor.composing();
                if unstable
                    || editor.revision() != revision
                    || editor.mode_generation() != mode_generation
                    || editor.selected_range() != selection
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
                            mode_generation,
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

    fn accept_completion(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let Some(suggestion) = self.suggestion.take() else {
            return;
        };
        let result = self.editor.update(cx, |editor, cx| {
            editor.insert_if_unchanged(
                suggestion.revision,
                suggestion.mode_generation,
                suggestion.selection,
                &suggestion.text,
                cx,
            )
        });
        match result {
            Err(error) => self.message(error, cx),
            Ok(_) => self.message("Suggestion inserted", cx),
        }
    }

    pub(crate) fn restore_pending_draft(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(draft) = self.pending_draft.take() else {
            return;
        };
        // A draft restore replaces the document's content, not its identity, so
        // it must be one undoable step. Restoring used to clear history, which
        // made the edits the user had just made unrecoverable (DRAFT-01).
        let result = self.editor.update(cx, |editor, cx| {
            let result =
                editor.replace_markdown_undoable(&draft.draft_content, draft.cursor_offset, cx);
            editor.focus(window, cx);
            result
        });
        self.draft_preview_open = false;
        self.update_title(window, cx);
        match result {
            Ok(()) => self.message("Draft restored. Cmd+Z returns to your edits.", cx),
            Err(error) => self.message(format!("Draft could not be restored. {error}"), cx),
        }
    }

    pub(crate) fn discard_pending_draft(&mut self, cx: &mut Context<Self>) {
        self.pending_draft = None;
        self.draft_preview_open = false;
        let _ = crate::session::HotExitSession::clear();
        self.message("Draft discarded", cx);
    }

    pub(crate) fn save_hot_exit_session(&self, cx: &App) {
        if !self.has_active_document {
            return;
        }
        let is_dirty = self.dirty(cx);
        let markdown = self.editor.read(cx).markdown();
        let cursor_offset = Some(self.editor.read(cx).selected_range().start);
        let file_path = self.document.path.as_deref();
        let _ = crate::session::HotExitSession::save(file_path, markdown, cursor_offset, is_dirty);
    }

    pub(crate) fn check_initial_session(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Ok(Some(session)) = crate::session::HotExitSession::load() else {
            return;
        };

        // A named draft whose file is gone comes first: recovering its text as an
        // untitled document is the only way the user keeps it, and the audit found
        // such a draft left in the session file with no entry point at all
        // (DRAFT-03). The session module decides when a draft is orphaned; the
        // workspace only presents it.
        if let Some(draft) = crate::session::orphaned_draft_in(&session) {
            self.install_document(Document::default(), window, cx);
            self.pending_draft = Some(draft);
            self.message(
                "The original file is missing. A saved draft was recovered; save it to keep the text.",
                cx,
            );
            return;
        }

        let Some(active) = session.active_document else {
            return;
        };
        if let Some(path) = active.file_path {
            if path.exists() {
                self.load_document(path, window, cx);
            }
        } else if active.is_untitled && !session.draft_markdown.is_empty() {
            self.install_document(Document::default(), window, cx);
        }
    }
}

fn local_ai_service() -> Option<LocalAiService> {
    let executable = std::env::current_exe().ok()?;
    let resources = executable.parent()?.parent()?.join("Resources");
    let sidecar = resources.join("llama/llama-server");
    Some(LocalAiService::new(sidecar, crate::app_data::data_root()?))
}
