# @md-editor/utools

The Inkpoint plugin for [uTools](https://www.u-tools.cn/). It is a quick way to write Markdown from anywhere and a way to find the desktop app.

## Scope

- **A lightweight entry point.** The plugin is meant as a starting point that points users toward the desktop app and the website. It can be dropped at any time.
- **Everything uTools-specific stays in this folder.** The adapter code, the preload script, `plugin.json` and the disclaimer live in `apps/utools`, and no package under `packages/*` depends on uTools. Removing the plugin means deleting this folder.
- **No local model.** The AI service is created with `allowLocal: false`, so only cloud providers are available. On-device models need the desktop app.

## Two ways in

`plugin.json` defines five entry points, which pick one of two layouts:

| Layout | Entered by | What you get |
| :--- | :--- | :--- |
| Quick note | `md`, `markdown`, `新建`, `草稿`, `note`, or text selected in another app | The sidebar is closed. A full-width editor for writing and leaving. |
| Workspace | `Inkpoint`, `工作区`, `workspace`, opening a folder, or opening a Markdown file | The file tree is open. It restores the last workspace or file and supports creating, renaming, deleting and searching files. |

| `plugin.json` code | Command words |
| :--- | :--- |
| `workspace` | Markdown 编辑器, 编辑器, 文档库 |
| `scratchpad` | md, markdown, 新建, 草稿, note |
| `open-file` | 编辑 Markdown (on a file) |
| `selection-edit` | Markdown 编辑/润色 (on selected text) |
| `open-folder` | 打开 Markdown 文件夹 |

To call the plugin from any window, set a global hotkey in uTools (`Cmd/Ctrl + ,`, then global shortcuts) and point it at the command `md`.

## Shortcuts

The formatting shortcuts come from `@md-editor/core`, so they match the desktop app. Examples: `Mod+B` bold, `Mod+I` italic, `Mod+E` inline code, `Mod+Shift+H` highlight, `Mod+Alt+1` to `6` headings, `Mod+F` find and `Mod+H` replace. `Mod` is `Cmd` on macOS and `Ctrl` elsewhere.

The plugin adds these on top of them:

| Shortcut | Action |
| :--- | :--- |
| `Mod+S` | Save the document to disk |
| `Mod+N` | New document |
| `Mod+O` | Open a Markdown file |
| `Mod+Alt+O` | Open a folder (`Mod+Shift+O` stays with the ordered list) |
| `Mod+Shift+B` or `Mod+\` | Show or hide the file tree |
| `Mod+/` | Switch between WYSIWYG and source |
| `Mod+,` | Open settings and the shortcut list |
| `Mod+Enter` | Paste the text back into the app you came from and hide uTools |
| `Mod+J` or `Mod+Shift+A` | Continue writing with AI |
| `Mod+Shift+G` | Fix grammar with AI |

## Development

```bash
pnpm dev:utools    # Vite on http://127.0.0.1:5174/
```

To load it in uTools:

1. Open the uTools developer tools plugin.
2. Create a project, or choose an existing one, and select the `apps/utools` folder (the one with `plugin.json`).
3. Click "Connect for development". `plugin.json` points `development.main` at the Vite server, so changes reload live.

## Build and release

```bash
pnpm build:utools
```

This writes `apps/utools/dist/`:

- `index.html` and the built assets
- `logo.png` (the uTools icon, `apps/utools/logo.png`, at most 256×256)
- `preload/index.js`, left readable
- `plugin.json` with `main` pointing at `index.html` and the `development` block removed

CI (`.github/workflows/release-utools.yml`) type-checks, tests, builds and validates the manifest on pull requests and manual runs, and uploads `inkpoint-utools-<version>.zip`. Pushing a `utools-v*` tag that matches the version creates a GitHub Release. The version in `apps/utools/package.json`, the source `plugin.json`, the built `dist/plugin.json` and the tag must all be the same. The check also rejects `.map`, `.js.gz` and `.css.gz` files anywhere under `dist`.

uTools has no public API or CLI for its plugin market. To publish, open the developer tools, choose `apps/utools/dist` as the project and use "Package" for a `.upxs` file or "Publish" to submit for review. CI holds no uTools credentials. See uTools' guides on [publishing to the market](https://www.u-tools.cn/docs/developer/basic/publish-plugin.html) and [offline packages](https://www.u-tools.cn/docs/developer/basic/offline-plugin.html).
