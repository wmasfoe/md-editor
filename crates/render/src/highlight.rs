//! 代码块语法高亮。
//!
//! 目标实现：`syntect`，输出需与 TS 侧 `highlight.js` 的标记结构逐字节一致
//! （见任务 `phase-1-3-highlight`）。
//!
//! 实现方式：内嵌 QuickJS 跑与 TS 侧**同一份** `highlight.js`（构建期从 node_modules
//! 读取）。之所以不用 `syntect`：两者分词模型不同（highlight.js 用手写正则 + 固定
//! 类名，syntect 用 Sublime 作用域栈），分词边界本身就不同，写类名映射表无法达到
//! 字节级一致。

use crate::escape::escape_html;

/// 高亮结果：着色后的 HTML 片段 + 归一化后的语言标识。
pub struct Highlighted {
    /// 已着色的 HTML（未着色时是转义后的纯文本）。
    pub html: String,
    /// 归一化后的语言标识；空字符串表示无法识别。
    pub language: String,
}

/// 语言别名归一化（逐字对齐 TS 侧 `resolveLanguageAlias`）。
///
/// 表内容来自 `packages/compiler/src/data/language-names.ts` 的
/// `SUPPORTED_LANGUAGE_METAS`：每个条目的第一个别名就是归一化结果。
/// 顺序敏感——同一个 token 命中多条时必须取第一条。
const LANGUAGE_ALIASES: &[(&str, &[&str])] = &[
    ("bash", &["bash", "sh", "zsh"]),
    ("c", &["c"]),
    ("csharp", &["csharp", "cs", "c#"]),
    ("cpp", &["cpp", "c++", "cc", "cxx"]),
    ("css", &["css"]),
    ("go", &["go", "golang"]),
    ("html", &["html", "htm", "xhtml"]),
    ("java", &["java"]),
    ("javascript", &["javascript", "js", "node"]),
    ("json", &["json", "json5"]),
    ("jsx", &["jsx"]),
    ("markdown", &["markdown", "md"]),
    ("python", &["python", "py"]),
    ("ruby", &["ruby", "rb"]),
    ("rust", &["rust", "rs"]),
    ("sql", &["sql"]),
    ("swift", &["swift"]),
    ("typescript", &["typescript", "ts"]),
    ("tsx", &["tsx"]),
    ("yaml", &["yaml", "yml"]),
    ("php", &["php"]),
    ("latex", &["latex", "tex"]),
    ("diff", &["diff"]),
    ("graphql", &["graphql", "gql"]),
    ("toml", &["toml"]),
    ("kotlin", &["kotlin", "kt"]),
];

/// 与 TS 侧 `resolveLanguageAlias` 一致的别名解析。
///
/// 先按别名匹配，再按 `name.toLowerCase()` 匹配（TS 的 `find` 顺序），
/// 命中即返回该条目的首个别名。
pub fn resolve_language_alias(token: &str) -> Option<String> {
    let normalized = token.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }
    for (first_alias, aliases) in LANGUAGE_ALIASES {
        if aliases.contains(&normalized.as_str()) || *first_alias == normalized {
            return Some((*first_alias).to_string());
        }
    }
    None
}

/// 高亮一段代码。
///
/// 逻辑逐字对齐 TS 侧 `highlightCode`：
/// 1. 有显式语言且 highlight.js 认识它 → 用它高亮；
/// 2. 有显式语言但 highlight.js 不认识 → 转义纯文本，保留语言标识；
/// 3. 无显式语言 → `highlightAuto` 自动检测。
pub fn highlight_code(code: &str, raw_lang: Option<&str>) -> Highlighted {
    let normalized = raw_lang
        .map(|value| value.trim().to_lowercase())
        .unwrap_or_default();
    let target = resolve_language_alias(&normalized).unwrap_or(normalized);

    if !target.is_empty() {
        if crate::js_runtime::highlightjs_supports(&target) {
            if let Ok(html) = crate::js_runtime::highlightjs_highlight(code, &target) {
                return Highlighted {
                    html,
                    language: target,
                };
            }
        }
        return Highlighted {
            html: escape_html(code),
            language: target,
        };
    }

    if let Ok((html, detected)) = crate::js_runtime::highlightjs_highlight_auto(code) {
        if !detected.is_empty() && crate::js_runtime::highlightjs_supports(&detected) {
            return Highlighted {
                html,
                language: detected,
            };
        }
    }

    Highlighted {
        html: escape_html(code),
        language: String::new(),
    }
}
