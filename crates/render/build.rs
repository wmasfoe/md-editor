//! 构建期把 JS 资产从仓库 `node_modules` 打包进来。
//!
//! ## 为什么在构建期读 node_modules
//!
//! 数学（KaTeX）与代码高亮（highlight.js）必须与 TS 侧**同一个版本**才能保证输出
//! 字节级一致。若把 JS 复制一份进仓库，就会出现「仓库里一份、node_modules 里一份」
//! 的漂移风险；若用预打包的 crate（如 `katex` crate），版本固定在 crate 发布时，
//! 无法跟随仓库升级（实测其内嵌版本是 0.16.4，而仓库用 0.18.6）。
//!
//! 因此构建期直接从 `node_modules` 读取，版本天然锁定，升级依赖即自动生效。
//!
//! ## 产物
//!
//! 写入 `$OUT_DIR`：
//! - `math-asset.js`：katex.min.js + 暴露 `katex` 全局的收尾代码
//! - `highlight-asset.js`：highlight.js 核心 + 本项目实际用到的语言
//! - 通过 `cargo:rustc-env` 暴露版本号，供运行期契约断言使用

use std::path::{Path, PathBuf};

fn main() {
    let manifest_dir =
        PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));

    // crates/render → 仓库根
    let repo_root = manifest_dir
        .ancestors()
        .nth(2)
        .map(Path::to_path_buf)
        .expect("定位仓库根目录");

    println!("cargo:rerun-if-changed=build.rs");

    // pnpm 的依赖布局是隔离的：根 node_modules 里没有 katex / highlight.js 的直接链接，
    // 只有声明它们的 workspace 包（packages/compiler）下才有符号链接。
    // 因此按「声明方 → 依赖」逐包解析，而不是假设扁平布局。
    let katex_dir = resolve_package(&repo_root, "packages/compiler", "katex");
    let highlight_dir = resolve_package(&repo_root, "packages/compiler", "highlight.js");

    let katex_js = read_file(&katex_dir.join("dist/katex.min.js"));
    let katex_version = read_package_version(&katex_dir);

    let highlight_version = read_package_version(&highlight_dir);
    let highlight_js = bundle_highlightjs(&repo_root, &highlight_dir);

    // 静态文档的 CSS 与模板 JS 同样从 TS 源提取，避免两处维护导致漂移。
    let styles_ts = repo_root.join("packages/compiler/src/templates/styles.ts");
    let document_ts = repo_root.join("packages/compiler/src/templates/document.ts");
    let base_css = extract_template_literal(&read_file(&styles_ts), "STATIC_DOCUMENT_BASE_CSS");
    let document_template = build_document_template(&read_file(&document_ts), &base_css);
    std::fs::write(out_dir.join("document-template.html"), document_template)
        .expect("写入静态文档模板");
    println!("cargo:rerun-if-changed={}", styles_ts.display());
    println!("cargo:rerun-if-changed={}", document_ts.display());

    // 数学资产：UMD 版 katex 会把自身挂到全局 `katex`，无需额外 glue。
    let math_asset = format!("{katex_js}\n;var katex = global.katex || katex;\n");
    std::fs::write(out_dir.join("math-asset.js"), math_asset).expect("写入数学资产");

    // 高亮资产：已由 esbuild 打成 IIFE（globalName = hljsModule），这里再暴露成 `hljs`。
    let highlight_asset = format!(
        "{highlight_js}\nvar hljs = (hljsModule.default || hljsModule.hljs || hljsModule);\n"
    );
    std::fs::write(out_dir.join("highlight-asset.js"), highlight_asset).expect("写入高亮资产");

    println!("cargo:rustc-env=MD_RENDER_KATEX_VERSION={katex_version}");
    println!("cargo:rustc-env=MD_RENDER_HIGHLIGHT_VERSION={highlight_version}");
}

/// 从声明该依赖的 workspace 包解析出依赖的真实目录。
///
/// 允许用 `MD_RENDER_{KATEX,HIGHLIGHT}_DIR` 显式覆盖，便于在非常规布局下构建。
fn resolve_package(repo_root: &Path, declaring_package: &str, dependency: &str) -> PathBuf {
    let override_key = format!(
        "MD_RENDER_{}_DIR",
        dependency
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() {
                ch.to_ascii_uppercase()
            } else {
                '_'
            })
            .collect::<String>()
    );
    if let Ok(explicit) = std::env::var(&override_key) {
        let path = PathBuf::from(explicit);
        if path.is_dir() {
            return path;
        }
        panic!("{override_key} 指向的目录不存在：{}", path.display());
    }

    let candidate = repo_root
        .join(declaring_package)
        .join("node_modules")
        .join(dependency);
    // pnpm 用符号链接，`is_dir()` 会跟随链接判断，因此这里能正确识别。
    if candidate.is_dir() {
        return candidate.canonicalize().unwrap_or(candidate);
    }
    panic!(
        "找不到依赖 {dependency}（已尝试 {}）。请先在仓库根执行 pnpm install，\
         或用 {override_key} 指定该依赖的目录。",
        candidate.display()
    );
}

/// 读取文件内容。
fn read_file(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|error| {
        panic!("读取 {} 失败：{error}", path.display());
    })
}

/// 读取包版本号。
fn read_package_version(package_dir: &Path) -> String {
    let path = package_dir.join("package.json");
    let raw = read_file(&path);
    // 只取 version 字段，避免为构建脚本引入 JSON 依赖。
    let key = "\"version\"";
    let start = raw.find(key).unwrap_or_else(|| {
        panic!("{} 里没有 version 字段", path.display());
    });
    let rest = &raw[start + key.len()..];
    let colon = rest.find(':').expect("version 后缺少冒号");
    let after = &rest[colon + 1..];
    let first_quote = after.find('"').expect("version 缺少起始引号");
    let after_quote = &after[first_quote + 1..];
    let end_quote = after_quote.find('"').expect("version 缺少结束引号");
    after_quote[..end_quote].to_string()
}

/// 用 esbuild 把 highlight.js 打成单文件 IIFE。
///
/// highlight.js 的 `lib/index.js` 是 CommonJS（194 个 `require`），QuickJS 没有模块
/// 系统，直接 eval 会报错。esbuild 已在仓库依赖树里（vite 的传递依赖），
/// 因此复用而不是新增依赖。
fn bundle_highlightjs(repo_root: &Path, highlight_dir: &Path) -> String {
    let entry = highlight_dir.join("lib/index.js");
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let bundled = out_dir.join("highlightjs.bundle.js");

    let esbuild = find_esbuild(repo_root);
    let status = std::process::Command::new("node")
        .arg("-e")
        .arg(
            r#"
const { buildSync } = require(process.argv[1]);
const result = buildSync({
  entryPoints: [process.argv[2]],
  bundle: true,
  format: "iife",
  globalName: "hljsModule",
  minify: true,
  write: false,
  platform: "neutral",
  target: "es2020",
});
process.stdout.write(result.outputFiles[0].text);
"#,
        )
        .arg(&esbuild)
        .arg(&entry)
        .output()
        .unwrap_or_else(|error| panic!("调用 esbuild 失败：{error}"));

    if !status.status.success() {
        panic!(
            "esbuild 打包 highlight.js 失败：\n{}",
            String::from_utf8_lossy(&status.stderr)
        );
    }

    let text = String::from_utf8(status.stdout).expect("esbuild 输出不是合法 UTF-8");
    std::fs::write(&bundled, &text).ok();
    text
}

/// 在仓库的 pnpm 依赖树里定位 esbuild 的主入口。
fn find_esbuild(repo_root: &Path) -> PathBuf {
    let pnpm_dir = repo_root.join("node_modules/.pnpm");
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(&pnpm_dir)
        .unwrap_or_else(|error| panic!("读取 {} 失败：{error}", pnpm_dir.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("esbuild@"))
                .unwrap_or(false)
        })
        .map(|path| path.join("node_modules/esbuild"))
        .filter(|path| path.is_dir())
        .collect();
    // 版本号字典序最大的通常是 vite 依赖的新版本。
    candidates.sort();
    candidates.pop().unwrap_or_else(|| {
        panic!(
            "找不到 esbuild（已搜索 {}）。它是 vite 的传递依赖，请先执行 pnpm install。",
            pnpm_dir.display()
        )
    })
}

/// 从 TS 源码里提取 `export const NAME = ` ... `;` 的模板字符串内容。
///
/// 静态文档的 CSS（约 400 行）与模板 HTML 都在 TS 侧维护。复制一份进 Rust 必然漂移，
/// 因此在构建期直接读取，保证「同一份资产」。
fn extract_template_literal(source: &str, name: &str) -> String {
    let marker = format!("export const {name} = `");
    let start = source
        .find(&marker)
        .unwrap_or_else(|| panic!("在 TS 源里找不到 {name}"))
        + marker.len();
    let rest = &source[start..];
    // 模板字符串里没有嵌套反引号（本项目该文件不使用嵌套模板），
    // 因此找到下一个反引号即为结尾。
    let end = rest.find('`').unwrap_or_else(|| {
        panic!("{name} 的模板字符串未闭合");
    });
    rest[..end].to_string()
}

/// 从 `document.ts` 提取静态文档模板，并把 CSS 占位替换为实际内容。
///
/// `document.ts` 的返回值是一个模板字符串，其中 `${STATIC_DOCUMENT_BASE_CSS}` 与
/// `${extraCss}`、`${title}`、`${result.html}` 是插值点。这里把 CSS 内联进去，
/// 其余插值点保留为 Rust 侧的占位符。
fn build_document_template(source: &str, base_css: &str) -> String {
    let marker = "return `";
    let start = source
        .find(marker)
        .unwrap_or_else(|| panic!("在 document.ts 里找不到返回模板"))
        + marker.len();
    let rest = &source[start..];
    let end = rest
        .find("`;")
        .unwrap_or_else(|| panic!("document.ts 的模板未闭合"));
    let template = &rest[..end];

    // 模板字符串里的转义序列在 JS 求值时会还原（`\p` → `\p`），
    // 这里做同样的还原，否则内联脚本里的正则会多出一层反斜杠。
    let template = unescape_template_literal(template);

    // 只替换 CSS 插值（静态内容），其余插值改成 Rust 侧的占位标记。
    template
        .replace("${STATIC_DOCUMENT_BASE_CSS}", base_css)
        .replace("${extraCss}", "\u{0}CUSTOM_CSS\u{0}")
        .replace("${title}", "\u{0}TITLE\u{0}")
        .replace("${result.html}", "\u{0}CONTENT\u{0}")
}

/// 还原 JS 模板字符串的转义序列。
///
/// TS 源里写作 `\\p{L}`（源码中的两个反斜杠），模板字符串求值后是 `\p{L}`（一个）。
/// 若直接拼接源码，内联脚本里的正则就会多一层反斜杠而失效。
///
/// 只处理本项目模板里实际出现的转义，避免引入完整的 JS 字符串解析。
fn unescape_template_literal(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut chars = source.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.peek().copied() {
            Some('\\') => {
                chars.next();
                out.push('\\');
            }
            Some('`') => {
                chars.next();
                out.push('`');
            }
            Some('$') => {
                chars.next();
                out.push('$');
            }
            Some('n') => {
                chars.next();
                out.push('\n');
            }
            Some('t') => {
                chars.next();
                out.push('\t');
            }
            Some('r') => {
                chars.next();
                out.push('\r');
            }
            // 其余 `\x` 在 JS 模板里保持原样（例如 `\p{L}` 属于正则语法，不是字符串转义）。
            _ => out.push('\\'),
        }
    }
    out
}
