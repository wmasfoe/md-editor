#[path = "../src/document.rs"]
mod document;

use document::{Document, is_markdown};
use std::fs;

#[test]
fn keeps_utf8_bom_and_crlf_when_edited() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("note.MD");
    fs::write(&path, "\u{feff}# 中文\r\nA\r\n").unwrap();
    let doc = Document::open(path.clone()).unwrap();
    assert!(is_markdown(&path));
    assert_eq!(doc.markdown, "# 中文\nA\n");

    let saved = doc.save(path.clone(), "# 中文\nB\n".into()).unwrap();
    assert_eq!(saved.markdown, "# 中文\nB\n");
    assert_eq!(fs::read_to_string(path).unwrap(), "\u{feff}# 中文\r\nB\r\n");
}

#[test]
fn protects_unsaved_edits_when_file_changed_outside_app() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("note.md");
    fs::write(&path, "original").unwrap();
    let doc = Document::open(path.clone()).unwrap();
    fs::write(&path, "external edit").unwrap();

    assert!(doc.save(path.clone(), "my edit".into()).is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "external edit");
    let backup = doc
        .save(dir.path().join("recovered"), "my edit".into())
        .unwrap();
    assert_eq!(fs::read_to_string(backup.path.unwrap()).unwrap(), "my edit");
}
