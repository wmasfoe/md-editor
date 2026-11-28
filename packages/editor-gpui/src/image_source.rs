//! Resolving a document's image URIs to local files.
//!
//! A relative image reference (`./assets/image-1.png`) is relative to the
//! *document*, not to the process working directory and not to a server. The
//! audit's repro pasted a PNG, saw the bytes and the Markdown reference land
//! correctly, and then watched the renderer's HTTP client receive the relative
//! path — so the preview was missing while the file was on disk.
//!
//! This module decides only *which file* a URI names. Reading the bytes and
//! caching the decode stay with the renderer, so the policy is testable without
//! a window.

use std::path::{Component, Path, PathBuf};

/// The local file a document-relative image URI names, if it names one.
///
/// Returns `None` for anything the host's default resolution should keep
/// handling: remote URLs and inline data URIs. Returning `None` is deliberate
/// rather than falling back to a path, because turning `https://…` into a file
/// path would replace a working network image with a missing local one.
pub fn local_image_path(uri: &str, document_directory: Option<&Path>) -> Option<PathBuf> {
    let uri = uri.trim();
    if uri.is_empty() {
        return None;
    }
    // Remote and inline sources are the renderer's business.
    if has_remote_or_inline_scheme(uri) {
        return None;
    }
    // A `file:` URI is local but needs decoding, which the host's own resolver
    // already does correctly; do not re-implement percent-decoding here.
    if uri
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("file:"))
    {
        return None;
    }

    let candidate = PathBuf::from(uri);
    if candidate.is_absolute() {
        return normalize(&candidate);
    }
    // A relative reference needs a base. Without a saved document there is no
    // directory to be relative to, so leave it to the default resolver rather
    // than guessing.
    let directory = document_directory?;
    normalize(&directory.join(candidate))
}

/// Whether the URI is remote or inline, i.e. not a local file reference.
fn has_remote_or_inline_scheme(uri: &str) -> bool {
    let Some(colon) = uri.find(':') else {
        return false;
    };
    let scheme = &uri[..colon];
    if scheme.is_empty()
        || !scheme
            .chars()
            .next()
            .is_some_and(|ch| ch.is_ascii_alphabetic())
    {
        return false;
    }
    if !scheme
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
    {
        return false;
    }
    // Anything with a scheme other than `file:` is treated as remote/inline:
    // `http`, `https`, `data`, and also custom schemes a plugin might use. Only
    // a bare path is resolved locally.
    true
}

/// Resolves `.` and `..` textually so the reported path is the one in use.
///
/// `canonicalize` would need the file to exist, and a missing image should still
/// produce a stable path the host can report.
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

    fn document_dir() -> PathBuf {
        PathBuf::from("/notes")
    }

    #[test]
    fn a_relative_reference_resolves_against_the_document_directory() {
        let resolved = local_image_path("./assets/image-1.png", Some(&document_dir()));
        assert_eq!(
            resolved,
            Some(PathBuf::from("/notes/assets/image-1.png")),
            "the reference is relative to the document, not the process"
        );
    }

    #[test]
    fn a_parent_relative_reference_climbs_out_of_the_document_directory() {
        let resolved = local_image_path("../shared/image.png", Some(&document_dir()));
        assert_eq!(resolved, Some(PathBuf::from("/shared/image.png")));
    }

    #[test]
    fn a_relative_reference_without_a_document_directory_is_left_to_the_host() {
        assert_eq!(local_image_path("./assets/image.png", None), None);
    }

    #[test]
    fn an_absolute_path_is_used_as_is() {
        let resolved = local_image_path("/Users/example/image.png", Some(&document_dir()));
        assert_eq!(resolved, Some(PathBuf::from("/Users/example/image.png")));
    }

    #[test]
    fn remote_urls_are_not_turned_into_paths() {
        for uri in [
            "https://example.com/image.png",
            "http://example.com/image.png",
            "data:image/png;base64,AAAA",
        ] {
            assert_eq!(
                local_image_path(uri, Some(&document_dir())),
                None,
                "{uri} must keep the renderer's default resolution"
            );
        }
    }

    #[test]
    fn a_file_uri_is_left_to_the_hosts_resolver() {
        // Decoding a `file:` URI correctly is the host's job; re-implementing it
        // here is how percent-encoding bugs get duplicated.
        assert_eq!(
            local_image_path("file:///notes/a%20b.png", Some(&document_dir())),
            None
        );
    }

    #[test]
    fn an_empty_uri_resolves_to_nothing() {
        assert_eq!(local_image_path("   ", Some(&document_dir())), None);
    }

    #[test]
    fn a_bare_filename_resolves_beside_the_document() {
        assert_eq!(
            local_image_path("image.png", Some(&document_dir())),
            Some(PathBuf::from("/notes/image.png"))
        );
    }
}
