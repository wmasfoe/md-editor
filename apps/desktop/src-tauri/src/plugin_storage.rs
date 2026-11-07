//! Persistent external plugin packages. IDs are data, never filesystem paths.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::Path, sync::Mutex};

static STORAGE_LOCK: Mutex<()> = Mutex::new(());
const FILE_NAME: &str = "external-plugins.json";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginSource {
    owner: String,
    repo: String,
    release_id: u64,
    tag: String,
    asset_id: u64,
    plugin_id: String,
    sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginVersion {
    source: PluginSource,
    package: Value,
    raw: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredPlugin {
    id: String,
    #[serde(default)]
    revision: u64,
    enabled: bool,
    settings: Value,
    #[serde(default)]
    keymap_overrides: std::collections::BTreeMap<String, String>,
    current: PluginVersion,
    previous: Option<PluginVersion>,
    pending: Option<PluginVersion>,
}

fn path() -> Result<std::path::PathBuf, String> {
    super::settings::app_data_dir()
        .map(|p| p.join(FILE_NAME))
        .ok_or_else(|| "Cannot resolve app data directory".into())
}

fn read(path: &Path) -> Result<Vec<StoredPlugin>, String> {
    match fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|e| format!("Invalid plugin storage: {e}"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("Cannot read plugin storage: {error}")),
    }
}

fn write(path: &Path, plugins: &[StoredPlugin]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid plugin storage path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(plugins).map_err(|e| e.to_string())?;
    // A complete temporary file is renamed into place so interrupted writes do not corrupt state.
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}

fn same_repository(a: &PluginSource, b: &PluginSource) -> bool {
    a.owner.eq_ignore_ascii_case(&b.owner) && a.repo.eq_ignore_ascii_case(&b.repo)
}

fn next_revision(previous: u64) -> u64 {
    // Milliseconds remain exactly representable by JavaScript numbers.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    static LAST: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let prior = LAST.fetch_max(
        now.max(previous.saturating_add(1)),
        std::sync::atomic::Ordering::Relaxed,
    );
    let next = now
        .max(previous.saturating_add(1))
        .max(prior.saturating_add(1));
    LAST.fetch_max(next, std::sync::atomic::Ordering::Relaxed);
    next
}

fn upsert(path: &Path, mut plugin: StoredPlugin) -> Result<(), String> {
    if plugin.id.is_empty()
        || plugin.current.source.plugin_id != plugin.id
        || !plugin.settings.is_object()
    {
        return Err("Invalid plugin record".into());
    }
    for version in [plugin.previous.as_ref(), plugin.pending.as_ref()]
        .into_iter()
        .flatten()
    {
        if version.source.plugin_id != plugin.id
            || !same_repository(&plugin.current.source, &version.source)
        {
            return Err("Plugin versions must share the same ID and repository".into());
        }
    }
    let mut plugins = read(path)?;
    if let Some(existing) = plugins.iter_mut().find(|item| item.id == plugin.id) {
        if !same_repository(&existing.current.source, &plugin.current.source) {
            return Err("Plugin ID is already owned by another repository".into());
        }
        if existing.revision != plugin.revision {
            return Err("Plugin changed; reload and retry".into());
        }
        plugin.revision = next_revision(existing.revision);
        *existing = plugin;
    } else {
        if plugin.revision != 0 {
            return Err("Plugin was removed; reload and retry".into());
        }
        plugin.revision = next_revision(0);
        plugins.push(plugin);
    }
    write(path, &plugins)
}

/// Launch with this flag to recover from a plugin that prevents normal startup.
#[tauri::command]
pub(crate) fn external_plugins_safe_start() -> bool {
    std::env::args().any(|arg| arg == "--disable-external-plugins")
}

#[tauri::command]
pub(crate) fn load_external_plugins() -> Result<Vec<StoredPlugin>, String> {
    let _guard = STORAGE_LOCK.lock().map_err(|e| e.to_string())?;
    read(&path()?)
}

#[tauri::command]
pub(crate) fn save_external_plugin(plugin: StoredPlugin) -> Result<(), String> {
    let _guard = STORAGE_LOCK.lock().map_err(|e| e.to_string())?;
    upsert(&path()?, plugin)
}

#[tauri::command]
pub(crate) fn remove_external_plugin(id: String, revision: u64) -> Result<(), String> {
    let _guard = STORAGE_LOCK.lock().map_err(|e| e.to_string())?;
    let path = path()?;
    let mut plugins = read(&path)?;
    if plugins
        .iter()
        .find(|plugin| plugin.id == id)
        .is_some_and(|plugin| plugin.revision != revision)
    {
        return Err("Plugin changed; reload and retry".into());
    }
    plugins.retain(|plugin| plugin.id != id);
    write(&path, &plugins)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stores_versions_and_rejects_repository_takeover() {
        let path = std::env::temp_dir().join(format!(
            "plugin-storage-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let version = PluginVersion {
            source: PluginSource {
                owner: "owner".into(),
                repo: "repo".into(),
                release_id: 1,
                tag: "v1".into(),
                asset_id: 2,
                plugin_id: "owner.plugin".into(),
                sha256: "hash".into(),
            },
            package: serde_json::json!({"code":"export default {}"}),
            raw: "{}".into(),
        };
        let mut plugin = StoredPlugin {
            id: "owner.plugin".into(),
            revision: 0,
            enabled: true,
            settings: serde_json::json!({"theme":"light"}),
            keymap_overrides: Default::default(),
            current: version.clone(),
            previous: Some(version),
            pending: None,
        };
        upsert(&path, plugin.clone()).unwrap();
        plugin.revision = read(&path).unwrap()[0].revision;
        assert_eq!(read(&path).unwrap(), vec![plugin.clone()]);
        let mut other = plugin.clone();
        other.id = "owner.other".into();
        other.revision = 0;
        other.current.source.plugin_id = other.id.clone();
        other.previous = None;
        upsert(&path, other.clone()).unwrap();
        plugin.enabled = false;
        upsert(&path, plugin.clone()).unwrap();
        let records = read(&path).unwrap();
        assert!(
            !records
                .iter()
                .find(|item| item.id == plugin.id)
                .unwrap()
                .enabled
        );
        assert!(
            records
                .iter()
                .find(|item| item.id == other.id)
                .unwrap()
                .enabled
        );
        plugin = records
            .into_iter()
            .find(|item| item.id == plugin.id)
            .unwrap();
        let mut stale = plugin.clone();
        stale.revision = 0;
        assert!(upsert(&path, stale).is_err());
        plugin.current.source.owner = "other".into();
        plugin.previous = None;
        assert!(upsert(&path, plugin).is_err());
        fs::remove_file(path).unwrap();
    }
}
