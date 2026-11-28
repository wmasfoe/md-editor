//! Where a pasted image goes, and what reference the document gets.
//!
//! Two things are decided here, and both have user-visible contracts
//! (`docs/agent/specs/image_path_resolution_and_directory_creation_spec.md`):
//!
//! * **Where the bytes land.** The setting may be relative to the document
//!   (`./assets`, `../assets`), absolute, or contain `${filename}`, which
//!   expands to the document's base name so each note can own a folder.
//! * **What the Markdown says.** The inserted reference must use forward
//!   slashes on every platform. A Windows build writing `assets\image.png`
//!   produces a document whose images break when it is opened anywhere else.
//!
//! A directory that does not exist yet is *reported*, not created: silently
//! making folders inside the user's workspace is explicitly out of contract, and
//! so is failing without telling them. The caller asks, then calls
//! [`create_missing_directories`].

use std::{
    fs,
    io::{self, Write},
    path::{Component, Path, PathBuf},
};

use gpui_kit::Image;

/// Placeholder that expands to the document's base name.
const FILENAME_VARIABLE: &str = "${filename}";

/// Resolved destination for a pasted image.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ImageDestination {
    /// Absolute directory the image will be written into.
    pub(crate) directory: PathBuf,
    /// Directory that must exist before writing, if it does not already.
    pub(crate) missing_directory: Option<PathBuf>,
}

/// Resolves the setting against the document's location.
///
/// `document_path` is `None` for an untitled document. There is no folder to be
/// relative to then, so the caller must save first; returning `None` here keeps
/// the decision at the call site instead of inventing a directory somewhere.
pub(crate) fn resolve_destination(
    document_path: Option<&Path>,
    setting: &str,
) -> Option<ImageDestination> {
    let document_path = document_path?;
    let parent = document_path.parent()?;
    let expanded = expand_filename(setting, document_path);
    let trimmed = expanded.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidate = PathBuf::from(trimmed);
    let absolute = if candidate.is_absolute() {
        candidate
    } else {
        parent.join(candidate)
    };
    // Normalise `.` and `..` textually so the path reported to the user is the
    // one that will actually be used, and so `../assets` does not read as a
    // child of the document.
    let directory = normalize(&absolute)?;
    let missing_directory = (!directory.exists()).then(|| directory.clone());
    Some(ImageDestination {
        directory,
        missing_directory,
    })
}

/// Expands `${filename}` to the document's base name.
///
/// An untitled document has no name, so the variable expands to `untitled`
/// rather than an empty string: `${filename}` with nothing substituted would
/// produce `./assets//` and a path that means something different.
fn expand_filename(setting: &str, document_path: &Path) -> String {
    let base = document_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("untitled");
    setting.replace(FILENAME_VARIABLE, base)
}

/// Resolves `.` and `..` without touching the filesystem.
///
/// `canonicalize` cannot be used for a directory that does not exist yet, which
/// is the case this function exists for. Returns `None` when the path escapes
/// past its root, which would mean the setting is malformed.
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

/// Creates `directory` and its parents.
///
/// Only called after the user confirmed: creating folders in their workspace is
/// their decision, not a side effect of pasting an image.
pub(crate) fn create_missing_directories(directory: &Path) -> io::Result<()> {
    fs::create_dir_all(directory)
}

/// Writes `image` into `destination` and returns the Markdown reference.
///
/// The reference is relative to the document when the destination is inside the
/// document's folder, and uses forward slashes either way.
pub(crate) fn store_image_in(
    document_path: &Path,
    destination: &Path,
    image: &Image,
) -> io::Result<String> {
    fs::create_dir_all(destination)?;

    // Resolve the real directory before writing. A symlinked `assets` folder can
    // point anywhere, and writing through it would put the user's image outside
    // the workspace they thought they were writing into. Only enforced when the
    // destination is meant to be inside the document's folder: an absolute
    // setting is an explicit choice of another location.
    //
    // Two different path forms are needed, and mixing them is what made an
    // earlier version of this guard silently inert on macOS:
    //
    // * "was this meant to be inside the document folder?" is a question about
    //   the *textual* path, because that is how the setting was resolved;
    // * "did it actually end up inside?" is a question about the *canonical*
    //   path, because only that follows symlinks.
    //
    // `/var` canonicalizes to `/private/var`, so comparing a textual destination
    // against a canonical parent reports "outside" for every ordinary path and
    // disables the check.
    let raw_parent = document_path
        .parent()
        .ok_or_else(|| io::Error::other("The document has no containing directory."))?;
    let parent = raw_parent.canonicalize()?;
    let directory = destination.canonicalize()?;
    let intended_inside_document_folder = normalize(destination)
        .zip(normalize(raw_parent))
        .is_some_and(|(destination, parent)| destination.starts_with(parent));
    if intended_inside_document_folder && !directory.starts_with(&parent) {
        return Err(io::Error::other(
            "The image directory resolves outside the document folder.",
        ));
    }

    let extension = format!(".{}", image.format.extension());
    let mut file = tempfile::Builder::new()
        .prefix("image-")
        .suffix(&extension)
        .tempfile_in(&directory)?;
    file.write_all(&image.bytes)?;
    file.as_file().sync_all()?;
    let (_, path) = file.keep()?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::other("Could not read the saved image filename."))?;

    let relative = path
        .strip_prefix(&parent)
        .map(|relative| relative.to_path_buf())
        .unwrap_or_else(|_| path.clone());
    Ok(reference_for(&relative, name, path.starts_with(&parent)))
}

/// Builds the Markdown reference with forward slashes.
///
/// `relative` is the path from the document's folder when `inside_document_folder`
/// holds; otherwise the absolute directory is used, because a reference cannot
/// climb out of an unrelated tree.
fn reference_for(relative: &Path, name: &str, inside_document_folder: bool) -> String {
    if !inside_document_folder {
        let directory = relative
            .parent()
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        return format!("{directory}/{name}");
    }
    let directory = relative
        .parent()
        .map(|parent| parent.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    if directory.is_empty() {
        format!("./{name}")
    } else if directory.starts_with('.') {
        format!("{directory}/{name}")
    } else {
        format!("./{directory}/{name}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(root: &Path) -> PathBuf {
        root.join("notes/note.md")
    }

    #[test]
    fn default_setting_resolves_beside_the_document() {
        let root = tempfile::tempdir().unwrap();
        let doc = document(root.path());
        let resolved = resolve_destination(Some(&doc), "./assets").unwrap();
        assert_eq!(resolved.directory, root.path().join("notes/assets"));
    }

    #[test]
    fn parent_relative_setting_climbs_out_of_the_document_folder() {
        let root = tempfile::tempdir().unwrap();
        let doc = document(root.path());
        let resolved = resolve_destination(Some(&doc), "../shared/assets").unwrap();
        // `..` is collapsed textually so the reported directory is the one that
        // will be used, rather than a path that still reads as a child of the
        // document's folder.
        assert_eq!(resolved.directory, root.path().join("shared/assets"));
    }

    #[test]
    fn filename_variable_expands_to_the_document_base_name() {
        let root = tempfile::tempdir().unwrap();
        let doc = document(root.path());
        let resolved = resolve_destination(Some(&doc), "./assets/${filename}").unwrap();
        assert_eq!(
            resolved.directory,
            root.path().join("notes/assets/note"),
            "${{filename}} becomes the base name without the extension"
        );
    }

    #[test]
    fn an_absolute_setting_is_used_as_is() {
        let root = tempfile::tempdir().unwrap();
        let doc = document(root.path());
        let absolute = root.path().join("images");
        let resolved = resolve_destination(Some(&doc), &absolute.to_string_lossy()).unwrap();
        assert_eq!(resolved.directory, absolute);
    }

    #[test]
    fn a_missing_directory_is_reported_rather_than_created() {
        let root = tempfile::tempdir().unwrap();
        let doc = document(root.path());
        let resolved = resolve_destination(Some(&doc), "./fresh/assets").unwrap();
        assert_eq!(
            resolved.missing_directory.as_deref(),
            Some(root.path().join("notes/fresh/assets").as_path())
        );
        assert!(
            !root.path().join("notes/fresh").exists(),
            "resolving must not create anything"
        );
    }

    #[test]
    fn an_existing_directory_is_not_reported_as_missing() {
        let root = tempfile::tempdir().unwrap();
        let doc = document(root.path());
        fs::create_dir_all(root.path().join("notes/assets")).unwrap();
        let resolved = resolve_destination(Some(&doc), "./assets").unwrap();
        assert_eq!(resolved.missing_directory, None);
    }

    #[test]
    fn an_untitled_document_has_no_destination() {
        assert_eq!(resolve_destination(None, "./assets"), None);
    }

    #[test]
    fn empty_setting_is_rejected() {
        let root = tempfile::tempdir().unwrap();
        let doc = document(root.path());
        assert_eq!(resolve_destination(Some(&doc), "   "), None);
    }

    #[test]
    fn references_use_forward_slashes() {
        let reference = reference_for(Path::new("assets/image-1.png"), "image-1.png", true);
        assert_eq!(reference, "./assets/image-1.png");
        assert!(!reference.contains('\\'));
    }

    #[test]
    fn a_reference_in_the_document_folder_starts_with_dot_slash() {
        let reference = reference_for(Path::new("image-1.png"), "image-1.png", true);
        assert_eq!(reference, "./image-1.png");
    }

    #[test]
    fn an_absolute_destination_produces_an_absolute_reference() {
        let reference = reference_for(
            Path::new("/Users/example/images/image-1.png"),
            "image-1.png",
            false,
        );
        assert_eq!(reference, "/Users/example/images/image-1.png");
    }
}
