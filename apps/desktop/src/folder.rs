use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
};

use gpui_kit::{SharedString, component::tree::TreeItem};

use crate::document::is_markdown;

pub(crate) struct FolderEntry {
    path: PathBuf,
    children: Vec<Self>,
}

impl FolderEntry {
    pub(crate) fn scan(path: PathBuf) -> io::Result<Self> {
        let path = path.canonicalize()?;
        let children = scan_children(&path)?;
        Ok(Self { path, children })
    }

    pub(crate) fn into_tree(self) -> (TreeItem, HashMap<SharedString, PathBuf>) {
        let mut files = HashMap::new();
        let root = self.into_item(&mut files).expanded(true);
        (root, files)
    }

    fn into_item(self, files: &mut HashMap<SharedString, PathBuf>) -> TreeItem {
        let label = self.path.file_name().unwrap_or(self.path.as_os_str());
        let id: SharedString = self.path.to_string_lossy().into_owned().into();
        let node = TreeItem::new(id.clone(), label.to_string_lossy().into_owned());
        if self.children.is_empty() {
            if is_markdown(&self.path) {
                files.insert(id, self.path);
            }
            return node;
        }
        node.children(
            self.children
                .into_iter()
                .map(|child| child.into_item(files)),
        )
    }
}

fn scan_children(root: &Path) -> io::Result<Vec<FolderEntry>> {
    let mut directories = Vec::new();
    let mut files = Vec::new();

    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.as_encoded_bytes().starts_with(b".")
            || ["node_modules", "target", "dist"]
                .iter()
                .any(|part| name == *part)
        {
            continue;
        }

        let kind = entry.file_type()?;
        let path = entry.path();
        // Use entry types so symlinks never escape the selected root or form loops.
        if kind.is_dir() {
            let children = scan_children(&path)?;
            if !children.is_empty() {
                directories.push(FolderEntry { path, children });
            }
        } else if kind.is_file() && is_markdown(&path) {
            files.push(FolderEntry {
                path,
                children: Vec::new(),
            });
        }
    }

    directories.sort_by(|left, right| left.path.cmp(&right.path));
    files.sort_by(|left, right| left.path.cmp(&right.path));
    directories.extend(files);
    Ok(directories)
}
