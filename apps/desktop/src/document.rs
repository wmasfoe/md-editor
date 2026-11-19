use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

pub(crate) const EXTENSIONS: &[&str] = &["md", "markdown", "mdx", "mdown", "mkd", "mkdn"];

#[derive(Default)]
pub(crate) struct Document {
    pub(crate) path: Option<PathBuf>,
    pub(crate) markdown: String,
    source: Option<Vec<u8>>,
    crlf: bool,
    bom: bool,
}

impl Document {
    pub(crate) fn open(path: PathBuf) -> io::Result<Self> {
        let path = path.canonicalize()?;
        let source = fs::read(&path)?;
        let text = std::str::from_utf8(&source)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let body = text.strip_prefix('\u{feff}').unwrap_or(text);
        let crlf = body
            .find('\n')
            .is_some_and(|index| body[..index].ends_with('\r'));
        let bom = body.len() != text.len();
        let markdown = body.replace("\r\n", "\n").replace('\r', "\n");
        Ok(Self {
            path: Some(path),
            markdown,
            source: Some(source),
            crlf,
            bom,
        })
    }

    pub(crate) fn save(&self, path: PathBuf, markdown: String) -> io::Result<Self> {
        let path = path_with_extension(path);
        let path = if path.exists() {
            path.canonicalize()?
        } else {
            path
        };
        let same_file = self.path.as_ref() == Some(&path);

        let bytes = match &self.source {
            Some(bytes) if markdown == self.markdown => bytes.clone(),
            _ => self.encoded(&markdown),
        };

        if !same_file || self.source.as_deref() != Some(&bytes) {
            let parent = path
                .parent()
                .filter(|dir| !dir.as_os_str().is_empty())
                .unwrap_or(Path::new("."));
            let mut temp = tempfile::NamedTempFile::new_in(parent)?;
            if let Ok(metadata) = fs::metadata(&path) {
                temp.as_file().set_permissions(metadata.permissions())?;
            }
            temp.write_all(&bytes)?;
            temp.as_file().sync_all()?;
            // Catch edits from another editor before replacing the current file.
            if same_file
                && fs::read(&path)?.as_slice() != self.source.as_deref().unwrap_or_default()
            {
                return Err(io::Error::other(
                    "The file changed on disk. Use Save As to keep your edits.",
                ));
            }
            temp.persist(&path)?;
        }

        Ok(Self {
            path: Some(path),
            markdown,
            source: Some(bytes),
            crlf: self.crlf,
            bom: self.bom,
        })
    }

    fn encoded(&self, markdown: &str) -> Vec<u8> {
        let mut out = Vec::with_capacity(markdown.len());
        if self.bom {
            out.extend_from_slice(&[0xef, 0xbb, 0xbf]);
        }
        if self.crlf {
            for (idx, line) in markdown.split('\n').enumerate() {
                if idx != 0 {
                    out.extend_from_slice(b"\r\n");
                }
                out.extend_from_slice(line.as_bytes());
            }
        } else {
            out.extend_from_slice(markdown.as_bytes());
        }
        out
    }
}

pub(crate) fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            EXTENSIONS
                .iter()
                .any(|known| ext.eq_ignore_ascii_case(known))
        })
}

fn path_with_extension(mut path: PathBuf) -> PathBuf {
    if path.extension().is_none() {
        path.set_extension("md");
    }
    path
}
