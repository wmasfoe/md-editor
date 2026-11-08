//! 当前允许风格学习的工作区范围。

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use crate::file_commands::path_utils::{
    canonicalize_existing_path, ensure_path_inside_root, path_to_string,
};

/// 记录用户当前在文件树中打开的工作区根目录。学习只允许读取这个目录内的文件。
#[derive(Default)]
pub(crate) struct StyleLearningScope {
    root: Mutex<Option<PathBuf>>,
}

impl StyleLearningScope {
    /// 用户打开或刷新工作区时登记根目录（必须是已规范化的现存目录）。
    pub(crate) fn set_root(&self, root: &Path) {
        if let Ok(mut current) = self.root.lock() {
            *current = Some(root.to_path_buf());
        }
    }

    /// 返回当前工作区根目录，并确认它与调用方期望的根目录一致。
    ///
    /// 学习轮次可能跨越一次工作区切换：旧轮次带着旧根目录的排除列表与画像继续运行时，
    /// 必须拒绝读取新工作区，避免把新目录的内容记到旧画像上或绕过新目录的排除列表。
    pub(crate) fn expect_root(&self, expected: &str) -> Result<PathBuf, String> {
        let root = self.root()?;
        if path_to_string(&root) != expected {
            return Err("工作区已切换，本轮风格学习已停止。".to_string());
        }
        Ok(root)
    }

    /// 返回当前工作区根目录；未打开任何工作区时拒绝一切学习读取。
    pub(crate) fn root(&self) -> Result<PathBuf, String> {
        self.root
            .lock()
            .map_err(|_| "风格学习范围状态锁已损坏。".to_string())?
            .clone()
            .ok_or_else(|| "当前没有打开的工作区，无法进行风格学习。".to_string())
    }
}

/// 把工作区相对路径解析为规范化绝对路径，并确认它仍在工作区内。
///
/// `canonicalize` 会解析符号链接，因此指向工作区外部的链接会被拒绝。
pub(crate) fn resolve_in_scope(root: &Path, rel_path: &str) -> Result<PathBuf, String> {
    validate_relative_path(rel_path)?;
    let joined = root.join(rel_path);
    let canonical = canonicalize_existing_path(&path_to_string(&joined), "style sample")?;
    ensure_path_inside_root(root, &canonical)?;
    Ok(canonical)
}

/// 工作区相对路径只能由普通路径段组成，统一使用 `/` 分隔。
pub(crate) fn validate_relative_path(rel_path: &str) -> Result<(), String> {
    let invalid = rel_path.is_empty()
        || rel_path.starts_with('/')
        || rel_path.contains('\\')
        || rel_path.contains(':')
        || rel_path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..");
    if invalid {
        Err(format!("非法的工作区相对路径：{rel_path}"))
    } else {
        Ok(())
    }
}
