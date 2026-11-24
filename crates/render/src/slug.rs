//! 标题锚点规则（GitHub / GFM 语义）与 legacy 别名。
//!
//! 本模块是 TS 侧 `@md-editor/shared` 的 `heading-slug.ts` 的逐字移植。两者必须保持
//! **完全相同的语义**，否则同一份文档在桌面导出（Rust）与移动端预览（TS）的锚点会分叉。
//! 差分测试 `scripts/render-diff` 的 `heading-*` fixture 是这套规则的守门人。
//!
//! 规则要点（与 GitHub 行为对齐）：
//! - 锚点基于**渲染后的可见文本**（剥掉行内语法与 HTML 标签）；
//! - 小写折叠；丢弃 Unicode 标点与符号；空白折叠为 `-`；**保留** `-` 与 `_`；
//! - 重复标题依次加 `-1`、`-2`（第一个不加后缀）；
//! - 可见文本为空时兜底为 `section`，避免空 id。

use regex::Regex;
use std::sync::OnceLock;

/// 空标题的兜底 slug。
pub const EMPTY_HEADING_SLUG: &str = "section";

fn re_images_inline() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"!\[([^\]]*)\]\([^)]*\)").expect("图片行内语法正则"))
}

fn re_images_reference() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"!\[([^\]]*)\]\[[^\]]*\]").expect("图片引用语法正则"))
}

fn re_links_inline() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[([^\]]*)\]\([^)]*\)").expect("链接行内语法正则"))
}

fn re_links_reference() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[([^\]]*)\]\[[^\]]*\]").expect("链接引用语法正则"))
}

fn re_html_tag() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"<[^>]*>").expect("HTML 标签正则"))
}

fn re_strong_markers() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\*\*|~~|__").expect("强调标记正则"))
}

fn re_italic_and_code_markers() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new("[*`]").expect("斜体与代码标记正则"))
}

fn re_slug_disallowed() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // `\p{M}` 必须保留：天城文等组合标记属于字母的一部分，丢了会产出错 id。
    RE.get_or_init(|| {
        Regex::new(&format!("[^\\p{{L}}\\p{{N}}\\p{{M}}{JS_SPACE_CLASS}_\\-]"))
            .expect("slug 允许字符集正则")
    })
}

fn re_whitespace_run() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(&format!("{JS_SPACE_CLASS}+")).expect("空白折叠正则"))
}

fn re_trim_hyphens() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^-+|-+$").expect("首尾连字符正则"))
}

fn re_legacy_stripped_chars() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // 对应 JS 的 `/[`*_~[\]()]/g`：反引号、星号、下划线、波浪号线、方括号、圆括号。
    RE.get_or_init(|| Regex::new(r"[`*_~\[\]()]").expect("legacy 剥离字符正则"))
}

fn re_legacy_disallowed() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // 对应 JS 的 `/[^\w\u4e00-\u9fa5]+/g`。JS 的 `\w` 是 ASCII-only，必须显式写出来，
    // 不能用 Rust 的 `\w`（它默认含 Unicode）。
    RE.get_or_init(|| {
        Regex::new(r"[^A-Za-z0-9_\x{4e00}-\x{9fa5}]+").expect("legacy 允许字符集正则")
    })
}

fn re_legacy_trim_hyphens() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^-|-$").expect("legacy 首尾连字符正则"))
}

/// JS 正则 `\s` 与 `String.prototype.trim` 的空白字符集。
///
/// 必须逐字符列出：Rust 的 `\s` 用 Unicode `White_Space` 属性，
/// 与 JS 有两处相反——**包含** U+0085 (NEL)，**不包含** U+FEFF (BOM)。
/// 直接用 `\s` 会让 `# a\u{FEFF}b` 与 `# a\u{85}b` 的 id 与 TS 分叉。
const JS_SPACE_CLASS: &str = r"[\t\n\x0b\x0c\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]";

/// 按 JS `trim()` 语义去掉首尾空白。
pub(crate) fn js_trim(text: &str) -> &str {
    text.trim_matches(|c: char| {
        matches!(
            c,
            '\t' | '\n' | '\x0b' | '\x0c' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
                ..='\u{200a}'
                    | '\u{2028}'
                    | '\u{2029}'
                    | '\u{202f}'
                    | '\u{205f}'
                    | '\u{3000}'
                    | '\u{feff}'
        )
    })
}

/// 剥掉行内 Markdown 与 HTML 标签，得到「渲染后可见文本」。
///
/// 顺序与 TS 实现一致：先图片、再链接（各含行内与引用两种形态）、再 HTML 标签、
/// 最后强调标记。顺序错了会留下残字符，导致 slug 分叉。
pub fn heading_slug_source(source: &str) -> String {
    let text = re_images_inline().replace_all(source, "$1").into_owned();
    let text = re_images_reference().replace_all(&text, "$1").into_owned();
    let text = re_links_inline().replace_all(&text, "$1").into_owned();
    let text = re_links_reference().replace_all(&text, "$1").into_owned();
    let text = re_html_tag().replace_all(&text, "").into_owned();
    let text = re_strong_markers().replace_all(&text, "").into_owned();
    re_italic_and_code_markers()
        .replace_all(&text, "")
        .into_owned()
}

/// 单个标题的锚点（**不做**去重）。
///
/// 注意 `_` 单下划线**不**剥除：`snake_case` 必须保持原样，否则文档内
/// `#snake_case` 链接与导出 HTML 的 `id` 会分叉。
pub fn slugify_heading(source: &str) -> String {
    let visible = heading_slug_source(source);
    let lowered = js_trim(&visible).to_lowercase();
    let filtered = re_slug_disallowed().replace_all(&lowered, "").into_owned();
    let trimmed = js_trim(&filtered);
    let hyphenated = re_whitespace_run().replace_all(trimmed, "-").into_owned();
    re_trim_hyphens().replace_all(&hyphenated, "").into_owned()
}

/// legacy URL-safe 锚点（旧链接兜底）。
///
/// 对应 TS 的 `generateLegacyHeadingSlug`：`snake_case` 会塌成 `snakecase`，
/// 中文之外的字符一律折叠为 `-`。它只用于输出 `<a id>` 别名，**不**用作真实 id。
pub fn generate_legacy_heading_slug(text: &str) -> String {
    let plain = re_html_tag().replace_all(text, "");
    let plain = js_trim(&plain).to_lowercase();
    let stripped = re_legacy_stripped_chars()
        .replace_all(&plain, "")
        .into_owned();
    let hyphenated = re_legacy_disallowed()
        .replace_all(&stripped, "-")
        .into_owned();
    re_legacy_trim_hyphens()
        .replace_all(&hyphenated, "")
        .into_owned()
}

/// 文档级标题 slug 分配器：同一文档内重复标题按 GitHub 语义加 `-1`、`-2`。
///
/// 去重依据是**最终 ID**，不是原始 slug。只按原始 slug 计数会撞车：
/// `A` / `A` / `A-1` 曾产出 `a` / `a-1` / `a-1` —— 第三个标题与第二个同名，
/// `#a-1` 只能跳到其中一个。这里把已分配出去的 ID 全部登记，逐个尝试
/// `base`、`base-1`、`base-2`… 直到拿到未占用的那个。
///
/// 必须是**有状态**的：去重是文档级属性，单个标题函数无法表达。
#[derive(Debug, Clone)]
pub struct HeadingSlugAllocator {
    used: std::collections::HashSet<String>,
    fallback: String,
}

impl Default for HeadingSlugAllocator {
    fn default() -> Self {
        Self::new(EMPTY_HEADING_SLUG)
    }
}

impl HeadingSlugAllocator {
    /// 用指定兜底值创建分配器。
    pub fn new(fallback: impl Into<String>) -> Self {
        Self {
            used: std::collections::HashSet::new(),
            fallback: fallback.into(),
        }
    }

    /// 为一个标题分配独占 id。
    pub fn allocate(&mut self, source: &str) -> String {
        let slug = slugify_heading(source);
        let base = if slug.is_empty() {
            self.fallback.clone()
        } else {
            slug
        };

        if self.used.insert(base.clone()) {
            return base;
        }

        // 从 1 开始递增，跳过已被别的标题显式占用的后缀。
        let mut suffix = 1usize;
        loop {
            let candidate = format!("{base}-{suffix}");
            if self.used.insert(candidate.clone()) {
                return candidate;
            }
            suffix += 1;
        }
    }
}

/// 创建使用默认兜底值（`section`）的分配器。
pub fn create_heading_slug_allocator() -> HeadingSlugAllocator {
    HeadingSlugAllocator::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_underscore_and_lowercases() {
        assert_eq!(
            slugify_heading("snake_case_function"),
            "snake_case_function"
        );
        assert_eq!(slugify_heading("Hello World"), "hello-world");
    }

    #[test]
    fn drops_unicode_punctuation_and_symbols() {
        assert_eq!(
            slugify_heading("标题：冒号？问号！感叹号"),
            "标题冒号问号感叹号"
        );
        assert_eq!(slugify_heading("标题 ➔ 箭头 （括号）"), "标题-箭头-括号");
    }

    #[test]
    fn strips_inline_syntax_and_html() {
        assert_eq!(
            slugify_heading("**加粗** 与 *斜体* 与 `代码`"),
            "加粗-与-斜体-与-代码"
        );
        assert_eq!(slugify_heading("带 <span>HTML</span> 标签"), "带-html-标签");
        assert_eq!(
            slugify_heading("[链接文字](https://example.com) 标题"),
            "链接文字-标题"
        );
    }

    #[test]
    fn non_latin_headings_are_non_empty() {
        assert_eq!(slugify_heading("Тестовые процедуры"), "тестовые-процедуры");
        assert_eq!(slugify_heading("テスト手順"), "テスト手順");
        assert_eq!(slugify_heading("한국어 절차"), "한국어-절차");
    }

    #[test]
    fn pure_symbols_collapse_to_empty() {
        // 调用方会用兜底值补上
        assert_eq!(slugify_heading("➔➔➔"), "");
    }

    #[test]
    fn allocator_adds_monotonic_suffixes() {
        let mut allocator = create_heading_slug_allocator();
        assert_eq!(allocator.allocate("A"), "a");
        assert_eq!(allocator.allocate("A"), "a-1");
        assert_eq!(allocator.allocate("A"), "a-2");
    }

    #[test]
    fn allocator_dedups_on_final_id_not_raw_slug() {
        // A / A / A-1：第三个标题必须拿到 a-1-1，而不是与第二个撞车的 a-1。
        let mut allocator = create_heading_slug_allocator();
        assert_eq!(allocator.allocate("A"), "a");
        assert_eq!(allocator.allocate("A"), "a-1");
        assert_eq!(allocator.allocate("A-1"), "a-1-1");
    }

    #[test]
    fn allocator_falls_back_for_empty_headings() {
        let mut allocator = create_heading_slug_allocator();
        assert_eq!(allocator.allocate("➔➔➔"), "section");
        assert_eq!(allocator.allocate("？？？"), "section-1");
    }

    #[test]
    fn legacy_slug_collapses_underscores() {
        assert_eq!(generate_legacy_heading_slug("snake_case"), "snakecase");
        assert_eq!(generate_legacy_heading_slug("Hello World"), "hello-world");
        // カタカナ 不在 `[\w\u4e00-\u9fa5]` 内，会被折叠掉，只留汉字。
        assert_eq!(generate_legacy_heading_slug("テスト手順"), "手順");
    }

    #[test]
    fn legacy_slug_drops_symbols_entirely() {
        assert_eq!(generate_legacy_heading_slug("➔➔➔"), "");
        assert_eq!(generate_legacy_heading_slug("**加粗**"), "加粗");
    }
}
