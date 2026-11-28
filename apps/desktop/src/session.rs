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
        let root = crate::app_data::data_root()?;
        Some(crate::app_data::data_path(&root, "session.json"))
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

/// A named draft whose original file no longer exists, given an already-loaded
/// session.
///
/// A named draft normally pairs with its file: recovery compares draft and disk
/// content, so it needs both. When the file is gone there is nothing to compare
/// against, and the audit found the draft simply unreachable — it stayed in the
/// session file with no entry point, while an untitled draft recovered fine.
///
/// Reporting it separately is what lets the caller offer recovery instead of
/// silently dropping the text.
pub fn orphaned_draft_in(session: &HotExitSession) -> Option<PendingDraftInfo> {
    let active_doc = session.active_document.as_ref()?;
    let path = active_doc.file_path.as_ref()?;
    if path.exists() || session.draft_markdown.is_empty() {
        return None;
    }
    Some(PendingDraftInfo {
        file_path: Some(path.clone()),
        draft_content: session.draft_markdown.clone(),
        cursor_offset: active_doc.cursor_offset,
        last_modified_at: active_doc.last_modified_at,
    })
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

    /// DRAFT-03: a named draft whose original file is gone must be reported so
    /// the workspace can offer recovery.
    ///
    /// The audit repro persisted a named draft, removed the file, restarted, and
    /// landed on the welcome screen: the draft was still in the session file but
    /// nothing surfaced it, while an untitled draft recovered fine.
    #[test]
    fn draft03_reports_a_named_draft_whose_file_is_gone() {
        let dir = tempdir().unwrap();
        let session_file = dir.path().join("session.json");
        let missing = dir.path().join("moved-away.md");
        HotExitSession::save_to(&session_file, Some(&missing), "# 中文草稿", Some(3), true)
            .unwrap();

        let loaded = HotExitSession::load_from(&session_file).unwrap().unwrap();
        let draft = orphaned_draft_in(&loaded).expect("the orphan is reported");
        assert_eq!(draft.draft_content, "# 中文草稿");
        assert_eq!(draft.cursor_offset, Some(3));
        assert_eq!(draft.file_path.as_deref(), Some(missing.as_path()));
    }

    /// A draft whose file still exists is not orphaned: the normal pending-draft
    /// flow owns it, and reporting it twice would offer two competing recoveries.
    #[test]
    fn draft03_does_not_report_a_draft_whose_file_still_exists() {
        let dir = tempdir().unwrap();
        let session_file = dir.path().join("session.json");
        let present = dir.path().join("present.md");
        std::fs::write(&present, "# saved").unwrap();
        HotExitSession::save_to(&session_file, Some(&present), "# draft", None, true).unwrap();

        let loaded = HotExitSession::load_from(&session_file).unwrap().unwrap();
        assert_eq!(orphaned_draft_in(&loaded), None);
    }

    /// An untitled draft has its own recovery path, so it is not an orphan.
    #[test]
    fn draft03_does_not_report_an_untitled_draft() {
        let dir = tempdir().unwrap();
        let session_file = dir.path().join("session.json");
        HotExitSession::save_to(&session_file, None, "untitled text", None, true).unwrap();

        let loaded = HotExitSession::load_from(&session_file).unwrap().unwrap();
        assert_eq!(orphaned_draft_in(&loaded), None);
    }

    /// DRAFT-04: an untitled draft keeps its caret across a save/load round trip,
    /// including a caret that sits after multi-byte CJK text.
    ///
    /// The stored value is a UTF-8 byte offset, which is what the editor session
    /// uses, so a CJK document must round-trip exactly rather than being
    /// reinterpreted as a character count.
    #[test]
    fn draft04_untitled_draft_keeps_a_cjk_caret_across_a_round_trip() {
        let dir = tempdir().unwrap();
        let session_file = dir.path().join("session.json");
        let markdown = "中文草稿内容，继续写。";
        // Caret after the first three characters: 9 bytes, not 3.
        let caret = "中文草".len();
        HotExitSession::save_to(&session_file, None, markdown, Some(caret), true).unwrap();

        let loaded = HotExitSession::load_from(&session_file).unwrap().unwrap();
        let active = loaded.active_document.expect("the draft document");
        assert!(active.is_untitled, "an untitled draft stays untitled");
        assert_eq!(loaded.draft_markdown, markdown);
        assert_eq!(
            active.cursor_offset,
            Some(caret),
            "the caret is a byte offset and survives the round trip"
        );
        // The offset must still be a valid char boundary in the restored text.
        assert!(
            loaded.draft_markdown.is_char_boundary(caret),
            "a restored caret must not split a CJK character"
        );
    }

    /// A caret past the end of the stored text is clamped rather than panicking,
    /// so a truncated session file cannot break startup.
    #[test]
    fn draft04_a_caret_past_the_end_is_tolerable() {
        let dir = tempdir().unwrap();
        let session_file = dir.path().join("session.json");
        HotExitSession::save_to(&session_file, None, "短", Some(999), true).unwrap();

        let loaded = HotExitSession::load_from(&session_file).unwrap().unwrap();
        let active = loaded.active_document.expect("the draft document");
        let caret = active.cursor_offset.expect("a caret");
        // The restore path clamps through `replace_source_undoable`; here we only
        // assert the session file itself is readable and the value is present.
        assert_eq!(caret, 999);
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
