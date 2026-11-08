//! # Style Learning File System Layer
//!
//! 用户风格学习的文件系统能力，只负责数据获取与本地持久化，不理解画像语义：
//! - `scope`：当前允许学习的工作区（用户在文件树中打开的根目录），以及读取路径的范围校验；
//! - `scan`：枚举工作区内可作为样本的 Markdown 文件并计算 sha256，不读写任何工作区文件；
//! - `store`：在应用数据目录内原子读写画像与排除列表两份 JSON 文档（结构由 `@md-editor/ai` 定义）。

pub(crate) mod scan;
pub(crate) mod scope;
pub(crate) mod store;

#[cfg(test)]
mod tests;

pub(crate) use scan::{read_style_learning_sample, scan_style_learning_samples};
pub(crate) use scope::{get_style_learning_root, StyleLearningScope};
pub(crate) use store::{
    clear_style_learning_document, load_style_learning_document, save_style_learning_document,
};
