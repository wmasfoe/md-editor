//! # Desktop File Commands Module
//!
//! 负责 Tauri 桌面端与文件系统相关的原生能力接口：
//! - 目录树扫描、过滤与工作区树构建 (`tree`)；
//! - 文件树变更操作：创建、重命名、删除、路径复制与系统定位 (`mutations`)；
//! - 单文档打开、代际保存与临时原子落盘 (`document`)；
//! - 媒体资产粘贴保存、主题 CSS 读取与内联链接检验 (`assets`)；
//! - 右键上下文菜单展示与事件路由 (`context_menu`)；
//! - 路径与名称合法性安全校验 (`path_utils`)。

pub(crate) mod assets;
pub(crate) mod context_menu;
pub(crate) mod document;
pub(crate) mod mutations;
pub(crate) mod path_utils;
pub(crate) mod tree;
pub(crate) mod types;

#[cfg(test)]
mod tests;

// Re-export all Tauri command entry points so lib.rs can use them unchanged
pub(crate) use assets::{
    inspect_linked_file, pick_theme_css_file, read_theme_css_file, save_pasted_image,
};
pub(crate) use context_menu::show_file_tree_context_menu;
pub(crate) use document::{
    attach_save_runtime, open_markdown_document, open_markdown_document_at_path,
    save_markdown_document_ordered,
};
pub(crate) use mutations::{
    check_path_exists, copy_file_tree_path, create_markdown_tree_item, delete_markdown_tree_item,
    open_external_target, rename_markdown_tree_item, reveal_file_tree_item_in_finder,
};
pub(crate) use tree::{open_markdown_folder, refresh_markdown_folder};
#[allow(unused_imports)]
pub(crate) use types::{
    CreateTreeItemKind, FileTreeContextMenuAction, FileTreeMutationResult, LinkedFileKind,
    LinkedFileTarget, MarkdownDocumentFile, MarkdownFileTreeNode, MarkdownFileTreeNodeKind,
    MarkdownFolder, PastedImageFile, ThemeCssFile, FILE_TREE_MENU_PREFIX,
};
