use std::{cmp::Reverse, fs, path::Path};

use serde::{Deserialize, Serialize};
use tauri::menu::{MenuItemBuilder, Submenu, SubmenuBuilder};

const MAX_RECENT_FILES: usize = 10;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct RecentFile {
    path: String,
    name: String,
    #[serde(rename = "lastOpenedAt")]
    last_opened_at: u64,
}

#[tauri::command]
pub(crate) fn load_recent_files() -> Vec<RecentFile> {
    let Some(data_dir) = dirs::data_dir() else {
        return Vec::new();
    };

    read_recent_files(&data_dir.join("md-editor/recent-files.json"))
}

#[tauri::command]
pub(crate) fn save_recent_files(recent_files: Vec<RecentFile>) -> Result<(), String> {
    let data_dir = dirs::data_dir()
        .ok_or_else(|| "Cannot resolve app data directory".to_string())?
        .join("md-editor");
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;
    write_recent_files(&data_dir.join("recent-files.json"), &recent_files)
}

pub(crate) fn build_open_recent_menu(app: &tauri::AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
    let recent_files = load_recent_files();
    let mut submenu = SubmenuBuilder::new(app, "Open Recent");

    if recent_files.is_empty() {
        submenu = submenu.item(&menu_item(app, "md-editor:no-recent", "No Recent Files")?);
    } else {
        for (index, file) in recent_files.iter().take(MAX_RECENT_FILES).enumerate() {
            let id = format!("md-editor:open-recent:{index}");
            submenu = submenu.item(&menu_item(app, &id, &file.name)?);
        }
        submenu = submenu.separator().item(&menu_item(
            app,
            "md-editor:clear-recent",
            "Clear Recent Files",
        )?);
    }

    submenu.build()
}

fn menu_item(
    app: &tauri::AppHandle,
    id: &str,
    label: &str,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    MenuItemBuilder::with_id(id, label).build(app)
}

fn read_recent_files(path: &Path) -> Vec<RecentFile> {
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(mut files) = serde_json::from_str::<Vec<RecentFile>>(&content) else {
        return Vec::new();
    };
    files.sort_by_key(|file| Reverse(file.last_opened_at));
    files.truncate(MAX_RECENT_FILES);
    files
}

fn write_recent_files(path: &Path, recent_files: &[RecentFile]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(recent_files)
        .map_err(|error| format!("Failed to serialize recent files: {error}"))?;
    fs::write(path, json).map_err(|error| format!("Failed to write recent files: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn recent_files_round_trip_sorted_and_bounded() {
        let path = std::env::temp_dir().join(format!(
            "md-editor-recent-files-{}-{}.json",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let files = (0..12)
            .map(|index| RecentFile {
                path: format!("/notes/{index}.md"),
                name: format!("{index}.md"),
                last_opened_at: index,
            })
            .collect::<Vec<_>>();

        write_recent_files(&path, &files).unwrap();
        let loaded = read_recent_files(&path);

        assert_eq!(loaded.len(), MAX_RECENT_FILES);
        assert_eq!(loaded[0].last_opened_at, 11);
        assert_eq!(loaded[9].last_opened_at, 2);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn malformed_recent_file_data_is_ignored() {
        let path = std::env::temp_dir().join(format!(
            "md-editor-invalid-recent-files-{}.json",
            std::process::id()
        ));
        fs::write(&path, "not json").unwrap();
        assert!(read_recent_files(&path).is_empty());
        fs::remove_file(path).unwrap();
    }
}
