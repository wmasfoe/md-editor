use std::{fs, path::Path};

use serde::{Deserialize, Serialize};

const SETTINGS_FILE_NAME: &str = "settings.json";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettings {
    pub(crate) shortcuts: Option<Vec<ShortcutSetting>>,
    pub(crate) assets_directory: Option<String>,
    pub(crate) ai: Option<AiSettings>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShortcutSetting {
    pub(crate) id: String,
    pub(crate) key: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiSettings {
    pub(crate) enabled: Option<bool>,
    pub(crate) provider: Option<String>,
    pub(crate) features: Option<AiFeatureSettings>,
    pub(crate) open_ai_compatible: Option<AiOpenAiCompatibleSettings>,
    pub(crate) local_model: Option<AiLocalModelSettings>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiFeatureSettings {
    pub(crate) continuation: Option<bool>,
    pub(crate) editing: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiOpenAiCompatibleSettings {
    pub(crate) base_url: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) api_key: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiLocalModelSettings {
    pub(crate) enabled: Option<bool>,
    pub(crate) model_id: Option<String>,
    pub(crate) version: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) downloaded_bytes: Option<u64>,
    pub(crate) total_bytes: Option<u64>,
    pub(crate) error: Option<String>,
}

#[tauri::command]
pub(crate) fn load_app_settings() -> AppSettings {
    let Some(data_dir) = app_data_dir() else {
        return default_settings();
    };

    read_settings(&data_dir.join(SETTINGS_FILE_NAME)).unwrap_or_else(default_settings)
}

#[tauri::command]
pub(crate) fn save_app_settings(settings: AppSettings) -> Result<(), String> {
    let data_dir = app_data_dir().ok_or_else(|| "Cannot resolve app data directory".to_string())?;
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;
    write_settings(&data_dir.join(SETTINGS_FILE_NAME), &settings)
}

pub(crate) fn shortcut_key(id: &str, fallback: &str) -> String {
    // 原生菜单在 React 外部重建，因此必须读取同一份持久化快捷键配置。
    let settings = load_app_settings();

    settings
        .shortcuts
        .as_deref()
        .and_then(|shortcuts| shortcuts.iter().find(|shortcut| shortcut.id == id))
        .map(|shortcut| shortcut.key.clone())
        .unwrap_or_else(|| fallback.to_string())
}

fn default_settings() -> AppSettings {
    AppSettings {
        shortcuts: None,
        assets_directory: None,
        ai: None,
    }
}

pub(crate) fn app_data_dir() -> Option<std::path::PathBuf> {
    dirs::data_dir().map(|directory| directory.join("md-editor"))
}

fn read_settings(path: &Path) -> Option<AppSettings> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<AppSettings>(&content).ok()
}

fn write_settings(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Failed to serialize settings: {error}"))?;
    fs::write(path, json).map_err(|error| format!("Failed to write settings: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn settings_round_trip() {
        let path = std::env::temp_dir().join(format!(
            "md-editor-settings-{}-{}.json",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let settings = AppSettings {
            shortcuts: Some(vec![ShortcutSetting {
                id: "view.toggleSource".to_string(),
                key: "Mod-Shift-/".to_string(),
            }]),
            assets_directory: Some("images".to_string()),
            ai: Some(AiSettings {
                enabled: Some(true),
                provider: Some("openai-compatible".to_string()),
                features: Some(AiFeatureSettings {
                    continuation: Some(false),
                    editing: Some(true),
                }),
                open_ai_compatible: Some(AiOpenAiCompatibleSettings {
                    base_url: Some("https://api.example.test/v1".to_string()),
                    model: Some("writer".to_string()),
                    api_key: Some("local-key".to_string()),
                }),
                local_model: Some(AiLocalModelSettings {
                    enabled: Some(false),
                    model_id: Some("md-editor-writer-small-v1".to_string()),
                    version: None,
                    status: Some("not-downloaded".to_string()),
                    downloaded_bytes: Some(0),
                    total_bytes: Some(0),
                    error: None,
                }),
            }),
        };

        write_settings(&path, &settings).unwrap();
        assert_eq!(read_settings(&path), Some(settings));
        fs::remove_file(path).unwrap();
    }
}
