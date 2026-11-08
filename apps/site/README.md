# @md-editor/site

The Inkpoint website at [editor.jiaqi.im](https://editor.jiaqi.im), built with [Next.js](https://nextjs.org/) (App Router), [React 19](https://react.dev/) and [Tailwind CSS](https://tailwindcss.com/).

## Pages

- **Home (`/`)**: a hero, sections for editing, AI and MDX with working demos, and the download panel.
- **Changelog (`/changelog`)**: release notes for the desktop app and the Web Playground, plus the local model's changes, with a tab for each. The text comes from the repository's changelog files (`apps/desktop/CHANGELOG.md` and `CHANGELOG_EN.md`, the same for `apps/web`) and, for the model, from a changelog file in the model repository (`MODEL_CHANGELOG_URL`). The page is regenerated every five minutes (`revalidate = 300`), so a new release shows up shortly after it is published.
- **`/playground`**: rewritten to the Web Playground (`apps/web`) by `next.config.ts`.

## Download panel

- Picks a default platform from the visitor's user agent.
- **macOS, Linux and Windows** link to the latest desktop package, and the panel shows the install commands (curl and PowerShell) and the Homebrew command. Links go to the download gateway at `download.jiaqi.im`; `lib/site-links.ts` maps the site domain to its gateway domain.
- **Android and iOS** link to the last published builds (0.2.1, `PUBLISHED_ANDROID_VERSION` and `PUBLISHED_IOS_VERSION` in `lib/downloads.ts`). Mobile is no longer released, so a line under the button points to the build guide.
- The page is available in Simplified Chinese, Traditional Chinese, English and Japanese (`lib/i18n/translations/`).

## Development

```bash
pnpm dev:site                            # http://localhost:3000
pnpm build:site                          # production build
pnpm --filter @md-editor/site test       # unit tests
pnpm --filter @md-editor/site typecheck
```

## Deploy

```bash
pnpm release:site
```

This runs the Vercel CLI (`pull`, `build --prod`, `deploy --prebuilt`) from the repository root. Pushes to git do not deploy it (`vercel.json` turns that off). It needs the Vercel credentials described in `docs/agent/release/release_workflow.md`.
