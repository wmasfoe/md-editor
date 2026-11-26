mod appearance;
mod document;
mod folder;
mod image_assets;
mod local_ai;
pub(crate) mod session;
mod settings;
mod workspace;

use futures::{StreamExt, channel::mpsc};
use gpui_kit::*;
use inkpoint_editor_gpui::{
    BlockFormat, Copy, Cut, HostCommand::*, InlineFormat, Paste, ToggleSourceMode, TypesetView,
};
use settings::OpenSettings;
use std::path::PathBuf;
use workspace::{
    CloseDocument, ContinueWithLocalAi, NewDocument, OpenDocument, OpenFolder, SaveAs,
    SaveDocument, Workspace,
};

// Host bindings are also used to build the settings shortcut list.
mod shortcuts {
    pub type Shortcut = (&'static str, &'static str, &'static str);
    pub const NEW: Shortcut = ("New document", "cmd-n", "ctrl-n");
    pub const OPEN: Shortcut = ("Open document", "cmd-o", "ctrl-o");
    pub const OPEN_FOLDER: Shortcut = ("Open folder", "cmd-alt-o", "ctrl-alt-o");
    pub const SAVE: Shortcut = ("Save", "cmd-s", "ctrl-s");
    pub const SAVE_AS: Shortcut = ("Save as", "cmd-shift-s", "ctrl-shift-s");
    pub const CLOSE: Shortcut = ("Close document", "cmd-w", "ctrl-w");
    pub const QUIT: Shortcut = ("Quit", "cmd-q", "ctrl-q");
    pub const OUTLINE: Shortcut = ("Show outline", "cmd-shift-b", "ctrl-shift-b");
    pub const SOURCE_MODE: Shortcut = ("Toggle Markdown source", "cmd-/", "ctrl-/");
    pub const SETTINGS: Shortcut = ("Settings", "cmd-,", "ctrl-,");
    pub const ALL: [Shortcut; 9] = [
        NEW,
        OPEN,
        OPEN_FOLDER,
        SAVE,
        SAVE_AS,
        CLOSE,
        OUTLINE,
        SOURCE_MODE,
        SETTINGS,
    ];

    pub fn key(shortcut: Shortcut) -> &'static str {
        if cfg!(target_os = "macos") {
            shortcut.1
        } else {
            shortcut.2
        }
    }

    pub fn display_key(binding: &str) -> String {
        binding
            .split('-')
            .map(|part| match part {
                "cmd" => "⌘".to_owned(),
                "ctrl" => "Ctrl".to_owned(),
                "alt" if cfg!(target_os = "macos") => "⌥".to_owned(),
                "alt" => "Alt".to_owned(),
                "shift" => "Shift".to_owned(),
                other => other.to_uppercase(),
            })
            .collect::<Vec<_>>()
            .join(" ")
    }
}

const APP_NAME: &str = "Inkpoint";

fn main() {
    let startup_path = std::env::args_os().nth(1).map(PathBuf::from);
    let (open_paths, mut pending_paths) = mpsc::unbounded();
    let app = application()
        .with_assets(assets::Assets)
        .with_quit_mode(QuitMode::LastWindowClosed);
    app.on_open_urls(move |urls| {
        let path = urls
            .into_iter()
            .filter_map(|url| url::Url::parse(&url).ok())
            .filter_map(|url| url.to_file_path().ok())
            .find(|path| document::is_markdown(path));
        if let Some(path) = path {
            let _ = open_paths.unbounded_send(path);
        }
    });
    app.run(move |cx| {
        init(cx);
        settings::init(cx);
        // The editor's own keys: arrows, enter, backspace, undo/redo, select all.
        // Without this the view never receives them and typing moves nothing.
        TypesetView::bind_keys(cx);
        cx.bind_keys([
            KeyBinding::new(
                shortcuts::key(shortcuts::NEW),
                NewDocument,
                Some("Inkpoint"),
            ),
            KeyBinding::new(
                shortcuts::key(shortcuts::OPEN),
                OpenDocument,
                Some("Inkpoint"),
            ),
            KeyBinding::new(
                shortcuts::key(shortcuts::OPEN_FOLDER),
                OpenFolder,
                Some("Inkpoint"),
            ),
            KeyBinding::new(
                shortcuts::key(shortcuts::SAVE),
                SaveDocument,
                Some("Inkpoint"),
            ),
            KeyBinding::new(shortcuts::key(shortcuts::SAVE_AS), SaveAs, Some("Inkpoint")),
            KeyBinding::new(
                shortcuts::key(shortcuts::CLOSE),
                CloseDocument,
                Some("Inkpoint"),
            ),
            KeyBinding::new(
                shortcuts::key(shortcuts::QUIT),
                CloseDocument,
                Some("Inkpoint"),
            ),
            KeyBinding::new(
                shortcuts::key(shortcuts::OUTLINE),
                ToggleOutline,
                Some("Inkpoint"),
            ),
            KeyBinding::new(shortcuts::key(shortcuts::SETTINGS), OpenSettings, None),
        ]);
        cx.set_menus([
            Menu::new(APP_NAME).items([MenuItem::action("Quit Inkpoint", CloseDocument)]),
            Menu::new("File").items([
                MenuItem::action("New", NewDocument),
                MenuItem::action("Open…", OpenDocument),
                MenuItem::action("Open Folder…", OpenFolder),
                MenuItem::action("Save", SaveDocument),
                MenuItem::action("Save As…", SaveAs),
                MenuItem::action("Close", CloseDocument),
            ]),
            Menu::new("Edit").items([
                MenuItem::action("Cut", Cut),
                MenuItem::action("Copy", Copy),
                MenuItem::action("Paste", Paste),
            ]),
            Menu::new("View").items([
                MenuItem::action("Toggle Outline", ToggleOutline),
                MenuItem::action("Toggle Markdown Source", ToggleSourceMode),
            ]),
            Menu::new("Format").items([
                MenuItem::action("Bold", FormatInline(InlineFormat::Bold)),
                MenuItem::action("Italic", FormatInline(InlineFormat::Italic)),
                MenuItem::action("Strikethrough", FormatInline(InlineFormat::Strikethrough)),
                MenuItem::action("Inline Code", FormatInline(InlineFormat::Code)),
                MenuItem::separator(),
                MenuItem::action("Heading 1", FormatBlock(BlockFormat::Heading(1))),
                MenuItem::action("Quote", FormatBlock(BlockFormat::Quote)),
                MenuItem::action("Bulleted List", FormatBlock(BlockFormat::UnorderedList)),
                MenuItem::action("Numbered List", FormatBlock(BlockFormat::OrderedList)),
                MenuItem::action("Task List", FormatBlock(BlockFormat::TaskList)),
            ]),
            Menu::new("AI").items([MenuItem::action(
                "Continue with Local AI",
                ContinueWithLocalAi,
            )]),
            Menu::new("Settings").items([MenuItem::action("Settings…", OpenSettings)]),
        ]);
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                None,
                size(px(1100.), px(760.)),
                cx,
            ))),
            window_min_size: Some(size(px(560.), px(460.))),
            ..component::TitleBar::window_options()
        };
        let (window, workspace) = open_window(options, cx, move |window, cx| {
            cx.new(|cx| {
                let mut workspace = Workspace::new(window, cx);
                if let Some(path) = startup_path {
                    workspace.load_document(path, window, cx);
                } else {
                    workspace.check_initial_session(window, cx);
                }
                workspace
            })
        })
        .expect("open Inkpoint GPUI window");
        let workspace = workspace.downgrade();
        cx.spawn(async move |cx| {
            while let Some(path) = pending_paths.next().await {
                let Some(workspace) = workspace.upgrade() else {
                    break;
                };
                let _ = cx.update_window(window, |_, window, cx| {
                    workspace.update(cx, |workspace, cx| workspace.open_path(path, window, cx));
                });
            }
        })
        .detach();
        cx.activate(true);
    });
}
