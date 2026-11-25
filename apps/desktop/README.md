# Inkpoint desktop app

The desktop app is a native GPUI application. Its document model and rendering pipeline live in the Rust workspace crates.

## Develop

Use the Rust toolchain pinned in the repository's `rust-toolchain.toml` and install GPUI's native build dependencies for your platform. The root `Cargo.toml` records the workspace minimum Rust version.

From the repository root, start the app:

```sh
cargo run --locked -p inkpoint-gpui
```

Pass a Markdown file to open it on launch:

```sh
cargo run --locked -p inkpoint-gpui -- path/to/document.md
```

The app also supports opening a document or folder through the native menus. `Cmd-/` on macOS and `Ctrl-/` on other platforms toggle Markdown source mode.

## Verify

Run these commands from the repository root:

```sh
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo build --locked --workspace
```

## Build a macOS preview DMG

Build the Apple Silicon app and package it with the vendored llama.cpp runtime:

```sh
cargo build --locked --release --target aarch64-apple-darwin --package inkpoint-gpui
GPUI_VERSION=0.23.4 CARGO_BUILD_TARGET=aarch64-apple-darwin bash apps/desktop/scripts/package-macos.sh
```

The DMG is written to `target/gpui-preview/`. The package script uses ad-hoc signing; it does not notarize the app. The beta build currently targets macOS Apple Silicon.

## Source layout

```text
apps/desktop/src/       App startup, workspace, documents, files, settings and local AI
apps/desktop/assets/    App icon
apps/desktop/runtime/   Vendored llama.cpp macOS arm64 runtime
packages/editor-core/  Markdown document and editing session
packages/editor-typeset/  Layout projection and source/display mapping
packages/editor-gpui/  Native editor view and input handling
```
