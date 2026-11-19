use std::{collections::HashMap, ops::Range, path::PathBuf, rc::Rc, sync::Arc};

use crate::{
    APP_NAME,
    document::{Document, is_markdown},
    folder::FolderEntry,
    image_assets::store_image,
    local_ai::LocalAiService,
};
use gpui_kit::{
    component::{
        ActiveTheme, Sizable,
        button::Button,
        list::ListItem,
        tree::{TreeState, tree},
    },
    *,
};
use inkpoint_editor_gpui::{EditorView, PasteContext};

actions!(
    inkpoint,
    [
        NewDocument,
        OpenDocument,
        OpenFolder,
        SaveDocument,
        SaveAs,
        CloseDocument
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

pub(crate) struct Workspace {
    editor: Entity<EditorView>,
    document: Arc<Document>,
    folder: Entity<TreeState>,
    folder_files: HashMap<SharedString, PathBuf>,
    folder_loaded: bool,
    file_busy: bool,
    status: SharedString,
    ai: Option<Arc<LocalAiService>>,
    ai_busy: bool,
    suggestion: Option<Suggestion>,
    _editor_observer: Subscription,
    _ai_shutdown: Subscription,
}

impl Workspace {
    pub(crate) fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let owner = cx.weak_entity();
        let editor = cx.new(|cx| {
            let mut editor = EditorView::new(window, cx, "");
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
        let owner = cx.weak_entity();
        window.on_window_should_close(cx, move |window, cx| {
            if let Some(entity) = owner.upgrade() {
                return entity.update(cx, |this, cx| {
                    if this.file_busy {
                        return false;
                    }
                    if this.dirty(cx) {
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
        let mut view = Self {
            editor,
            document: Arc::default(),
            folder: cx.new(|cx| TreeState::new(cx)),
            folder_files: HashMap::new(),
            folder_loaded: false,
            file_busy: false,
            status: "Ready".into(),
            ai,
            ai_busy: false,
            suggestion: None,
            _editor_observer,
            _ai_shutdown: ai_shutdown,
        };
        view.update_title(window, cx);
        view
    }

    pub(crate) fn focus(&self, window: &mut Window, cx: &mut Context<Self>) {
        self.editor
            .update(cx, |editor, cx| editor.focus(window, cx));
    }

    fn dirty(&self, cx: &App) -> bool {
        let editor = self.editor.read(cx);
        editor.has_unsaved_rich_changes(cx) || editor.markdown(cx) != self.document.markdown
    }

    fn update_title(&mut self, window: &mut Window, cx: &App) {
        let name = self
            .document
            .path
            .as_ref()
            .and_then(|path| path.file_name())
            .map(|name| name.to_string_lossy())
            .unwrap_or_else(|| "Untitled".into());
        let marker = if self.dirty(cx) { " •" } else { "" };
        window.set_window_title(&format!("{name}{marker} — {APP_NAME}"));
    }

    fn message(&mut self, message: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.status = message.into();
        cx.notify();
    }

    fn install_document(
        &mut self,
        document: Document,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.editor.update(cx, |editor, cx| {
            editor.replace_markdown(&document.markdown, window, cx);
            editor.focus(window, cx);
        });
        self.document = Arc::new(document);
        self.suggestion = None;
        self.update_title(window, cx);
        self.message("Ready", cx);
    }

    fn file_action(&mut self, action: FileAction, window: &mut Window, cx: &mut Context<Self>) {
        if self.file_busy {
            return;
        }
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
        if self.file_busy {
            return;
        }
        let committed = self
            .editor
            .update(cx, |editor, cx| editor.commit_pending_rich_edit(window, cx));
        if let Err(error) = committed {
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
                    Ok(Ok(Some(path))) => this.write_document(path, next, window, cx),
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
                        this.document = Arc::new(saved);
                        this.update_title(window, cx);
                        if this.dirty(cx) {
                            this.message("Saved a snapshot. Newer edits are still unsaved.", cx);
                        } else {
                            this.message("Saved", cx);
                            if let Some(next) = next {
                                this.run_file_action(next, window, cx);
                            }
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
                    Ok(()) => this.message("Image inserted", cx),
                    Err(error) => this.message(format!("Image saved at {reference}. {error}"), cx),
                }
            });
        })
        .detach();
        self.message("Saving pasted image…", cx);
    }

    fn request_completion(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(ai) = self.ai.clone() else {
            self.message("The local AI runtime is unavailable in this build.", cx);
            return;
        };
        if self.ai_busy {
            return;
        }
        let editor = self.editor.read(cx);
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
                if editor.has_pending_rich_edit()
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
        if let Err(error) = result {
            self.message(error, cx);
        } else {
            self.message("Suggestion inserted", cx);
        }
    }
}

impl Render for Workspace {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let toolbar = div()
            .flex()
            .items_center()
            .gap_2()
            .px_3()
            .py_2()
            .border_b_1()
            .border_color(theme.border)
            .child(Button::new("new").small().label("New").on_click(
                cx.listener(|this, _, window, cx| this.file_action(FileAction::New, window, cx)),
            ))
            .child(Button::new("open").small().label("Open…").on_click(
                cx.listener(|this, _, window, cx| this.file_action(FileAction::Open, window, cx)),
            ))
            .child(
                Button::new("save").small().label("Save").on_click(
                    cx.listener(|this, _, window, cx| this.save(false, None, window, cx)),
                ),
            )
            .child(
                Button::new("open-folder")
                    .small()
                    .label("Open Folder…")
                    .on_click(cx.listener(|this, _, window, cx| this.open_folder(window, cx))),
            )
            .child(div().flex_1())
            .child(
                Button::new("local-ai")
                    .small()
                    .label(if self.ai_busy {
                        "Generating…"
                    } else {
                        "Local AI Continue"
                    })
                    .on_click(
                        cx.listener(|this, _, window, cx| this.request_completion(window, cx)),
                    ),
            );

        let folder = self.folder_loaded.then(|| {
            let owner = cx.weak_entity();
            div()
                .w(px(240.))
                .h_full()
                .flex_shrink_0()
                .border_r_1()
                .border_color(theme.border)
                .child(tree(&self.folder, move |index, entry, _, _, _| {
                    let item = entry.item();
                    let row = ListItem::new(index)
                        .pl(px(8. + entry.depth() as f32 * 13.))
                        .accessibility_label(item.label.clone())
                        .child(div().truncate().child(item.label.clone()));
                    if entry.is_folder() || entry.is_root() {
                        let arrow = if entry.is_expanded() { "▾" } else { "▸" };
                        return row.suffix(move |_, _| div().child(arrow).into_any_element());
                    }
                    let id = item.id.clone();
                    let owner = owner.clone();
                    row.on_click(move |_, window, cx| {
                        if let Some(workspace) = owner.upgrade() {
                            workspace.update(cx, |this, cx| {
                                if let Some(path) = this.folder_files.get(&id).cloned() {
                                    this.open_path(path, window, cx);
                                }
                            });
                        }
                    })
                }))
        });

        let suggestion = self.suggestion.as_ref().map(|suggestion| {
            div()
                .id("suggestion")
                .flex()
                .flex_col()
                .gap_2()
                .px_4()
                .py_3()
                .max_h(px(200.))
                .overflow_y_scroll()
                .border_t_1()
                .border_color(theme.border)
                .child(suggestion.text.clone())
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .child(Button::new("accept").small().label("Insert").on_click(
                            cx.listener(|this, _, window, cx| this.accept_completion(window, cx)),
                        ))
                        .child(Button::new("dismiss").small().label("Dismiss").on_click(
                            cx.listener(|this, _, _, cx| {
                                this.suggestion = None;
                                this.message("Suggestion dismissed", cx);
                            }),
                        )),
                )
        });

        div()
            .key_context("Inkpoint")
            .size_full()
            .flex()
            .flex_col()
            .bg(theme.background)
            .text_color(theme.foreground)
            .on_action(cx.listener(|this, _: &NewDocument, window, cx| {
                this.file_action(FileAction::New, window, cx)
            }))
            .on_action(cx.listener(|this, _: &OpenDocument, window, cx| {
                this.file_action(FileAction::Open, window, cx)
            }))
            .on_action(cx.listener(|this, _: &OpenFolder, window, cx| this.open_folder(window, cx)))
            .on_action(
                cx.listener(|this, _: &SaveDocument, window, cx| {
                    this.save(false, None, window, cx)
                }),
            )
            .on_action(
                cx.listener(|this, _: &SaveAs, window, cx| this.save(true, None, window, cx)),
            )
            .on_action(cx.listener(|this, _: &CloseDocument, window, cx| {
                this.file_action(FileAction::Close, window, cx)
            }))
            .child(toolbar)
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .children(folder)
                    .child(div().flex_1().min_w_0().child(self.editor.clone())),
            )
            .children(suggestion)
            .child(
                div()
                    .px_4()
                    .py_1()
                    .border_t_1()
                    .border_color(theme.border)
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(self.status.clone()),
            )
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
