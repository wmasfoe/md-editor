//! 内嵌 JS 运行时（QuickJS），供数学公式与代码高亮共用。
//!
//! ## 为什么不各自用 Rust 原生库
//!
//! 这两块都要求与 TS 侧**字节级一致**：
//!
//! - **数学**：`katex.renderToString` 的输出结构复杂（多层 `<span class="katex-*">` +
//!   内联 style），任何 Rust 移植都无法保证一致。改用 MathML 会破坏「编辑器所见 =
//!   导出所得」。
//! - **代码高亮**：`highlight.js` 用**手写正则**分词并映射到固定类名
//!   （`hljs-keyword` 等）；`syntect` 用 Sublime Text 的 `.tmLanguage` 作用域栈，
//!   分词边界与类名体系都不同。写类名映射表不够——分词本身就不同。
//!
//! 因此直接跑**同一份 JS 实现**。QuickJS 是纯解释器、不需要 JIT，可在 macOS App
//! Sandbox 的 QuickLook 扩展里正常工作（那里没有 `allow-jit` entitlement）。
//!
//! ## 版本自动锁定
//!
//! JS 资产在**构建期**从仓库 `node_modules` 读取（见 `build.rs`），因此永远与
//! JS 侧实际使用的版本一致，不需要手工同步版本号。
//!
//! 设计参考：`katex` crate 0.4 用同样的思路（内嵌 katex.min.js + quick-js），
//! 但它的内嵌版本固定在发布时，无法跟随仓库升级；这里改为构建期读取。

use rquickjs::{Context, Runtime};

/// 内嵌 JS 资产，由 `build.rs` 在构建期从 node_modules 生成。
const MATH_ASSET: &str = include_str!(concat!(env!("OUT_DIR"), "/math-asset.js"));
const HIGHLIGHT_ASSET: &str = include_str!(concat!(env!("OUT_DIR"), "/highlight-asset.js"));

/// 与 JS 侧锁定的 katex 版本，用于契约断言。
pub const KATEX_VERSION: &str = env!("MD_RENDER_KATEX_VERSION");

/// 与 JS 侧锁定的 highlight.js 版本。
pub const HIGHLIGHT_VERSION: &str = env!("MD_RENDER_HIGHLIGHT_VERSION");

thread_local! {
    /// 每个线程持有一份运行时。
    ///
    /// QuickJS 的 `Runtime` / `Context` 不是 `Sync`，跨线程共享不安全；渲染是纯函数式
    /// 调用，每线程一份即可。初始化失败时缓存错误，避免每次调用都重试加载 300KB 脚本。
    static ENGINE: std::cell::RefCell<Option<Result<Engine, String>>> =
        const { std::cell::RefCell::new(None) };
}

struct Engine {
    // `Context` 必须与 `Runtime` 同生命周期，因此把 runtime 一起持有。
    _runtime: Runtime,
    context: Context,
}

/// 渲染失败。
#[derive(Debug)]
pub enum JsError {
    /// 运行时初始化失败。
    Init(String),
    /// 脚本求值失败。
    Eval(String),
}

impl std::fmt::Display for JsError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JsError::Init(message) => write!(formatter, "JS 运行时初始化失败：{message}"),
            JsError::Eval(message) => write!(formatter, "JS 求值失败：{message}"),
        }
    }
}

/// 初始化运行时并载入数学/高亮资产。
fn create_engine() -> Result<Engine, String> {
    let runtime = Runtime::new().map_err(|error| error.to_string())?;
    let context = Context::full(&runtime).map_err(|error| error.to_string())?;
    context.with(|ctx| {
        // UMD 打包的库需要最小 global 垫片；katex 与 highlight.js 都不触碰 DOM。
        ctx.eval::<(), _>("var global = this; var window = this; var self = this;")
            .map_err(|error| error.to_string())?;
        ctx.eval::<(), _>(MATH_ASSET)
            .map_err(|error| format!("加载数学资产失败：{error}"))?;
        ctx.eval::<(), _>(HIGHLIGHT_ASSET)
            .map_err(|error| format!("加载高亮资产失败：{error}"))?;
        Ok::<(), String>(())
    })?;
    Ok(Engine {
        _runtime: runtime,
        context,
    })
}

/// 用内嵌运行时执行一段表达式并取回字符串结果。
fn eval_string(expression: &str) -> Result<String, JsError> {
    ENGINE.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            *slot = Some(create_engine());
        }
        match slot.as_ref() {
            Some(Ok(engine)) => engine.context.with(|ctx| {
                ctx.eval::<String, _>(expression)
                    .map_err(|error| JsError::Eval(error.to_string()))
            }),
            Some(Err(message)) => Err(JsError::Init(message.clone())),
            None => Err(JsError::Init("运行时未初始化".to_string())),
        }
    })
}

/// 调用 `katex.renderToString`。
///
/// 参数与 TS 侧 `renderMathToString` 完全一致：
/// `{ displayMode, throwOnError: false, output: "html" }`。
pub fn katex_render_to_string(expression: &str, display_mode: bool) -> Result<String, JsError> {
    let quoted =
        serde_json::to_string(expression).map_err(|error| JsError::Eval(error.to_string()))?;
    let script = format!(
        "katex.renderToString({quoted}, {{displayMode: {display_mode}, throwOnError: false, output: \"html\"}})"
    );
    eval_string(&script)
}

/// 调用 `hljs.highlight`。
///
/// 参数与 TS 侧 `highlightCode` 一致：`{ language, ignoreIllegals: true }`。
/// 返回（着色后的 HTML, 是否成功）。
pub fn highlightjs_highlight(code: &str, language: &str) -> Result<String, JsError> {
    let quoted_code =
        serde_json::to_string(code).map_err(|error| JsError::Eval(error.to_string()))?;
    let quoted_lang =
        serde_json::to_string(language).map_err(|error| JsError::Eval(error.to_string()))?;
    let script = format!(
        "hljs.highlight({quoted_code}, {{language: {quoted_lang}, ignoreIllegals: true}}).value"
    );
    eval_string(&script)
}

/// 判断 highlight.js 是否认识某个语言。
pub fn highlightjs_supports(language: &str) -> bool {
    let quoted = serde_json::to_string(language).unwrap_or_else(|_| "\"\"".to_string());
    eval_string(&format!("String(hljs.getLanguage({quoted}) !== undefined)"))
        .map(|value| value == "true")
        .unwrap_or(false)
}

/// 调用 `hljs.highlightAuto`（无显式语言时的自动检测）。
///
/// 返回（着色后的 HTML, 检测到的语言）。
pub fn highlightjs_highlight_auto(code: &str) -> Result<(String, String), JsError> {
    let quoted_code =
        serde_json::to_string(code).map_err(|error| JsError::Eval(error.to_string()))?;
    let html = eval_string(&format!("hljs.highlightAuto({quoted_code}).value"))?;
    let language = eval_string(&format!(
        "hljs.highlightAuto({quoted_code}).language || \"\""
    ))?;
    Ok((html, language))
}
