mod document;
mod folder;
mod image_assets;
mod local_ai;
mod workspace;

use futures::{StreamExt, channel::mpsc};
use gpui_kit::*;
use std::path::PathBuf;
use workspace::{
    CloseDocument, NewDocument, OpenDocument, OpenFolder, SaveAs, SaveDocument, Workspace,
};

const APP_NAME: &str = "Inkpoint GPUI Preview";

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
        cx.bind_keys([
            KeyBinding::new("cmd-n", NewDocument, Some("Inkpoint")),
            KeyBinding::new("cmd-o", OpenDocument, Some("Inkpoint")),
            KeyBinding::new("cmd-shift-o", OpenFolder, Some("Inkpoint")),
            KeyBinding::new("cmd-s", SaveDocument, Some("Inkpoint")),
            KeyBinding::new("cmd-shift-s", SaveAs, Some("Inkpoint")),
            KeyBinding::new("cmd-w", CloseDocument, Some("Inkpoint")),
            KeyBinding::new("cmd-q", CloseDocument, Some("Inkpoint")),
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
        ]);
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                None,
                size(px(1100.), px(760.)),
                cx,
            ))),
            window_min_size: Some(size(px(560.), px(460.))),
            ..Default::default()
        };
        let (window, workspace) = open_window(options, cx, move |window, cx| {
            cx.new(|cx| {
                let mut workspace = Workspace::new(window, cx);
                if let Some(path) = startup_path {
                    workspace.load_document(path, window, cx);
                } else {
                    workspace.focus(window, cx);
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
