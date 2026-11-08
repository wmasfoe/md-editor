# Releasing

Each part of the project is released on its own, with its own version and changelog. All release commands start with `release:`.

## Overview

| Part | Workspace | Commands | Tag | Changelog | Workflow |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Desktop | `apps/desktop` | `pnpm release:desktop`, `pnpm release:desktop:version` | `v*` (also `desktop-v*`) | `apps/desktop/CHANGELOG.md` and `CHANGELOG_EN.md` | `.github/workflows/release-desktop.yml` |
| Web | `apps/web` | `pnpm release:web`, `pnpm release:web:version`, `pnpm release:web:publish` | `web-v*` (a record only, no GitHub Release) | `apps/web/CHANGELOG.md` and `CHANGELOG_EN.md` | `.github/workflows/release-web.yml` |
| uTools | `apps/utools` | `pnpm build:utools` | `utools-v*` | `apps/utools/CHANGELOG.md` and `CHANGELOG_EN.md` | `.github/workflows/release-utools.yml` |
| Site | `apps/site` | `pnpm release:site` | none | reads the desktop and web changelogs | Vercel CLI |
| Worker | `infra/distribution-worker` | `pnpm deploy:worker` | none | none | Wrangler |

Mobile is not released any more. See [Mobile](#mobile).

## Desktop

- `pnpm release:desktop:version` (`scripts/release/version-desktop.mjs`) bumps the version and writes the changelog entry. It updates `apps/desktop/package.json`, `tauri.conf.json` and `Cargo.toml`, and writes `CHANGELOG.md` and `CHANGELOG_EN.md`. `Cargo.lock` changes with the version, and the release commit includes it. It makes no commit and no tag. The root `package.json` stays at `0.0.0`.
- `pnpm release:desktop` (`scripts/release/publish-desktop.mjs`) does that, then commits as `chore(release): release vX.Y.Z`, creates an annotated tag `vX.Y.Z` and pushes the branch and the tag. The tag starts `release-desktop.yml`, which builds every platform and publishes the release.

```bash
pnpm release:desktop                       # interactive
pnpm release:desktop patch --notes "Fix a save race" --notes-en "Fix a save race" --pr "226, 227"
pnpm release:desktop 0.10.2 --notes "Bug fixes"
pnpm release:desktop:version               # version files and changelog only
```

`--pr` takes numbers without the `#` and writes them into the changelog heading. Both release scripts must run on `main` unless you pass `--allow-any-branch`. `release:web:publish` deploys after pushing when you answer yes, or always with `--yes`/`--deploy`, and never with `--no-deploy` or `--no-push`.

## Web

`pnpm release:web` (`scripts/web/deploy-web.mjs`) builds the playground locally and deploys it to Vercel production. It never creates a GitHub Release, so the repository's Latest badge stays on the desktop app. `apps/web/vercel.json` turns off deploys from git pushes.

```bash
pnpm release:web                                   # build and deploy
pnpm release:web --dry-run                         # print the commands only
pnpm release:web:version patch                     # version and changelog only
pnpm release:web:publish patch --notes "Add MDX preview"   # version, changelog, a web-v* tag, then asks whether to deploy
```

## Mobile

Android and iOS are not released any more. There is no release script, no CI on tags and no changelog to update. The website and the download gateway keep serving the last published builds (Android 0.2.1, iOS 0.2.1). Newer versions are built on your machine:

```bash
pnpm build:android   # dist-mobile/Inkpoint_<version>.apk (debug-signed; needs JDK 17 and the Android SDK)
pnpm build:ios       # dist-mobile/Inkpoint-<version>-unsigned.ipa (unsigned; needs macOS and Xcode)
```

The version comes from `versionName` in `apps/mobile/android/app/build.gradle.kts` and `MARKETING_VERSION` in the Xcode project, or from `--version`. Both scripts run `pnpm build:mobile` first to copy the web bundle into the native projects; pass `--no-sync` if you already did.

## uTools

A `utools-v*` tag starts `release-utools.yml`, which builds the plugin and creates a GitHub Release. CI checks that the tag, `apps/utools/package.json`, the source `plugin.json` and the built `plugin.json` have the same version, and that the release build has no `development` block. The uTools market has no public API, so the listing is submitted by hand in the uTools developer tools.

```bash
pnpm build:utools
node scripts/release/validate-utools-release.mjs --dist apps/utools/dist
git tag utools-v0.1.0
git push origin utools-v0.1.0
```

## Site

```bash
pnpm dev:site        # preview
pnpm build:site      # production build
pnpm release:site    # deploy to Vercel production
```

The site shows the desktop and web changelogs at `/changelog`.

## Options shared by the desktop and web scripts

- `--dry-run`: show what would happen and change nothing.
- `--resume`: continue after the version files were already changed.
- `--no-push`: commit and tag locally, do not push.
- `--branch <name>`: the branch the release must run on (default `main`).
- `--allow-any-branch`: skip the branch check.
- `--yes`, `-y`: skip the final confirmation.
- `--notes <text>`, `--notes-en <text>`, `--pr <numbers>`: the changelog text in Chinese and English, and the pull requests to list.
