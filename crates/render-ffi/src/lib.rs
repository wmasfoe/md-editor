//! # md-render-ffi — `md-render` 的 C ABI 封装
//!
//! 唯一消费者是 macOS QuickLook 的 `.appex`（Swift + `swiftc` 链接静态库）。
//! 桌面端直接依赖 `md-render` 的 Rust API，不经过这里。
//!
//! ## 为什么 QuickLook 用静态库而不是 Tauri command
//!
//! `.appex` 是**独立进程**，跑在 App Sandbox 里，既无法与主应用通信，也没有
//! `com.apple.security.cs.allow-jit` 权限——因此不能用 WebAssembly，也不能依赖
//! JavaScriptCore 的 JIT。Rust 编译成原生机器码通过 C ABI 调用则完全可行。
//!
//! 数学与代码高亮内部使用 QuickJS（纯解释器，不需要 JIT），因此在本扩展里正常工作。
//!
//! ## 内存约定
//!
//! 所有返回字符串的函数都返回 `*mut c_char`，调用方**必须**用
//! [`md_render_free_string`] 释放，否则泄漏。返回 `NULL` 表示失败。
//!
//! 所有入参都是 `*const c_char` 的 NUL 结尾 UTF-8 字符串；传入 `NULL` 视为空串。

use std::ffi::{CStr, CString};
use std::os::raw::c_char;

/// 把 C 字符串转为 Rust `&str`；`NULL` 视为空串。
///
/// 非法 UTF-8 时回退为空串而不是 panic——`.appex` 崩溃会让 Finder 预览整体失效，
/// 宁可渲染出空内容也不要拖垮宿主进程。
unsafe fn borrow_str<'a>(pointer: *const c_char) -> &'a str {
    if pointer.is_null() {
        return "";
    }
    CStr::from_ptr(pointer).to_str().unwrap_or("")
}

/// 把 Rust 字符串交给 C 侧接管。
///
/// 内部 NUL 字节会被替换为空格（C 字符串无法表达），避免 `CString::new` 失败。
fn into_c_string(value: String) -> *mut c_char {
    let sanitized = if value.as_bytes().contains(&0) {
        value.replace('\0', " ")
    } else {
        value
    };
    match CString::new(sanitized) {
        Ok(cstring) => cstring.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// 渲染 Markdown 为完整 standalone HTML 文档。
///
/// # 参数
///
/// - `markdown`：Markdown 源码（NUL 结尾 UTF-8）
/// - `title`：文档标题；传 `NULL` 或空串时从正文第一个 H1 提取
/// - `custom_css`：追加 CSS；可为 `NULL`
///
/// # 返回
///
/// 新分配的 C 字符串，调用方负责用 [`md_render_free_string`] 释放。
///
/// # Safety
///
/// 调用方必须保证传入的指针要么是 `NULL`，要么指向 NUL 结尾的有效 UTF-8 字符串。
#[no_mangle]
pub unsafe extern "C" fn md_render_document(
    markdown: *const c_char,
    title: *const c_char,
    custom_css: *const c_char,
) -> *mut c_char {
    let markdown = borrow_str(markdown);
    let title = borrow_str(title);
    let custom_css = borrow_str(custom_css);

    let options = md_render::DocumentOptions {
        title: if title.is_empty() {
            None
        } else {
            Some(title.to_string())
        },
        custom_css: if custom_css.is_empty() {
            None
        } else {
            Some(custom_css.to_string())
        },
    };

    into_c_string(md_render::render_document(markdown, &options))
}

/// 渲染 Markdown 为 HTML 片段（不含文档骨架）。
///
/// # Safety
///
/// 同 [`md_render_document`]。
#[no_mangle]
pub unsafe extern "C" fn md_render_fragment(markdown: *const c_char) -> *mut c_char {
    into_c_string(md_render::render_html(
        borrow_str(markdown),
        &md_render::RenderOptions::default(),
    ))
}

/// 释放由本库返回的字符串。
///
/// # Safety
///
/// `pointer` 必须来自本库的返回值，且只能释放一次；传 `NULL` 是安全的空操作。
#[no_mangle]
pub unsafe extern "C" fn md_render_free_string(pointer: *mut c_char) {
    if pointer.is_null() {
        return;
    }
    drop(CString::from_raw(pointer));
}

/// 返回内嵌 KaTeX 的版本号（NUL 结尾静态字符串，**不需要**释放）。
///
/// 供扩展在启动时做一次版本契约自检，确认与 JS 侧一致。
#[no_mangle]
pub extern "C" fn md_render_katex_version() -> *const c_char {
    // 版本号来自构建期环境变量，不含 NUL，因此可以安全地转换为静态 C 字符串。
    static VERSION: std::sync::OnceLock<CString> = std::sync::OnceLock::new();
    VERSION
        .get_or_init(|| CString::new(md_render::katex_version()).unwrap_or_default())
        .as_ptr()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_document_through_ffi() {
        let markdown = CString::new("# 标题\n\n正文。").unwrap();
        let title = CString::new("自定义标题").unwrap();

        let pointer =
            unsafe { md_render_document(markdown.as_ptr(), title.as_ptr(), std::ptr::null()) };
        assert!(!pointer.is_null());

        let html = unsafe { CStr::from_ptr(pointer) }
            .to_str()
            .unwrap()
            .to_string();
        unsafe { md_render_free_string(pointer) };

        assert!(html.starts_with("<!doctype html>"));
        assert!(html.contains("自定义标题"));
        assert!(html.contains("<h1"));
    }

    #[test]
    fn null_inputs_are_treated_as_empty() {
        let pointer =
            unsafe { md_render_document(std::ptr::null(), std::ptr::null(), std::ptr::null()) };
        assert!(!pointer.is_null());
        let html = unsafe { CStr::from_ptr(pointer) }
            .to_str()
            .unwrap()
            .to_string();
        unsafe { md_render_free_string(pointer) };
        // 空文档走占位分支，仍然是合法文档
        assert!(html.starts_with("<!doctype html>"));
    }

    #[test]
    fn fragment_keeps_mermaid_as_code_block() {
        let markdown = CString::new("```mermaid\ngraph TD\n  A --> B\n```").unwrap();
        let pointer = unsafe { md_render_fragment(markdown.as_ptr()) };
        let html = unsafe { CStr::from_ptr(pointer) }
            .to_str()
            .unwrap()
            .to_string();
        unsafe { md_render_free_string(pointer) };

        // 契约：Rust 不渲染 mermaid，SVG 由宿主后处理
        assert!(html.contains("language-mermaid"));
        assert!(!html.contains("<svg"));
    }

    #[test]
    fn free_string_tolerates_null() {
        unsafe { md_render_free_string(std::ptr::null_mut()) };
    }

    #[test]
    fn katex_version_is_reported() {
        let pointer = md_render_katex_version();
        assert!(!pointer.is_null());
        let version = unsafe { CStr::from_ptr(pointer) }.to_str().unwrap();
        assert!(!version.is_empty());
    }
}
