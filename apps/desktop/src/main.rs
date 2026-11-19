mod appearance;
mod document;
mod folder;
mod image_assets;
mod local_ai;
mod settings;
mod workspace;

use futures::{StreamExt, channel::mpsc};
use gpui_kit::*;
use inkpoint_editor_gpui::{BlockFormat, HostCommand::*, InlineFormat};
use settings::OpenSettings;
use std::path::PathBuf;
use workspace::{
    CloseDocument, ContinueWithLocalAi, NewDocument, OpenDocument, OpenFolder, SaveAs,
    SaveDocument, Workspace,
};

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
        cx.bind_keys([
            KeyBinding::new("cmd-n", NewDocument, Some("Inkpoint")),
            KeyBinding::new("cmd-o", OpenDocument, Some("Inkpoint")),
            KeyBinding::new("cmd-alt-o", OpenFolder, Some("Inkpoint")),
            KeyBinding::new("cmd-s", SaveDocument, Some("Inkpoint")),
            KeyBinding::new("cmd-shift-s", SaveAs, Some("Inkpoint")),
            KeyBinding::new("cmd-w", CloseDocument, Some("Inkpoint")),
            KeyBinding::new("cmd-q", CloseDocument, Some("Inkpoint")),
            KeyBinding::new("cmd-/", ToggleSourceMode, Some("Inkpoint")),
            KeyBinding::new("cmd-shift-b", ToggleOutline, Some("Inkpoint")),
            KeyBinding::new(
                if cfg!(target_os = "macos") {
                    "cmd-,"
                } else {
                    "ctrl-,"
                },
                OpenSettings,
                None,
            ),
            KeyBinding::new("cmd-b", FormatInline(InlineFormat::Bold), Some("Inkpoint")),
            KeyBinding::new(
                "cmd-i",
                FormatInline(InlineFormat::Italic),
                Some("Inkpoint"),
            ),
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
            // The source / block / split entries are gone: the GPUI editor
            // renders and edits at once, so there is no mode to switch between.
            Menu::new("View").items([MenuItem::action("Toggle Outline", ToggleOutline)]),
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
