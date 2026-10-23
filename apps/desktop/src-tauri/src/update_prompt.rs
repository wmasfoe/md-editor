//! 更新提示的轻量持久化：记录「已提示过的版本」与「用户跳过的版本」。
//!
//! 与用户设置分文件存放：这两个字段属于提醒簿记而不是偏好设置，放进 AppSettings 会
//! 触发跨窗口 settings 同步事件，也会污染设置迁移逻辑。
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::settings::app_data_dir;

const UPDATE_PROMPT_FILE_NAME: &str = "update-prompt.json";

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdatePromptState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) last_notified_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) skipped_version: Option<String>,
}

/// 读取提示状态；文件缺失或损坏时返回默认值，绝不让更新流程因簿记失败而中断。
#[tauri::command]
pub(crate) fn load_update_prompt_state() -> UpdatePromptState {
    let Some(data_dir) = app_data_dir() else {
        return UpdatePromptState::default();
    };

    read_update_prompt_state(&data_dir.join(UPDATE_PROMPT_FILE_NAME)).unwrap_or_default()
}

#[tauri::command]
pub(crate) fn save_update_prompt_state(state: UpdatePromptState) -> Result<(), String> {
    let data_dir = app_data_dir().ok_or_else(|| "Cannot resolve app data directory".to_string())?;
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;
    write_update_prompt_state(&data_dir.join(UPDATE_PROMPT_FILE_NAME), &state)
}

fn read_update_prompt_state(path: &Path) -> Option<UpdatePromptState> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<UpdatePromptState>(&content).ok()
}

fn write_update_prompt_state(path: &Path, state: &UpdatePromptState) -> Result<(), String> {
    let json = serde_json::to_string_pretty(state)
        .map_err(|error| format!("Failed to serialize update prompt state: {error}"))?;
    fs::write(path, json).map_err(|error| format!("Failed to write update prompt state: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_path(name: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "inkpoint-update-prompt-{name}-{}-{:?}.json",
            std::process::id(),
            std::thread::current().id()
        ));
        path
    }

    #[test]
    fn round_trips_prompt_state() {
        let path = temp_path("round-trip");
        let state = UpdatePromptState {
            last_notified_version: Some("0.16.0".to_string()),
            skipped_version: Some("0.16.0".to_string()),
        };

        write_update_prompt_state(&path, &state).expect("write");
        assert_eq!(read_update_prompt_state(&path), Some(state));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn missing_or_corrupt_file_returns_none() {
        let path = temp_path("corrupt");
        let mut file = fs::File::create(&path).expect("create");
        file.write_all(b"{not json").expect("write");
        drop(file);

        assert_eq!(read_update_prompt_state(&path), None);

        let _ = fs::remove_file(path);
    }
}
