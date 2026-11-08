# @md-editor/web

The Inkpoint Web Playground: the editor running in a browser, with nothing to install. It is built with [Vite 6](https://vitejs.dev/) and [React 19](https://react.dev/), uses the same renderer, UI and syntax plugins as the desktop app, and is served at `/playground` on the website.

## How it stores things

- **Folders and files.** In browsers that support the File System Access API (Chrome, Edge and other Chromium browsers), "Open folder" gives the page a handle to a real folder. The playground reads the folder as a tree and creates, renames, deletes and saves files in it directly. Pasted images are written into the folder. In other browsers the folder picker is unavailable and shows an error. Single files open through the same API when it exists.
- **Draft.** The document you are editing is also saved to `localStorage` under `md-editor:web:draft`, so reloading the page keeps it. Settings and AI configuration use `localStorage` too.
- **Download.** Any document can be downloaded as a `.md` file or copied to the clipboard.

The first time a page opens with no saved draft it shows a showcase document, in the current interface language (`src/presets/showcase.ts`).

## Differences from the desktop app

- Cloud AI providers only. There is no local model (`allowLocal: false`).
- No Quick Look, no auto-update and no external plugin install, which need the desktop shell. `src/plugin-preview/` is a separate page for trying a plugin from a GitHub release in the browser.

## Development

```bash
pnpm dev:web                                  # Vite on http://localhost:5174/playground/
pnpm build:web                                # writes apps/web/dist
pnpm --filter @md-editor/web preview          # serve the build locally
pnpm --filter @md-editor/web test             # unit tests
pnpm --filter @md-editor/web typecheck
pnpm --filter @md-editor/web test:browser     # Playwright
```

The base path is `/playground/` and can be changed with `VITE_BASE_PATH`.

## Deploy

```bash
pnpm release:web
```

This builds locally and deploys the result to Vercel production. Git pushes do not deploy it (`vercel.json` turns that off).
