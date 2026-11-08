# @md-editor/desktop

The Inkpoint desktop app for macOS, Windows and Linux. It is a [Tauri 2](https://v2.tauri.app/) shell written in Rust, with a [React 19](https://react.dev/) front end.

## What it does

- **Local files.** It opens a Markdown file or a folder, shows the folder as a tree with search, and watches the folder so changes made outside the app show up (`folder_watcher.rs`). The recent files list and the collapsed state of the tree are remembered.
- **Saving.** Saves are started by you (save, save as). Each save goes through the ordered scheduler in `@md-editor/file-system` and a native atomic write. Unsaved edits are also kept as a draft when the window closes or the app quits, and a banner offers to restore them on the next launch.
- **History, export, checks.** A history drawer with line diffs, HTML and PDF export, copy as HTML, link checks and Markdown lint.
- **Window.** The window uses an overlay title bar with a custom drag region. On macOS the traffic lights are positioned by `window_chrome.rs`.
- **QuickLook.** On macOS it ships a Quick Look extension (`src-tauri/extensions/quicklook`) that previews `.md` and `.mdx` files in Finder, built from `@md-editor/compiler`.
- **Local AI.** On Apple Silicon Macs it bundles a llama.cpp runtime (`src-tauri/binaries`) for the on-device models in `@md-editor/ai`.
- **Plugins.** External plugins install from GitHub Releases. Start the app with `--disable-external-plugins` if one stops it from launching.
- **Updates.** The app checks for a new version every six hours with `tauri-plugin-updater`. It reads the manifest from `download.jiaqi.im` first and from the Homebrew tap repository second, and it verifies the package signature.

## Layout

```
apps/desktop/
├── src/             # React front end: app shell, sidebar, settings, history, update dialogs
├── src-tauri/       # Rust side
│   ├── src/         # file commands, save runtime, folder watcher, sessions, local AI, window chrome
│   ├── extensions/  # macOS Quick Look extension
│   ├── binaries/    # llama runtime and PDF exporter helpers
│   ├── tauri.conf.json
│   └── tauri.release.conf.json   # release build and updater signing
├── scripts/         # Quick Look build and test, bundle size budget checks
├── e2e/             # Playwright end-to-end tests
└── tests/           # Vitest unit tests
```

## Development

You need Node.js (the version in `.node-version`), pnpm 11.6.0 or later and the stable Rust toolchain (`rustup`).

```bash
# From the repository root: starts Vite and opens the Tauri window
pnpm dev

# Front end only, in a browser
pnpm --filter @md-editor/desktop dev
```

## Build

```bash
pnpm build:macos     # .dmg and the updater package
pnpm build:windows   # NSIS installer
pnpm build:linux     # .AppImage and .deb
```

## Tests and checks

```bash
pnpm --filter @md-editor/desktop test            # unit tests
pnpm --filter @md-editor/desktop typecheck
pnpm --filter @md-editor/desktop test:browser    # Playwright
```
