//! # File Commands Types
//!
//! 定义桌面端文件树、文档载入、资源引用及上下文菜单所用到的数据模型与枚举。

use serde::{Deserialize, Serialize};

pub(crate) const FILE_TREE_MENU_PREFIX: &str = "md-editor:file-tree:";

/// 打开的 Markdown 单文档 payload。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkdownDocumentFile {
    pub(crate) file_path: String,
    pub(crate) markdown: String,
}

/// 打开的工作区/目录根节点及其完整树结构。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkdownFolder {
    pub(crate) root_path: String,
    pub(crate) root_name: String,
    pub(crate) tree: MarkdownFileTreeNode,
}

/// 文件树单个节点（可代表目录、Markdown 文件或媒体资产）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkdownFileTreeNode {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) kind: MarkdownFileTreeNodeKind,
    pub(crate) children: Option<Vec<MarkdownFileTreeNode>>,
}

/// 文件树节点类型。
#[derive(Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MarkdownFileTreeNodeKind {
    Directory,
    Markdown,
    Asset,
}

/// 粘贴图片落盘结果。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PastedImageFile {
    pub(crate) markdown_path: String,
}

/// 文件树变更（创建、重命名、删除）响应，包含更新后的完整目录树与受影响的绝对路径。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileTreeMutationResult {
    pub(crate) folder: MarkdownFolder,
    pub(crate) affected_path: Option<String>,
}

/// 自定义主题 CSS 载入结果。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThemeCssFile {
    pub(crate) path: String,
    pub(crate) css: String,
}

/// 链接目标解析详情。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkedFileTarget {
    pub(crate) path: String,
    pub(crate) kind: LinkedFileKind,
}

/// 链接目标分类。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LinkedFileKind {
    Markdown,
    Asset,
    File,
}

/// 创建文件树项时的目标类型请求。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CreateTreeItemKind {
    Markdown,
    Directory,
}

/// 文件树右键上下文菜单动作项。
#[derive(Clone, Copy)]
pub(crate) enum FileTreeContextMenuAction {
    NewMarkdown,
    NewMdx,
    NewFolder,
    CopyRelativePath,
    CopyAbsolutePath,
    RevealInFinder,
    Rename,
    Delete,
}

impl FileTreeContextMenuAction {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::NewMarkdown => "new-markdown",
            Self::NewMdx => "new-mdx",
            Self::NewFolder => "new-folder",
            Self::CopyRelativePath => "copy-relative-path",
            Self::CopyAbsolutePath => "copy-absolute-path",
            Self::RevealInFinder => "reveal-in-finder",
            Self::Rename => "rename",
            Self::Delete => "delete",
        }
    }
}
