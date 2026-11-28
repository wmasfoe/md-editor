//! What a local link target resolves to, and how the host should open it.
//!
//! A Markdown document's links are written relative to *its own folder*, so
//! `[notes](./notes.md)` in `/docs/readme.md` means `/docs/notes.md` regardless
//! of where the app was launched from. The audit's requirement (LINK-03) is that
//! a relative document link, a same-folder asset and an external URL each reach
//! the right handler, and that the base path follows the active document.
//!
//! This module decides only *what the target is*. Opening a document, handing a
//! file to the system and reporting a miss stay with the caller, so the path
//! rules are testable without a window.

use std::path::{Component, Path, PathBuf};

use crate::document::is_markdown;

/// What a local link target means.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum LocalLink {
    /// Another Markdown document: open it in the editor.
    Document(PathBuf),
    /// A non-Markdown file: hand it to the system handler.
    Asset(PathBuf),
    /// The target does not exist.
    Missing(PathBuf),
    /// There is no base folder, because the document was never saved.
    NoBaseDirectory,
}

/// Resolves `target` against the active document's folder.
///
/// `document_path` is the document the link was clicked in. Its folder is the
/// base for relative targets; an absolute target ignores the base entirely.
pub(crate) fn resolve_local_link(document_path: Option<&Path>, target: &str) -> LocalLink {
    let target = target.trim();
    if target.is_empty() {
        return LocalLink::NoBaseDirectory;
    }

    let path_part = strip_query_and_fragment(target);
    if path_part.is_empty() {
        // `#anchor` or `?query` alone names no file. The editor resolves anchors
        // itself, so reaching here means a stray call rather than a local target.
        return LocalLink::NoBaseDirectory;
    }
    let raw = PathBuf::from(path_part);
    let resolved = if raw.is_absolute() {
        normalize(&raw)
    } else {
        // A relative link needs the document's folder. Without a saved document
        // there is nothing to be relative to, and guessing the process working
        // directory would silently point at the wrong place.
        let Some(base) = document_path.and_then(|path| path.parent()) else {
            return LocalLink::NoBaseDirectory;
        };
        normalize(&base.join(raw))
    };
    let Some(resolved) = resolved else {
        return LocalLink::NoBaseDirectory;
    };

    if !resolved.exists() {
        return LocalLink::Missing(resolved);
    }
    if is_markdown(&resolved) {
        LocalLink::Document(resolved)
    } else {
        LocalLink::Asset(resolved)
    }
}

/// Drops a `?query` or `#fragment` suffix.
///
/// A Markdown link may carry either even for a local file; neither is part of the
/// path. Splitting on the first occurrence is correct for filesystem paths, where
/// `?` and `#` are not valid name characters on the platforms this app targets.
fn strip_query_and_fragment(target: &str) -> &str {
    let end = target.find(['?', '#']).unwrap_or(target.len());
    &target[..end]
}

/// Resolves `.` and `..` textually.
///
/// `canonicalize` needs the file to exist, and a missing target still has to be
/// reported as a stable path.
fn normalize(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(root: &Path) -> PathBuf {
        root.join("docs/readme.md")
    }

    #[test]
    fn a_relative_document_link_resolves_beside_the_document() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("docs")).unwrap();
        std::fs::write(root.path().join("docs/notes.md"), "# notes").unwrap();
        let doc = document(root.path());

        assert_eq!(
            resolve_local_link(Some(&doc), "./notes.md"),
            LocalLink::Document(root.path().join("docs/notes.md")),
            "the link is relative to the document's folder, not the process"
        );
    }

    #[test]
    fn a_same_folder_asset_is_an_asset_not_a_document() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("docs")).unwrap();
        std::fs::write(root.path().join("docs/diagram.png"), [0x89]).unwrap();
        let doc = document(root.path());

        assert_eq!(
            resolve_local_link(Some(&doc), "diagram.png"),
            LocalLink::Asset(root.path().join("docs/diagram.png"))
        );
    }

    #[test]
    fn a_parent_relative_link_climbs_out_of_the_document_folder() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("shared")).unwrap();
        std::fs::write(root.path().join("shared/index.md"), "# index").unwrap();
        let doc = document(root.path());

        assert_eq!(
            resolve_local_link(Some(&doc), "../shared/index.md"),
            LocalLink::Document(root.path().join("shared/index.md"))
        );
    }

    #[test]
    fn a_missing_target_is_reported_rather_than_opened() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("docs")).unwrap();
        let doc = document(root.path());

        assert_eq!(
            resolve_local_link(Some(&doc), "./absent.md"),
            LocalLink::Missing(root.path().join("docs/absent.md"))
        );
    }

    #[test]
    fn an_unsaved_document_has_no_base_directory() {
        assert_eq!(
            resolve_local_link(None, "./notes.md"),
            LocalLink::NoBaseDirectory
        );
    }

    #[test]
    fn an_absolute_target_ignores_the_document_folder() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        std::fs::write(other.path().join("far.md"), "# far").unwrap();
        let doc = document(root.path());
        let target = other.path().join("far.md");

        // `normalize` is textual, so the expectation is the textual path: on
        // macOS the tempdir path is `/var/...` while `canonicalize` reports
        // `/private/var/...`, and comparing the two would fail for a reason that
        // has nothing to do with link resolution.
        assert_eq!(
            resolve_local_link(Some(&doc), &target.to_string_lossy()),
            LocalLink::Document(target),
            "an absolute target is used as given, not rebased on the document"
        );
    }

    #[test]
    fn a_fragment_or_query_is_not_part_of_the_path() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("docs")).unwrap();
        std::fs::write(root.path().join("docs/notes.md"), "# notes").unwrap();
        let doc = document(root.path());

        for target in ["./notes.md#section", "./notes.md?raw=1"] {
            assert_eq!(
                resolve_local_link(Some(&doc), target),
                LocalLink::Document(root.path().join("docs/notes.md")),
                "{target} must resolve to the file, not a name with punctuation"
            );
        }
    }

    #[test]
    fn a_bare_fragment_is_not_a_local_file() {
        // `#target` is an in-document anchor; the editor resolves those before
        // reaching the host, so this only guards against a stray call.
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("docs")).unwrap();
        let doc = document(root.path());
        assert_eq!(
            resolve_local_link(Some(&doc), "#target"),
            LocalLink::NoBaseDirectory
        );
    }
}
