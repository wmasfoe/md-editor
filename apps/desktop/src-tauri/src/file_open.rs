#[cfg(any(not(target_os = "macos"), test))]
use std::ffi::OsString;
#[cfg(any(not(target_os = "macos"), test))]
use std::path::Path;
use std::{collections::VecDeque, path::PathBuf, sync::Mutex};

use crate::file_commands::path_utils::is_markdown_path;

#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};
use tauri::{Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
pub(crate) const FILE_OPEN_EVENT: &str = "md-editor-file-open";

#[derive(Default)]
pub(crate) struct PendingFileOpens(Mutex<VecDeque<PathBuf>>);

impl PendingFileOpens {
    fn enqueue(&self, path: PathBuf) {
        // Retain requests delivered before the webview registers its event listener.
        if let Ok(mut paths) = self.0.lock() {
            paths.push_back(path);
        }
    }
    fn take(&self) -> Option<String> {
        self.0
            .lock()
            .ok()?
            .pop_front()
            .map(|path| path.to_string_lossy().into_owned())
    }
}

#[tauri::command]
pub(crate) fn take_pending_file_open<R: Runtime>(
    window: WebviewWindow<R>,
    pending: tauri::State<'_, PendingFileOpens>,
) -> Result<Option<String>, String> {
    if !crate::platform_contract::is_main_webview(window.label()) {
        return Err("Only the main window can consume opened files".into());
    }
    Ok(pending.take())
}

#[cfg(any(not(target_os = "macos"), test))]
pub(crate) fn enqueue_cli_arguments(
    pending: &PendingFileOpens,
    args: impl IntoIterator<Item = OsString>,
    cwd: &Path,
) {
    // Windows and Linux launch file associations with paths in argv; macOS uses Opened URLs.
    for arg in args {
        if arg.to_string_lossy().starts_with('-') {
            continue;
        }
        // Desktop launchers can provide either a filesystem path or a file URI.
        // Decode URIs with Tauri's URL type, never by trimming a file:// prefix.
        let text = arg.to_string_lossy();
        let path = if text.contains("://") {
            let Some(path) = tauri::Url::parse(&text)
                .ok()
                .and_then(|url| url.to_file_path().ok())
            else {
                continue;
            };
            path
        } else {
            PathBuf::from(arg)
        };
        if !is_markdown_path(&path) {
            continue;
        }
        pending.enqueue(if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        });
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn enqueue_opened_urls<R: Runtime>(
    app: &tauri::AppHandle<R>,
    urls: Vec<tauri::Url>,
    pending: &PendingFileOpens,
) {
    for path in opened_url_paths(urls) {
        pending.enqueue(path.clone());
        if let Some(window) = app.get_webview_window(crate::platform_contract::MAIN_WINDOW_LABEL) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit(FILE_OPEN_EVENT, ());
        }
    }
}

#[cfg(any(target_os = "macos", test))]
fn opened_url_paths(urls: impl IntoIterator<Item = tauri::Url>) -> Vec<PathBuf> {
    urls.into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| is_markdown_path(path))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queue_preserves_cold_and_warm_opens_in_order() {
        let queue = PendingFileOpens::default();
        queue.enqueue(PathBuf::from("a.md"));
        queue.enqueue(PathBuf::from("b.md"));
        assert_eq!(queue.take().as_deref(), Some("a.md"));
        assert_eq!(queue.take().as_deref(), Some("b.md"));
        assert_eq!(queue.take(), None);
    }
    #[test]
    fn cli_arguments_filter_flags_and_resolve_relative_markdown_paths() {
        let queue = PendingFileOpens::default();
        enqueue_cli_arguments(
            &queue,
            [
                "--flag".into(),
                "notes/a.md".into(),
                "image.png".into(),
                "/tmp/b.MDX".into(),
            ],
            Path::new("/work"),
        );
        assert_eq!(queue.take().as_deref(), Some("/work/notes/a.md"));
        assert_eq!(queue.take().as_deref(), Some("/tmp/b.MDX"));
        assert_eq!(queue.take(), None);
    }

    #[test]
    fn cli_file_urls_decode_paths_and_ignore_remote_urls() {
        let queue = PendingFileOpens::default();
        let path = std::env::temp_dir().join("中文 #1.md");
        enqueue_cli_arguments(
            &queue,
            [
                tauri::Url::from_file_path(&path)
                    .unwrap()
                    .to_string()
                    .into(),
                "https://example.com/notes.md".into(),
            ],
            Path::new("/work"),
        );
        assert_eq!(queue.take(), Some(path.to_string_lossy().into_owned()));
        assert_eq!(queue.take(), None);
    }

    #[test]
    fn opened_urls_decode_file_paths_and_ignore_non_files_and_unsupported_types() {
        let urls = [
            "file:///Users/ik/notes/space%20and%20%C3%A4%23%E4%B8%AD.md",
            "https://example.com/notes.md",
            "file:///Users/ik/notes/image.png",
        ]
        .into_iter()
        .map(|url| tauri::Url::parse(url).expect("valid URL"));

        assert_eq!(
            opened_url_paths(urls),
            vec![PathBuf::from("/Users/ik/notes/space and ä#中.md")]
        );
    }

    #[test]
    fn every_bundled_file_association_is_accepted_by_the_document_loader() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid Tauri config");
        for association in config["bundle"]["fileAssociations"].as_array().unwrap() {
            for extension in association["ext"].as_array().unwrap() {
                let path = PathBuf::from(format!("document.{}", extension.as_str().unwrap()));
                assert!(is_markdown_path(&path), "unsupported association: {path:?}");
            }
        }
    }
}
