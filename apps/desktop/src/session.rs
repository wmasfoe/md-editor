//! Hot exit session persistence and draft recovery for the GPUI desktop app.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

/// A snapshot of an open document's session state.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDocument {
    pub file_path: Option<PathBuf>,
    pub is_untitled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_offset: Option<usize>,
    pub last_modified_at: u64,
}

/// A serialized hot exit session state.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotExitSession {
    pub active_document: Option<SessionDocument>,
    pub draft_markdown: String,
}

/// Information about a pending draft that can be restored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingDraftInfo {
    pub file_path: Option<PathBuf>,
    pub draft_content: String,
    pub cursor_offset: Option<usize>,
    pub last_modified_at: u64,
}

impl HotExitSession {
    pub fn session_file_path() -> Option<PathBuf> {
        dirs::data_dir().map(|dir| dir.join("md-editor/session.json"))
    }

    pub fn load_from(path: &Path) -> io::Result<Option<Self>> {
        match fs::File::open(path) {
            Ok(file) => {
                let session: Self = serde_json::from_reader(io::BufReader::new(file))
                    .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
                Ok(Some(session))
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn load() -> io::Result<Option<Self>> {
        let Some(path) = Self::session_file_path() else {
            return Ok(None);
        };
        Self::load_from(&path)
    }

    pub fn save_to(
        session_path: &Path,
        file_path: Option<&Path>,
        markdown: &str,
        cursor_offset: Option<usize>,
        is_dirty: bool,
    ) -> io::Result<()> {
        if (!is_dirty && file_path.is_some()) || (file_path.is_none() && markdown.trim().is_empty())
        {
            if session_path.exists() {
                let _ = fs::remove_file(session_path);
            }
            return Ok(());
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let session = Self {
            active_document: Some(SessionDocument {
                file_path: file_path.map(|p| p.to_path_buf()),
                is_untitled: file_path.is_none(),
                cursor_offset,
                last_modified_at: now,
            }),
            draft_markdown: markdown.to_string(),
        };

        let parent = session_path
            .parent()
            .filter(|dir| !dir.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        fs::create_dir_all(parent)?;
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        serde_json::to_writer_pretty(file.as_file_mut(), &session)?;
        file.write_all(b"\n")?;
        file.as_file().sync_all()?;
        file.persist(session_path)?;
        Ok(())
    }

    pub fn save(
        file_path: Option<&Path>,
        markdown: &str,
        cursor_offset: Option<usize>,
        is_dirty: bool,
    ) -> io::Result<()> {
        let Some(session_path) = Self::session_file_path() else {
            return Ok(());
        };
        Self::save_to(&session_path, file_path, markdown, cursor_offset, is_dirty)
    }

    pub fn clear_at(session_path: &Path) -> io::Result<()> {
        if session_path.exists() {
            fs::remove_file(session_path)?;
        }
        Ok(())
    }

    pub fn clear() -> io::Result<()> {
        let Some(session_path) = Self::session_file_path() else {
            return Ok(());
        };
        Self::clear_at(&session_path)
    }
}

/// Checks if a session file contains a pending draft for `file_path`.
pub fn check_pending_draft_at(
    session_path: &Path,
    file_path: Option<&Path>,
    current_disk_content: &str,
) -> Option<PendingDraftInfo> {
    let session = HotExitSession::load_from(session_path).ok()??;
    let active_doc = session.active_document?;

    if active_doc.file_path.as_deref() != file_path {
        return None;
    }

    if session.draft_markdown == current_disk_content {
        let _ = HotExitSession::clear_at(session_path);
        return None;
    }

    Some(PendingDraftInfo {
        file_path: active_doc.file_path,
        draft_content: session.draft_markdown,
        cursor_offset: active_doc.cursor_offset,
        last_modified_at: active_doc.last_modified_at,
    })
}

pub fn check_pending_draft(
    file_path: Option<&Path>,
    current_disk_content: &str,
) -> Option<PendingDraftInfo> {
    let session_path = HotExitSession::session_file_path()?;
    check_pending_draft_at(&session_path, file_path, current_disk_content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn persists_and_restores_session_with_known_cursor() {
        let dir = tempdir().unwrap();
        let session_file = dir.path().join("session.json");
        let doc_path = Path::new("/notes/draft.md");

        HotExitSession::save_to(
            &session_file,
            Some(doc_path),
            "# Draft Content",
            Some(16),
            true,
        )
        .unwrap();

        assert!(session_file.exists());
        let pending =
            check_pending_draft_at(&session_file, Some(doc_path), "# Saved Content").unwrap();
        assert_eq!(pending.draft_content, "# Draft Content");
        assert_eq!(pending.cursor_offset, Some(16));
    }

    #[test]
    fn ignores_and_cleans_when_draft_matches_disk() {
        let dir = tempdir().unwrap();
        let session_file = dir.path().join("session.json");
        let doc_path = Path::new("/notes/clean.md");

        HotExitSession::save_to(&session_file, Some(doc_path), "# Clean Content", None, true)
            .unwrap();

        let pending = check_pending_draft_at(&session_file, Some(doc_path), "# Clean Content");
        assert!(pending.is_none());
        assert!(!session_file.exists());
    }

    #[test]
    fn clear_removes_session_file() {
        let dir = tempdir().unwrap();
        let session_file = dir.path().join("session.json");
        HotExitSession::save_to(&session_file, None, "untitled text", None, true).unwrap();
        assert!(session_file.exists());
        HotExitSession::clear_at(&session_file).unwrap();
        assert!(!session_file.exists());
    }
}
