use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::save_runtime::{SaveCommitResult, SaveWarning};

use super::{
    assets::{
        inspect_markdown_link_targets_blocking, link_href_to_path, markdown_heading_context,
        LinkTargetProbeRequest,
    },
    document::{commit_markdown_save_with, write_atomically},
    mutations::create_markdown_tree_item,
    path_utils::{
        file_tree_relative_path, markdown_relative_path, markdown_relative_path_with_preference,
        path_to_string, reveal_target_path,
    },
    tree::build_markdown_folder,
    types::{CreateTreeItemKind, MarkdownFileTreeNodeKind},
};

#[test]
fn batch_link_probe_reads_unicode_markdown_once_and_preserves_missing_status() {
    let root = unique_test_directory("batch-link-probe");
    fs::create_dir_all(&root).unwrap();
    let path = root.join("设计.md");
    fs::write(&path, "# API\n\nA body").unwrap();
    let missing = root.join("missing.md");
    let invalid_utf8 = root.join("invalid.md");
    fs::write(&invalid_utf8, [0xff, 0xfe]).unwrap();
    let result = inspect_markdown_link_targets_blocking(vec![
        LinkTargetProbeRequest {
            path: path.to_string_lossy().into_owned(),
            include_headings: true,
        },
        LinkTargetProbeRequest {
            path: path.to_string_lossy().into_owned(),
            include_headings: false,
        },
        LinkTargetProbeRequest {
            path: missing.to_string_lossy().into_owned(),
            include_headings: false,
        },
        LinkTargetProbeRequest {
            path: invalid_utf8.to_string_lossy().into_owned(),
            include_headings: false,
        },
    ]);
    let found = result.get(&path.to_string_lossy().to_string()).unwrap();
    assert!(found.exists);
    assert_eq!(found.heading_lines.as_deref(), Some("# API"));
    assert!(!found.access_error);
    let absent = result.get(&missing.to_string_lossy().to_string()).unwrap();
    assert!(!absent.exists);
    assert!(!absent.access_error);
    let invalid = result
        .get(&invalid_utf8.to_string_lossy().to_string())
        .unwrap();
    assert!(invalid.exists);
    assert!(invalid.heading_lines.is_none());
    assert!(!invalid.access_error);
    let anchored_invalid = inspect_markdown_link_targets_blocking(vec![LinkTargetProbeRequest {
        path: invalid_utf8.to_string_lossy().into_owned(),
        include_headings: true,
    }]);
    assert!(anchored_invalid[&invalid_utf8.to_string_lossy().to_string()].access_error);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn link_probe_returns_only_heading_lines_from_large_markdown_body() {
    let root = unique_test_directory("link-probe-headings");
    fs::create_dir_all(&root).unwrap();
    let path = root.join("guide.md");
    let body = "body text ".repeat(100_000);
    fs::write(&path, format!("# Guide\n\n## API Reference\n\n{body}")).unwrap();
    let result = inspect_markdown_link_targets_blocking(vec![LinkTargetProbeRequest {
        path: path.to_string_lossy().into_owned(),
        include_headings: true,
    }]);
    assert_eq!(
        result[&path.to_string_lossy().to_string()]
            .heading_lines
            .as_deref(),
        Some("# Guide\n# API Reference")
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn markdown_heading_context_preserves_js_cross_line_and_whitespace_heading_matches() {
    let markdown = "##\n\n  Cross Line\n##   Trailing spaces   \n#\u{FEFF}Bom\n###Not a heading\n";
    assert_eq!(
        markdown_heading_context(markdown),
        "# Cross Line\n# Trailing spaces   \n# Bom"
    );
    assert_eq!(
        markdown_heading_context("##\u{2028}\nTitle\r\n# \r\nNext"),
        "# Title\n# Next"
    );
}

#[test]
fn folder_tree_keeps_empty_directories_visible() {
    let root = unique_test_directory("empty-directories-visible");
    fs::create_dir_all(root.join("drafts")).unwrap();
    fs::write(root.join("notes.txt"), "not markdown").unwrap();

    let folder = build_markdown_folder(&root).unwrap();
    let children = folder.tree.children.as_deref().unwrap();

    assert!(children.iter().any(|child| {
        child.name == "drafts" && matches!(child.kind, MarkdownFileTreeNodeKind::Directory)
    }));
    assert!(!children.iter().any(|child| child.name == "notes.txt"));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn folder_tree_recognizes_supported_markdown_extensions() {
    let root = unique_test_directory("markdown-extensions");
    fs::create_dir_all(&root).unwrap();
    let names = ["a.md", "b.MDX", "c.markdown", "d.mdown", "e.MKD"];
    for name in names {
        fs::write(root.join(name), "# Markdown").unwrap();
    }
    fs::write(root.join("notes.txt"), "not markdown").unwrap();

    let folder = build_markdown_folder(&root).unwrap();
    let children = folder.tree.children.as_deref().unwrap();
    assert_eq!(children.len(), names.len());
    for name in names {
        assert!(children.iter().any(|child| {
            child.name == name && matches!(child.kind, MarkdownFileTreeNodeKind::Markdown)
        }));
    }

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn creating_directory_returns_refreshed_tree_with_new_empty_directory() {
    let root = unique_test_directory("create-directory-tree-refresh");
    fs::create_dir_all(&root).unwrap();

    let result = create_markdown_tree_item(
        path_to_string(&root),
        path_to_string(&root),
        "drafts".to_string(),
        CreateTreeItemKind::Directory,
    )
    .unwrap();
    let children = result.folder.tree.children.as_deref().unwrap();

    assert!(children.iter().any(|child| {
        child.name == "drafts" && matches!(child.kind, MarkdownFileTreeNodeKind::Directory)
    }));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn markdown_relative_path_uses_custom_assets_directory() {
    let root = Path::new("/notes/post");
    let image = root.join("images/pasted.png");

    assert_eq!(
        markdown_relative_path(root, &image).unwrap(),
        "images/pasted.png"
    );
    assert_eq!(
        markdown_relative_path_with_preference(root, &image, "./images").unwrap(),
        "./images/pasted.png"
    );
}

#[test]
fn markdown_relative_path_handles_parent_directory() {
    let root = Path::new("/notes/post");
    let image = Path::new("/notes/images/pasted.png");

    assert_eq!(
        markdown_relative_path_with_preference(root, image, "../images").unwrap(),
        "../images/pasted.png"
    );
}

#[test]
fn file_tree_relative_path_is_based_on_opened_folder() {
    let root = Path::new("/notes/book");
    let target = root.join("drafts/chapter-1.md");

    assert_eq!(
        file_tree_relative_path(root, &target).unwrap(),
        "drafts/chapter-1.md"
    );
}

#[test]
fn reveal_target_path_opens_parent_for_files() {
    let root = unique_test_directory("reveal-target-parent");
    fs::create_dir_all(root.join("drafts")).unwrap();
    let file = root.join("drafts/chapter-1.md");
    fs::write(&file, "# Chapter").unwrap();

    assert_eq!(reveal_target_path(&file), root.join("drafts"));
    assert_eq!(
        reveal_target_path(&root.join("drafts")),
        root.join("drafts")
    );

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn link_href_to_path_strips_suffixes_and_decodes_spaces() {
    assert_eq!(
        link_href_to_path("<docs/my%20post.md>?preview=true#intro").unwrap(),
        PathBuf::from("docs/my post.md")
    );
}

#[test]
fn file_url_link_href_keeps_platform_absolute_path() {
    #[cfg(target_os = "windows")]
    assert_eq!(
        link_href_to_path("file:///C:/notes/post.md").unwrap(),
        PathBuf::from("C:/notes/post.md")
    );

    #[cfg(not(target_os = "windows"))]
    assert_eq!(
        link_href_to_path("file:///Users/me/notes/post.md").unwrap(),
        PathBuf::from("/Users/me/notes/post.md")
    );
}

#[test]
fn atomic_save_ignores_stale_fixed_process_temp_file() {
    let root = unique_test_directory("atomic-save-stale-temp");
    fs::create_dir_all(&root).unwrap();
    let path = root.join("post.md");
    let stale_temp = root.join(format!(".post.md.tmp-{}", std::process::id()));
    fs::write(&path, "old").unwrap();
    fs::write(&stale_temp, "stale").unwrap();

    write_atomically(&path, b"new").unwrap();

    assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    assert_eq!(fs::read_to_string(&stale_temp).unwrap(), "stale");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn markdown_commit_renames_synced_bytes_before_reporting_scope_warning() {
    let root = unique_test_directory("ordered-markdown-warning");
    fs::create_dir_all(&root).unwrap();
    let path = root.join("post.md");
    fs::write(&path, "old").unwrap();

    let result = commit_markdown_save_with(
        &path,
        b"new\n",
        |file| file.sync_all(),
        |temporary, target| fs::rename(temporary, target),
        |_| Err("scope unavailable".to_string()),
    );

    assert_eq!(fs::read_to_string(&path).unwrap(), "new\n");
    assert!(matches!(
        result,
        SaveCommitResult::Committed { warnings, .. }
            if warnings == vec![SaveWarning {
                code: "asset-directory-registration-failed",
                message: "scope unavailable".to_string(),
            }]
    ));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn markdown_temp_sync_failure_preserves_existing_target_bytes() {
    let root = unique_test_directory("ordered-markdown-sync-failure");
    fs::create_dir_all(&root).unwrap();
    let path = root.join("post.md");
    fs::write(&path, "old").unwrap();

    let result = commit_markdown_save_with(
        &path,
        b"new\n",
        |_| Err(std::io::Error::other("sync failed")),
        |temporary, target| fs::rename(temporary, target),
        |_| Ok(()),
    );

    assert_eq!(fs::read_to_string(&path).unwrap(), "old");
    assert!(matches!(
        result,
        SaveCommitResult::Failed {
            phase: "temp-sync",
            ..
        }
    ));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn markdown_rename_failure_preserves_existing_target_bytes() {
    let root = unique_test_directory("ordered-markdown-rename-failure");
    fs::create_dir_all(&root).unwrap();
    let path = root.join("post.md");
    fs::write(&path, "old").unwrap();

    let result = commit_markdown_save_with(
        &path,
        b"new\n",
        |file| file.sync_all(),
        |_, _| Err(std::io::Error::other("rename failed")),
        |_| Ok(()),
    );

    assert_eq!(fs::read_to_string(&path).unwrap(), "old");
    assert!(matches!(
        result,
        SaveCommitResult::Failed {
            phase: "rename",
            ..
        }
    ));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn markdown_temp_write_failure_preserves_existing_target_bytes() {
    let root = unique_test_directory("ordered-markdown-write-failure");
    fs::create_dir_all(&root).unwrap();
    let parent_file = root.join("not-a-directory");
    fs::write(&parent_file, "parent").unwrap();
    let path = parent_file.join("post.md");

    let result = commit_markdown_save_with(
        &path,
        b"new\n",
        |file| file.sync_all(),
        |temporary, target| fs::rename(temporary, target),
        |_| Ok(()),
    );

    assert!(matches!(
        result,
        SaveCommitResult::Failed {
            phase: "temp-write",
            ..
        }
    ));
    assert_eq!(fs::read_to_string(&parent_file).unwrap(), "parent");
    fs::remove_dir_all(root).unwrap();
}

fn unique_test_directory(label: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();

    std::env::temp_dir().join(format!("md-editor-{label}-{}-{suffix}", std::process::id()))
}
