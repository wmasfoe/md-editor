use std::{fs, path::PathBuf};

fn session_dir() -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir()
        .ok_or_else(|| "Cannot resolve app data directory".to_string())?
        .join("md-editor/sessions");
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Failed to create sessions directory: {error}"))?;
    Ok(data_dir)
}

fn drafts_dir() -> Result<PathBuf, String> {
    let dir = session_dir()?.join("drafts");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create drafts directory: {error}"))?;
    Ok(dir)
}

fn history_dir(doc_hash: &str) -> Result<PathBuf, String> {
    // 消毒以防目录遍历
    let safe_hash: String = doc_hash
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    if safe_hash.is_empty() {
        return Err("Invalid document hash".to_string());
    }

    let dir = dirs::data_dir()
        .ok_or_else(|| "Cannot resolve app data directory".to_string())?
        .join("md-editor/history")
        .join(safe_hash);
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create history directory: {error}"))?;
    Ok(dir)
}

fn sanitize_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

#[tauri::command]
pub(crate) fn load_persisted_session() -> Result<Option<String>, String> {
    let path = session_dir()?.join("session.json");
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read session file: {error}"))?;
    Ok(Some(content))
}

#[tauri::command]
pub(crate) fn save_persisted_session(session_json: String) -> Result<(), String> {
    let path = session_dir()?.join("session.json");
    fs::write(&path, session_json).map_err(|error| format!("Failed to write session file: {error}"))
}

#[tauri::command]
pub(crate) fn clear_persisted_session() -> Result<(), String> {
    let path = session_dir()?.join("session.json");
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn load_draft_file(draft_id: String) -> Result<Option<String>, String> {
    let safe_id = sanitize_id(&draft_id);
    let path = drafts_dir()?.join(format!("{safe_id}.draft.md"));
    if !path.exists() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(&path).map_err(|error| format!("Failed to read draft file: {error}"))?;
    Ok(Some(content))
}

#[tauri::command]
pub(crate) fn save_draft_file(draft_id: String, content: String) -> Result<(), String> {
    let safe_id = sanitize_id(&draft_id);
    let path = drafts_dir()?.join(format!("{safe_id}.draft.md"));
    fs::write(&path, content).map_err(|error| format!("Failed to write draft file: {error}"))
}

#[tauri::command]
pub(crate) fn delete_draft_file(draft_id: String) -> Result<(), String> {
    let safe_id = sanitize_id(&draft_id);
    let path = drafts_dir()?.join(format!("{safe_id}.draft.md"));
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn list_draft_files() -> Result<Vec<String>, String> {
    let dir = drafts_dir()?;
    let mut drafts = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(id) = name.strip_suffix(".draft.md") {
                drafts.push(id.to_string());
            }
        }
    }
    Ok(drafts)
}

#[tauri::command]
pub(crate) fn load_history_index(doc_hash: String) -> Result<Option<String>, String> {
    let path = history_dir(&doc_hash)?.join("index.json");
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read history index: {error}"))?;
    Ok(Some(content))
}

#[tauri::command]
pub(crate) fn save_history_index(doc_hash: String, index_json: String) -> Result<(), String> {
    let path = history_dir(&doc_hash)?.join("index.json");
    fs::write(&path, index_json).map_err(|error| format!("Failed to write history index: {error}"))
}

#[tauri::command]
pub(crate) fn load_history_snapshot(
    doc_hash: String,
    snapshot_id: String,
) -> Result<Option<String>, String> {
    let safe_snap = sanitize_id(&snapshot_id);
    let snapshots_dir = history_dir(&doc_hash)?.join("snapshots");
    let path = snapshots_dir.join(format!("{safe_snap}.snap"));
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read snapshot file: {error}"))?;
    Ok(Some(content))
}

#[tauri::command]
pub(crate) fn save_history_snapshot(
    doc_hash: String,
    snapshot_id: String,
    content: String,
) -> Result<(), String> {
    let safe_snap = sanitize_id(&snapshot_id);
    let snapshots_dir = history_dir(&doc_hash)?.join("snapshots");
    fs::create_dir_all(&snapshots_dir)
        .map_err(|error| format!("Failed to create snapshots directory: {error}"))?;
    let path = snapshots_dir.join(format!("{safe_snap}.snap"));
    fs::write(&path, content).map_err(|error| format!("Failed to write snapshot file: {error}"))
}

#[tauri::command]
pub(crate) fn delete_history_snapshot(doc_hash: String, snapshot_id: String) -> Result<(), String> {
    let safe_snap = sanitize_id(&snapshot_id);
    let path = history_dir(&doc_hash)?
        .join("snapshots")
        .join(format!("{safe_snap}.snap"));
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    Ok(())
}
