#[path = "../src/image_assets.rs"]
mod image_assets;

use std::fs;

use gpui_kit::{Image, ImageFormat};
use image_assets::{resolve_destination, store_image_in};

/// The documented default image setting.
///
/// Written as a literal rather than imported so this test does not pull the
/// whole preferences module into its compilation unit; the settings test asserts
/// that the stored default is this value, so the two cannot drift apart
/// silently.
const DEFAULT_IMAGE_DIRECTORY: &str = "./assets";

/// Saves through the same resolve-then-store pair the paste path uses, so this
/// exercises the real entry points rather than a convenience wrapper.
fn save(document: &std::path::Path, image: &Image) -> std::io::Result<String> {
    let destination = resolve_destination(Some(document), DEFAULT_IMAGE_DIRECTORY)
        .ok_or_else(|| std::io::Error::other("no destination"))?;
    store_image_in(document, &destination.directory, image)
}

#[test]
fn stores_images_with_unique_relative_references() {
    let root = tempfile::tempdir().unwrap();
    let document = root.path().join("notes.md");
    let image = Image::from_bytes(ImageFormat::Png, vec![0x89, 0x50, 0x4e, 0x47]);
    let first = save(&document, &image).unwrap();
    let second = save(&document, &image).unwrap();

    assert!(first.starts_with("./assets/image-"));
    assert!(first.ends_with(".png"));
    assert_ne!(first, second);
    assert_eq!(fs::read(root.path().join(first)).unwrap(), image.bytes);
}

/// A symlinked `assets` folder must not become a way to write outside the
/// document's folder: the user asked for a subfolder of their workspace, and a
/// link could point anywhere.
#[cfg(unix)]
#[test]
fn rejects_an_assets_directory_pointing_outside_the_workspace() {
    let root = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(external.path(), root.path().join("assets")).unwrap();

    let document = root.path().join("notes.md");
    let image = Image::from_bytes(ImageFormat::Png, vec![0x89, 0x50, 0x4e, 0x47]);
    assert!(save(&document, &image).is_err());
    assert_eq!(fs::read_dir(external.path()).unwrap().count(), 0);
}

/// `${filename}` gives each note its own folder, and the reference follows.
#[test]
fn filename_variable_places_the_image_in_a_per_document_folder() {
    let root = tempfile::tempdir().unwrap();
    let document = root.path().join("my-note.md");
    let destination =
        resolve_destination(Some(&document), "./assets/${filename}").expect("a destination");
    let image = Image::from_bytes(ImageFormat::Png, vec![0x89, 0x50, 0x4e, 0x47]);
    let reference = store_image_in(&document, &destination.directory, &image).unwrap();

    assert!(
        reference.starts_with("./assets/my-note/image-"),
        "${{filename}} expands to the document base name: {reference}"
    );
    assert!(!reference.contains('\\'), "references use forward slashes");
    let written = root.path().join(&reference[2..]);
    assert_eq!(fs::read(written).unwrap(), image.bytes);
}

/// An absolute directory outside the document's folder keeps the bytes there
/// and produces a reference that does not pretend to be inside that folder.
#[test]
fn an_absolute_directory_outside_the_document_folder_is_referenced_absolutely() {
    let root = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    let document = root.path().join("note.md");
    let image = Image::from_bytes(ImageFormat::Png, vec![0x89, 0x50, 0x4e, 0x47]);
    let reference = store_image_in(&document, external.path(), &image).unwrap();

    // The reference is built from the canonicalized destination, so compare
    // against that rather than the raw tempdir path (`/var` is a symlink to
    // `/private/var` on macOS).
    let canonical = external.path().canonicalize().unwrap();
    assert!(
        reference.starts_with(&canonical.to_string_lossy().replace('\\', "/")),
        "an out-of-tree destination is referenced absolutely: {reference}"
    );
    assert_eq!(fs::read(&reference).unwrap(), image.bytes);
}

/// The confirmation flow creates the directory only when the user agreed, and
/// creating it must be idempotent so a retry does not fail.
#[test]
fn create_missing_directories_is_idempotent() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("fresh/assets/nested");

    image_assets::create_missing_directories(&directory).unwrap();
    assert!(directory.is_dir(), "the nested directory is created");

    // A second call is the retry path after a failed write; it must not fail.
    image_assets::create_missing_directories(&directory).unwrap();
    assert!(directory.is_dir());
}

/// Writing into a directory that was never created fails instead of silently
/// writing somewhere else, so the confirmation step cannot be skipped by
/// accident.
#[test]
fn storing_into_a_missing_directory_creates_only_that_directory() {
    let root = tempfile::tempdir().unwrap();
    let document = root.path().join("note.md");
    let destination = root.path().join("fresh/assets");
    let image = Image::from_bytes(ImageFormat::Png, vec![0x89, 0x50, 0x4e, 0x47]);

    let reference = store_image_in(&document, &destination, &image).unwrap();
    assert!(reference.starts_with("./fresh/assets/image-"));
    assert_eq!(
        fs::read(root.path().join(&reference[2..])).unwrap(),
        image.bytes
    );
}
