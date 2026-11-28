//! Locates the directory that holds the app's own state.
//!
//! Settings, the hot-exit session and the local AI model cache all live under
//! one root. Keeping the lookup in a single place matters for two reasons:
//!
//! * The bundle identifier does not isolate state. Every build of the app reads
//!   the same `~/Library/Application Support/md-editor`, so a rehearsal or an
//!   automated run must be able to point the app at a throwaway root instead of
//!   touching real user data.
//! * Callers that each spelled out `dirs::data_dir().join("md-editor")` could
//!   drift apart, and one of them silently reading a different root is the kind
//!   of bug that only shows up as "my draft disappeared".

use std::path::{Path, PathBuf};

/// Environment variable that overrides the state root.
///
/// macOS release acceptance and E2E runs set this to a temporary directory so a
/// signed rehearsal build never reads or writes the developer's own drafts.
pub(crate) const DATA_ROOT_ENV: &str = "INKPOINT_DATA_ROOT";

/// The directory name used under the platform data directory.
const DATA_DIR_NAME: &str = "md-editor";

/// Resolves the state root from an optional override and the platform directory.
///
/// Split out from [`data_root`] so the decision is testable without mutating the
/// process environment. `std::env::set_var` is unsafe in edition 2024 and would
/// race the other tests in this binary.
///
/// An override is honoured only when it is absolute. A relative root would
/// resolve against the launch working directory, which differs between a Finder
/// launch and a terminal launch, so the same build would see two different
/// roots and "my drafts vanished" would depend on how the app was started.
fn resolve_data_root(
    override_path: Option<&Path>,
    platform_data_dir: Option<PathBuf>,
) -> Option<PathBuf> {
    if let Some(override_path) = override_path {
        if override_path.is_absolute() {
            return Some(override_path.to_path_buf());
        }
        eprintln!(
            "Ignoring {DATA_ROOT_ENV}: {} is not an absolute path.",
            override_path.display()
        );
    }
    platform_data_dir.map(|directory| directory.join(DATA_DIR_NAME))
}

/// Returns the app state root, honouring [`DATA_ROOT_ENV`] when it is set.
pub(crate) fn data_root() -> Option<PathBuf> {
    resolve_data_root(
        std::env::var_os(DATA_ROOT_ENV)
            .map(PathBuf::from)
            .as_deref(),
        dirs::data_dir(),
    )
}

/// Path of `file_name` inside `root`.
pub(crate) fn data_path(root: &Path, file_name: &str) -> PathBuf {
    root.join(file_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_override_replaces_the_platform_root() {
        let resolved = resolve_data_root(
            Some(Path::new("/tmp/inkpoint-rehearsal")),
            Some(PathBuf::from("/Users/example/Library/Application Support")),
        );
        assert_eq!(resolved, Some(PathBuf::from("/tmp/inkpoint-rehearsal")));
    }

    #[test]
    fn relative_override_falls_back_to_the_platform_root() {
        let resolved = resolve_data_root(
            Some(Path::new("relative/state")),
            Some(PathBuf::from("/Users/example/Library/Application Support")),
        );
        assert_eq!(
            resolved,
            Some(PathBuf::from(
                "/Users/example/Library/Application Support/md-editor"
            ))
        );
    }

    #[test]
    fn missing_platform_directory_yields_no_root() {
        assert_eq!(resolve_data_root(None, None), None);
    }

    #[test]
    fn joins_file_names_under_the_root() {
        let root = PathBuf::from("/tmp/inkpoint-root");
        assert_eq!(
            data_path(&root, "session.json"),
            PathBuf::from("/tmp/inkpoint-root/session.json")
        );
    }
}
