use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::json;

use super::{
    scan::{is_user_excluded, read_sample, scan_samples, sha256_hex},
    scope::{resolve_in_scope, validate_relative_path, StyleLearningScope},
    store::{clear_document, load_document, save_document, StyleLearningDocumentKind},
};

/// 每个测试使用独立的临时目录，结束时删除。
struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "md-editor-style-{label}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(fs::canonicalize(&path).unwrap())
    }

    fn write(&self, rel: &str, content: &str) {
        let path = self.0.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn scanned_paths(root: &Path, excluded: &[&str]) -> Vec<String> {
    let excluded: Vec<String> = excluded.iter().map(|entry| entry.to_string()).collect();
    scan_samples(root, &excluded)
        .unwrap()
        .samples
        .into_iter()
        .map(|sample| sample.rel_path)
        .collect()
}

/// 递归记录目录树中每个文件的相对路径与内容，用于断言扫描不修改工作区。
fn snapshot_tree(root: &Path) -> Vec<(String, Vec<u8>)> {
    let mut entries: Vec<(String, Vec<u8>)> = walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| {
            let rel = entry
                .path()
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            (rel, fs::read(entry.path()).unwrap())
        })
        .collect();
    entries.sort();
    entries
}

#[test]
fn r_sc_1_user_exclusions_match_files_and_directory_prefixes() {
    let workspace = TempDir::new("exclude");
    workspace.write("a.md", "# a");
    workspace.write("diary/day1.md", "# d1");
    workspace.write("diary/deep/day2.md", "# d2");
    workspace.write("diary-public.md", "# public");
    workspace.write("notes/keep.md", "# keep");
    workspace.write("notes/secret.md", "# secret");
    // 工作区里的 .aiignore 不应被读取或影响结果。
    workspace.write(".aiignore", "notes/\n");

    assert_eq!(
        scanned_paths(&workspace.0, &["diary", "notes/secret.md", "../escape", ""]),
        vec!["a.md", "diary-public.md", "notes/keep.md"]
    );
    assert!(is_user_excluded("diary/x.md", &["diary".to_string()]));
    assert!(!is_user_excluded("diary-public.md", &["diary".to_string()]));
}

#[test]
fn r_sc_2_default_exclusions_skip_hidden_build_template_and_large_files() {
    let workspace = TempDir::new("defaults");
    workspace.write("post.md", "# post");
    workspace.write("draft.mdx", "# mdx");
    workspace.write("readme.txt", "not markdown");
    workspace.write(".obsidian/config.md", "# hidden dir");
    workspace.write(".hidden.md", "# hidden file");
    workspace.write("node_modules/pkg/README.md", "# dep");
    workspace.write(".git/notes.md", "# git");
    workspace.write("dist/out.md", "# build");
    workspace.write("templates/weekly.md", "# template dir");
    workspace.write("Template/daily.md", "# template dir");
    workspace.write("weekly.template.md", "# template file");
    workspace.write("big.md", &"x".repeat(1024 * 1024 + 1));

    assert_eq!(
        scanned_paths(&workspace.0, &[]),
        vec!["draft.mdx", "post.md"]
    );
}

#[test]
fn r_sc_3_sha256_matches_known_values() {
    let workspace = TempDir::new("hash");
    workspace.write("hello.md", "hello");
    let scan = scan_samples(&workspace.0, &[]).unwrap();
    assert_eq!(
        scan.samples[0].sha256,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
    assert_eq!(scan.samples[0].bytes, 5);
    assert_eq!(
        sha256_hex(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn r_sc_4_scanning_and_reading_never_modify_the_workspace() {
    let workspace = TempDir::new("readonly");
    workspace.write("a.md", "# a");
    workspace.write("sub/b.md", "# b");
    workspace.write("sub/c.txt", "c");
    let before = snapshot_tree(&workspace.0);

    scan_samples(&workspace.0, &["sub/b.md".to_string()]).unwrap();
    read_sample(&workspace.0, "a.md").unwrap();

    assert_eq!(snapshot_tree(&workspace.0), before);
}

#[test]
fn r_sp_1_reading_rejects_paths_outside_scope_and_without_a_root() {
    let workspace = TempDir::new("scope");
    let outside = TempDir::new("outside");
    workspace.write("inside.md", "正文");
    outside.write("secret.md", "外部");

    assert_eq!(read_sample(&workspace.0, "inside.md").unwrap(), "正文");
    for rel in [
        "../secret.md",
        "/etc/passwd",
        "a/../inside.md",
        "./inside.md",
        "C:/x.md",
        "a\\b.md",
        "",
    ] {
        assert!(validate_relative_path(rel).is_err(), "{rel}");
        assert!(read_sample(&workspace.0, rel).is_err(), "{rel}");
    }

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(outside.0.join("secret.md"), workspace.0.join("link.md"))
            .unwrap();
        assert!(resolve_in_scope(&workspace.0, "link.md").is_err());
        assert!(read_sample(&workspace.0, "link.md").is_err());
        // 扫描不跟随符号链接，也不会把它列为样本。
        assert_eq!(scanned_paths(&workspace.0, &[]), vec!["inside.md"]);
    }

    workspace.write(".private/note.md", "隐藏");
    workspace.write("templates/t.md", "模板");
    assert!(read_sample(&workspace.0, ".private/note.md").is_err());
    assert!(read_sample(&workspace.0, "templates/t.md").is_err());

    let scope = StyleLearningScope::default();
    assert!(scope.root().is_err());
    scope.set_root(&workspace.0);
    assert_eq!(scope.root().unwrap(), workspace.0);
}

#[test]
fn r_st_1_documents_are_written_atomically_and_versioned() {
    let dir = TempDir::new("store");
    let profile = json!({ "version": 1, "workspaces": [] });

    assert_eq!(
        load_document(&dir.0, StyleLearningDocumentKind::Profile),
        None
    );
    save_document(&dir.0, StyleLearningDocumentKind::Profile, &profile).unwrap();
    assert_eq!(
        load_document(&dir.0, StyleLearningDocumentKind::Profile),
        Some(profile.clone())
    );
    assert!(!dir.0.join("profile.json.tmp").exists());

    // 不支持的版本既不能写入，读取时也按空文档处理。
    assert!(save_document(
        &dir.0,
        StyleLearningDocumentKind::Profile,
        &json!({ "version": 2 })
    )
    .is_err());
    assert!(save_document(&dir.0, StyleLearningDocumentKind::Profile, &json!([])).is_err());
    fs::write(dir.0.join("profile.json"), r#"{"version":99}"#).unwrap();
    assert_eq!(
        load_document(&dir.0, StyleLearningDocumentKind::Profile),
        None
    );
    fs::write(dir.0.join("profile.json"), "{ broken").unwrap();
    assert_eq!(
        load_document(&dir.0, StyleLearningDocumentKind::Profile),
        None
    );

    // 写入中断留下的临时文件不影响已有文档。
    save_document(&dir.0, StyleLearningDocumentKind::Profile, &profile).unwrap();
    fs::write(dir.0.join("profile.json.tmp"), "partial").unwrap();
    assert_eq!(
        load_document(&dir.0, StyleLearningDocumentKind::Profile),
        Some(profile)
    );
}

#[test]
fn r_st_2_and_3_clearing_profile_keeps_exclusions() {
    let dir = TempDir::new("clear");
    let profile = json!({ "version": 1, "workspaces": [{ "id": "w" }] });
    let exclusions = json!({ "version": 1, "workspaces": { "w": ["diary"] } });
    save_document(&dir.0, StyleLearningDocumentKind::Profile, &profile).unwrap();
    save_document(&dir.0, StyleLearningDocumentKind::Exclusions, &exclusions).unwrap();
    fs::write(dir.0.join("profile.json.tmp"), "partial").unwrap();

    clear_document(&dir.0, StyleLearningDocumentKind::Profile).unwrap();
    assert!(!dir.0.join("profile.json").exists());
    assert!(!dir.0.join("profile.json.tmp").exists());
    assert_eq!(
        load_document(&dir.0, StyleLearningDocumentKind::Exclusions),
        Some(exclusions)
    );
    // 重复清除与清除不存在的文档都视为成功。
    clear_document(&dir.0, StyleLearningDocumentKind::Profile).unwrap();

    clear_document(&dir.0, StyleLearningDocumentKind::Exclusions).unwrap();
    assert_eq!(
        load_document(&dir.0, StyleLearningDocumentKind::Exclusions),
        None
    );
}

#[test]
fn document_kinds_deserialize_from_typescript_names() {
    assert_eq!(
        serde_json::from_value::<StyleLearningDocumentKind>(json!("profile")).unwrap(),
        StyleLearningDocumentKind::Profile
    );
    assert_eq!(
        serde_json::from_value::<StyleLearningDocumentKind>(json!("exclusions")).unwrap(),
        StyleLearningDocumentKind::Exclusions
    );
    assert!(serde_json::from_value::<StyleLearningDocumentKind>(json!("settings")).is_err());
}
