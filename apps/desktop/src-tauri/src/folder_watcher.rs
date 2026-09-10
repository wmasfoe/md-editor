use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const FOLDER_CHANGED_EVENT: &str = "md-editor-folder-changed";

pub struct FolderWatcherState {
    debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
    watched_path: Mutex<Option<PathBuf>>,
}

impl Default for FolderWatcherState {
    fn default() -> Self {
        Self {
            debouncer: Mutex::new(None),
            watched_path: Mutex::new(None),
        }
    }
}

pub fn is_ignored_path(path: &Path) -> bool {
    for component in path.components() {
        let name = component.as_os_str().to_string_lossy();
        if name == ".git"
            || name == "node_modules"
            || name == "target"
            || name == "dist"
            || name == ".next"
            || name == ".DS_Store"
            || name == "Thumbs.db"
            || name == "desktop.ini"
        {
            return true;
        }
        if name.ends_with(".tmp") || name.ends_with(".swp") || name.ends_with('~') {
            return true;
        }
    }
    false
}

#[tauri::command]
pub(crate) fn watch_folder(
    app: AppHandle,
    state: tauri::State<'_, FolderWatcherState>,
    path: String,
) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() || !target.is_dir() {
        return Err(format!("Path does not exist or is not a directory: {path}"));
    }

    let canonical = std::fs::canonicalize(&target)
        .map_err(|error| format!("Failed to canonicalize {path}: {error}"))?;

    let mut watched_lock = state
        .watched_path
        .lock()
        .map_err(|_| "FolderWatcher lock poisoned".to_string())?;
    if let Some(current) = watched_lock.as_ref() {
        if current == &canonical {
            return Ok(());
        }
    }

    let mut debouncer_lock = state
        .debouncer
        .lock()
        .map_err(|_| "FolderWatcher lock poisoned".to_string())?;
    *debouncer_lock = None;

    let app_clone = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                let has_relevant = events.iter().any(|event| !is_ignored_path(&event.path));
                if has_relevant {
                    let _ = app_clone.emit(FOLDER_CHANGED_EVENT, ());
                }
            }
        },
    )
    .map_err(|error| format!("Failed to create folder debouncer: {error}"))?;

    debouncer
        .watcher()
        .watch(&canonical, RecursiveMode::Recursive)
        .map_err(|error| format!("Failed to watch folder {}: {error}", canonical.display()))?;

    *debouncer_lock = Some(debouncer);
    *watched_lock = Some(canonical);

    Ok(())
}

#[tauri::command]
pub(crate) fn unwatch_folder(state: tauri::State<'_, FolderWatcherState>) -> Result<(), String> {
    let mut debouncer_lock = state
        .debouncer
        .lock()
        .map_err(|_| "FolderWatcher lock poisoned".to_string())?;
    *debouncer_lock = None;
    let mut watched_lock = state
        .watched_path
        .lock()
        .map_err(|_| "FolderWatcher lock poisoned".to_string())?;
    *watched_lock = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn ignores_git_internal_files() {
        assert!(is_ignored_path(Path::new("/notes/.git/index")));
        assert!(is_ignored_path(Path::new("/notes/.git/objects/12/3456")));
    }

    #[test]
    fn ignores_build_artifacts_and_dependencies() {
        assert!(is_ignored_path(Path::new("/project/node_modules/lodash")));
        assert!(is_ignored_path(Path::new("/project/target/debug/app")));
        assert!(is_ignored_path(Path::new("/project/dist/bundle.js")));
        assert!(is_ignored_path(Path::new("/project/.next/cache")));
    }

    #[test]
    fn ignores_system_files_and_swap() {
        assert!(is_ignored_path(Path::new("/notes/.DS_Store")));
        assert!(is_ignored_path(Path::new("/notes/Thumbs.db")));
        assert!(is_ignored_path(Path::new("/notes/document.md.tmp")));
        assert!(is_ignored_path(Path::new("/notes/document.md.swp")));
        assert!(is_ignored_path(Path::new("/notes/document.md~")));
    }

    #[test]
    fn retains_markdown_and_image_assets() {
        assert!(!is_ignored_path(Path::new("/notes/post.md")));
        assert!(!is_ignored_path(Path::new("/notes/images/photo.png")));
        assert!(!is_ignored_path(Path::new(
            "/notes/subfolder/readme.markdown"
        )));
        assert!(!is_ignored_path(Path::new("/notes/assets/diagram.jpg")));
        assert!(!is_ignored_path(Path::new("/notes/imgs/new-image.webp")));
    }
}
