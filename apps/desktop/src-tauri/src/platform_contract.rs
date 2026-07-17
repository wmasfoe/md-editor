pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

pub(crate) fn is_main_webview(label: &str) -> bool {
    label == MAIN_WINDOW_LABEL
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_main_label_has_editor_runtime_authority() {
        assert!(is_main_webview(MAIN_WINDOW_LABEL));
        assert!(!is_main_webview("settings"));
        assert!(!is_main_webview("preview"));
    }
}
