use std::{
    fs,
    io::{self, Write},
    path::Path,
};

use gpui_kit::Image;

/// Save a pasted image beside the Markdown document and return a safe relative reference.
pub(crate) fn store_image(document_path: &Path, image: &Image) -> io::Result<String> {
    let parent = document_path
        .parent()
        .ok_or_else(|| io::Error::other("The document has no containing directory."))?
        .canonicalize()?;
    let directory = parent.join("assets");
    fs::create_dir_all(&directory)?;
    let directory = directory.canonicalize()?;
    if !directory.starts_with(&parent) {
        return Err(io::Error::other(
            "The assets directory is outside the document folder.",
        ));
    }

    let extension = format!(".{}", image.format.extension());
    let mut file = tempfile::Builder::new()
        .prefix("image-")
        .suffix(&extension)
        .tempfile_in(directory)?;
    file.write_all(&image.bytes)?;
    file.as_file().sync_all()?;
    let (_, path) = file.keep()?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::other("Could not read the saved image filename."))?;
    Ok(format!("./assets/{name}"))
}
