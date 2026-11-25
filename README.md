# Inkpoint

Inkpoint is a native Markdown editor built with Rust and GPUI. This beta branch contains the desktop app and its Rust editor crates.

## Develop

Install the pinned Rust toolchain from `rust-toolchain.toml` and the native build dependencies required by GPUI on your platform. `Cargo.toml` also records the workspace minimum Rust version.

Run the desktop app:

```sh
cargo run --locked -p inkpoint-gpui
```

Open a Markdown file at launch:

```sh
cargo run --locked -p inkpoint-gpui -- path/to/document.md
```

The app can also open and save files through its native menus and keyboard shortcuts.

## Verify

Run the Rust workspace checks from the repository root:

```sh
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
cargo build --locked --workspace
```

## Workspace

```text
apps/desktop/             Native GPUI desktop application
packages/editor-core/     Markdown document and editing session
packages/editor-typeset/  Markdown layout and source/display mapping
packages/editor-gpui/     GPUI editor view and input handling
```

## Documentation

- [Desktop app development](apps/desktop/README.md)
- [Agent documentation index](docs/agent/index.md)
- [GPUI editor architecture](docs/agent/architecture/gpui_beta_architecture.md)

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
