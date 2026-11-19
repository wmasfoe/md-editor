#[path = "../src/image_assets.rs"]
mod image_assets;

use std::fs;

use gpui_kit::{Image, ImageFormat};
use image_assets::store_image;

#[test]
fn stores_images_with_unique_relative_references() {
    let root = tempfile::tempdir().unwrap();
    let document = root.path().join("notes.md");
    let image = Image::from_bytes(ImageFormat::Png, vec![0x89, 0x50, 0x4e, 0x47]);
    let first = store_image(&document, &image).unwrap();
    let second = store_image(&document, &image).unwrap();

    assert!(first.starts_with("./assets/image-"));
    assert!(first.ends_with(".png"));
    assert_ne!(first, second);
    assert_eq!(fs::read(root.path().join(first)).unwrap(), image.bytes);
}

#[cfg(unix)]
#[test]
fn rejects_an_assets_directory_pointing_outside_the_workspace() {
    let root = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(external.path(), root.path().join("assets")).unwrap();

    let document = root.path().join("notes.md");
    let image = Image::from_bytes(ImageFormat::Png, vec![0x89, 0x50, 0x4e, 0x47]);
    assert!(store_image(&document, &image).is_err());
    assert_eq!(fs::read_dir(external.path()).unwrap().count(), 0);
}
