mod app_data;
mod appearance;
mod document;
mod folder;
mod image_assets;
mod link_target;
mod local_ai;
pub(crate) mod session;
mod settings;
mod system_open;
mod workspace;

use futures::{StreamExt, channel::mpsc};
use gpui_kit::*;
use inkpoint_editor_gpui::{
    AlignmentChoice, BlockFormat, Copy, Cut, HostCommand::*, InlineFormat, Paste, TableCommand,
    ToggleSourceMode, TypesetView,
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
    let (open_requests, mut pending_requests) = mpsc::unbounded();
    let app = application()
        .with_assets(assets::Assets)
        .with_quit_mode(QuitMode::LastWindowClosed);
    // Each `on_open_urls` callback is one delivery. Giving it a sequence number
    // is what lets the queue tell a repeated wake-up for the same request (drop
    // the duplicate) apart from two deliberate opens of one file (keep both).
    let mut deliveries = system_open::DeliverySequence::default();
    let ingress_log = system_open::IngressLog::from_env();
    let ingress_writer = ingress_log.clone();
    app.on_open_urls(move |urls| {
        let delivery = deliveries.next();
        let requests = system_open::requests_from_urls(delivery, urls, document::is_markdown);
        // A callback that delivered nothing supported is not an error: macOS
        // also reports non-file and non-Markdown items here. Logging the raw
        // count is what separates "the OS never delivered it" from "the app
        // dropped it" during a rehearsal.
        ingress_writer.record(system_open::IngressEvent::Delivered {
            delivery,
            url_count: requests.len(),
        });
        for request in requests {
            let _ = open_requests.unbounded_send(request);
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
            Menu::new("Table").items([
                MenuItem::action("Insert Row Above", Table(TableCommand::InsertRowAbove)),
                MenuItem::action("Insert Row Below", Table(TableCommand::InsertRowBelow)),
                MenuItem::action("Delete Row", Table(TableCommand::DeleteRow)),
                MenuItem::separator(),
                MenuItem::action("Insert Column Left", Table(TableCommand::InsertColumnLeft)),
                MenuItem::action(
                    "Insert Column Right",
                    Table(TableCommand::InsertColumnRight),
                ),
                MenuItem::action("Delete Column", Table(TableCommand::DeleteColumn)),
                MenuItem::separator(),
                MenuItem::action(
                    "Align Default",
                    Table(TableCommand::SetAlignment(AlignmentChoice::Default)),
                ),
                MenuItem::action(
                    "Align Left",
                    Table(TableCommand::SetAlignment(AlignmentChoice::Left)),
                ),
                MenuItem::action(
                    "Align Center",
                    Table(TableCommand::SetAlignment(AlignmentChoice::Center)),
                ),
                MenuItem::action(
                    "Align Right",
                    Table(TableCommand::SetAlignment(AlignmentChoice::Right)),
                ),
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
        // One FIFO consumer. Each request is attempted exactly once, but only
        // when the workspace can accept it: dequeuing into a busy workspace loses
        // the item, because the open path refuses silently and the identity is
        // already consumed (OPEN-03).
        let mut queue = system_open::SystemOpenQueue::default();
        let consume_log = ingress_log.clone();
        cx.spawn(async move |cx| {
            while let Some(request) = pending_requests.next().await {
                queue.enqueue([request]);
                while let Some(next) = queue.front().cloned() {
                    let Some(workspace) = workspace.upgrade() else {
                        break;
                    };
                    // Wait for the workspace to be ready instead of consuming the
                    // request into a refusal. `file_busy` clears when the current
                    // operation finishes and `composing` when the IME commits.
                    let ready =
                        cx.update(|cx| workspace.read_with(cx, |w, cx| w.can_accept_open(cx)));
                    if !ready {
                        cx.background_executor()
                            .timer(std::time::Duration::from_millis(20))
                            .await;
                        continue;
                    }
                    let Some(request) = queue.dequeue() else {
                        break;
                    };
                    debug_assert_eq!(request.identity, next.identity);
                    consume_log.record(system_open::IngressEvent::Consumed {
                        identity: request.identity.clone(),
                        path: request.path.clone(),
                    });
                    let _ = cx.update_window(window, |_, window, cx| {
                        workspace.update(cx, |workspace, cx| {
                            workspace.open_path(request.path, window, cx)
                        });
                    });
                    // The open just started may itself be busy; the next iteration
                    // waits for it rather than dropping the following item.
                }
            }
        })
        .detach();
        cx.activate(true);
    });
}
