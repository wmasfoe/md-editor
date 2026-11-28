use serde::Serialize;
use serde_json::{Map, Value, json};
use std::{
    fs,
    io::{self, Write},
    path::Path,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorPreferences {
    pub(crate) wysiwyg_font_size: u8,
    pub(crate) prose_font_family: String,
    pub(crate) code_font_family: String,
    pub(crate) show_code_block_line_numbers: bool,
    pub(crate) show_inline_style_markers: bool,
    pub(crate) enable_markdown_lint: bool,
    /// Where pasted images are written.
    ///
    /// Relative to the document (`./assets`, `../assets`), absolute, or
    /// containing `${filename}`. Resolved by
    /// [`crate::image_assets::resolve_destination`].
    pub(crate) image_directory: String,
}

/// Default image directory for a document that has never configured one.
///
/// Owned here because it is the *setting's* default; the image module takes an
/// explicit destination and has no opinion about where it comes from.
pub(crate) const DEFAULT_IMAGE_DIRECTORY: &str = "./assets";

impl Default for EditorPreferences {
    fn default() -> Self {
        Self {
            wysiwyg_font_size: 17,
            prose_font_family: String::new(),
            code_font_family: String::new(),
            show_code_block_line_numbers: false,
            show_inline_style_markers: false,
            enable_markdown_lint: true,
            image_directory: DEFAULT_IMAGE_DIRECTORY.to_owned(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub(crate) struct Preferences {
    pub(crate) theme: ThemeMode,
    pub(crate) editor: EditorPreferences,
}

impl Preferences {
    pub(crate) fn load(path: &Path) -> io::Result<Self> {
        let settings = read_settings(path)?;
        let theme = settings.get("theme").and_then(|theme| {
            // Older releases stored the appearance mode as a string.
            theme.as_str().or_else(|| theme.get("mode")?.as_str())
        });
        let editor = settings.get("editor").unwrap_or(&Value::Null);
        let defaults = EditorPreferences::default();
        let font_size = editor["wysiwygFontSize"]
            .as_f64()
            .or_else(|| editor["wysiwygFontSize"].as_str()?.trim().parse().ok())
            .filter(|value| value.is_finite())
            .map_or(defaults.wysiwyg_font_size, |value| {
                value.round().clamp(13.0, 22.0) as u8
            });
        Ok(Self {
            theme: match theme {
                Some("light") => ThemeMode::Light,
                Some("dark") => ThemeMode::Dark,
                _ => ThemeMode::System,
            },
            editor: EditorPreferences {
                wysiwyg_font_size: font_size,
                prose_font_family: editor["proseFontFamily"]
                    .as_str()
                    .unwrap_or_default()
                    .trim()
                    .into(),
                code_font_family: editor["codeFontFamily"]
                    .as_str()
                    .unwrap_or_default()
                    .trim()
                    .into(),
                show_code_block_line_numbers: editor["showCodeBlockLineNumbers"]
                    .as_bool()
                    .unwrap_or(defaults.show_code_block_line_numbers),
                show_inline_style_markers: editor["showInlineStyleMarkers"]
                    .as_bool()
                    .unwrap_or(defaults.show_inline_style_markers),
                enable_markdown_lint: editor["enableMarkdownLint"]
                    .as_bool()
                    .unwrap_or(defaults.enable_markdown_lint),
                // An empty stored value means "never configured", so the default
                // applies rather than an empty directory that resolves to nothing.
                image_directory: editor["imageDirectory"]
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(&defaults.image_directory)
                    .to_owned(),
            },
        })
    }

    pub(crate) fn save(&self, path: &Path) -> io::Result<()> {
        // Preserve the preferences owned by the other desktop surfaces and the local AI service.
        let mut settings = read_settings(path)?;
        merge_section(&mut settings, "theme", json!({ "mode": self.theme }));
        merge_section(&mut settings, "editor", json!(self.editor));
        let parent = path
            .parent()
            .filter(|dir| !dir.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        fs::create_dir_all(parent)?;
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        serde_json::to_writer_pretty(file.as_file_mut(), &settings)?;
        file.write_all(b"\n")?;
        file.as_file().sync_all()?;
        file.persist(path)?;
        Ok(())
    }
}

fn read_settings(path: &Path) -> io::Result<Map<String, Value>> {
    match fs::File::open(path) {
        Ok(file) => serde_json::from_reader(io::BufReader::new(file))
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Map::new()),
        Err(error) => Err(error),
    }
}

fn merge_section(settings: &mut Map<String, Value>, name: &str, fields: Value) {
    let section = settings.entry(name).or_insert(Value::Null);
    if let (Some(current), Some(fields)) = (section.as_object_mut(), fields.as_object()) {
        current.extend(fields.clone());
    } else {
        *section = fields;
    }
}
