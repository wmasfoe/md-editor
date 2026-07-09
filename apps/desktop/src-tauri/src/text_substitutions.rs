//! macOS 文本替换偏好（桌面壳层）。
//!
//! WKWebView 的 contenteditable 可能继承 AppKit 的智能引号 / 智能破折号，
//! 在输入时把 ASCII `"` 改写成弯引号。WebKit 没有稳定的公开 API 可按编辑器
//! 单独关闭该行为；在本 App 的 NSUserDefaults 域写入系统设置同款 key，
//! 可在进程启动早期关闭替换。
//!
//! 作用范围：仅本 App（不是全局 domain）。中文输入法主动输入的 `“”`
//! 不属于「直引号被改写」，因此一般不受影响。
//! 编辑器层 `straightQuotesPlugin` 已改为默认不挂载，仅作可选兜底保留代码。

/// AppKit / WebKit 读取的自动替换偏好 key。
pub(crate) const AUTOMATIC_QUOTE_SUBSTITUTION_KEY: &str = "NSAutomaticQuoteSubstitutionEnabled";
pub(crate) const AUTOMATIC_DASH_SUBSTITUTION_KEY: &str = "NSAutomaticDashSubstitutionEnabled";

/// 为 Markdown 保真而强制关闭的 key 列表。
pub(crate) const DISABLED_TEXT_SUBSTITUTION_KEYS: [&str; 2] = [
    AUTOMATIC_QUOTE_SUBSTITUTION_KEY,
    AUTOMATIC_DASH_SUBSTITUTION_KEY,
];

/// 为本 App 进程关闭自动引号 / 破折号替换。
///
/// 须在主 WKWebView 创建之前调用，确保首次聚焦编辑器时 defaults 已生效。
#[cfg(target_os = "macos")]
pub(crate) fn disable_automatic_text_substitutions() {
    use objc2_foundation::{NSString, NSUserDefaults};

    let defaults = NSUserDefaults::standardUserDefaults();
    for key in DISABLED_TEXT_SUBSTITUTION_KEYS {
        let name = NSString::from_str(key);
        defaults.setBool_forKey(false, &name);
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn disable_automatic_text_substitutions() {
    // 非 macOS 壳层没有 AppKit 智能引号替换。
}

#[cfg(test)]
mod tests {
    use super::{
        AUTOMATIC_DASH_SUBSTITUTION_KEY, AUTOMATIC_QUOTE_SUBSTITUTION_KEY,
        DISABLED_TEXT_SUBSTITUTION_KEYS,
    };

    #[test]
    fn disables_quote_and_dash_substitution_keys() {
        assert!(DISABLED_TEXT_SUBSTITUTION_KEYS.contains(&AUTOMATIC_QUOTE_SUBSTITUTION_KEY));
        assert!(DISABLED_TEXT_SUBSTITUTION_KEYS.contains(&AUTOMATIC_DASH_SUBSTITUTION_KEY));
        assert_eq!(DISABLED_TEXT_SUBSTITUTION_KEYS.len(), 2);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn writes_disabled_flags_into_app_user_defaults() {
        use objc2_foundation::{NSString, NSUserDefaults};

        super::disable_automatic_text_substitutions();

        let defaults = NSUserDefaults::standardUserDefaults();
        for key in DISABLED_TEXT_SUBSTITUTION_KEYS {
            let enabled = defaults.boolForKey(&NSString::from_str(key));
            assert!(!enabled, "{key} 应在本 App 的 NSUserDefaults 中为 false");
        }
    }
}
