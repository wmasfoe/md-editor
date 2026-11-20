#[path = "../src/settings/preferences.rs"]
mod preferences;

use preferences::{Preferences, ThemeMode};
use serde_json::{Value, json};
use std::fs;

#[test]
fn reads_existing_desktop_preferences_and_preserves_other_settings_on_save() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let legacy = json!({
        "theme": { "mode": "light", "dark": { "builtinTheme": "night-dark" } },
        "editor": { "wysiwygFontSize": "21", "futureEditorOption": true },
        "language": "zh",
        "ai": { "localModel": { "modelId": "test-model" } }
    });
    fs::write(&path, legacy.to_string()).unwrap();

    let mut settings = Preferences::load(&path).unwrap();
    assert_eq!(settings.theme, ThemeMode::Light);
    assert_eq!(settings.editor.wysiwyg_font_size, 21);
    settings.editor.prose_font_family = "Example Serif".into();
    settings.editor.code_font_family = "Example Mono".into();
    settings.theme = ThemeMode::Dark;
    settings.editor.show_inline_style_markers = true;
    settings.save(&path).unwrap();

    let saved: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(saved["theme"]["dark"], legacy["theme"]["dark"]);
    assert_eq!(saved["editor"]["futureEditorOption"], true);
    assert_eq!(saved["editor"]["proseFontFamily"], "Example Serif");
    assert_eq!(saved["editor"]["codeFontFamily"], "Example Mono");
    assert_eq!(saved["language"], legacy["language"]);
    assert_eq!(saved["ai"], legacy["ai"]);
    assert_eq!(Preferences::load(&path).unwrap(), settings);
}

#[test]
fn defaults_missing_values_and_does_not_overwrite_an_unreadable_settings_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    assert_eq!(Preferences::load(&path).unwrap(), Preferences::default());

    let malformed = b"{\"theme\":";
    fs::write(&path, malformed).unwrap();
    assert!(Preferences::default().save(&path).is_err());
    assert_eq!(fs::read(&path).unwrap(), malformed);
}
