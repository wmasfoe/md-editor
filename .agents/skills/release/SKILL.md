---
name: release
description: "Cross-platform release, version bumping, changelog maintenance, and production deployment protocol for md-editor"
---

# Multi-Platform Release & Deployment Skill

This skill guides agents through the end-to-end lifecycle for versioning, changelog generation, tagging, CI/CD pipeline monitoring, and production deployment across all client platforms in the `md-editor` workspace.

## 1. Operating Principles

1. **Strict Platform Symmetry**: Every client platform (`desktop`, `web`, `site`, `utools`, `worker`) has a clear, isolated release lifecycle and namespace.
2. **Single Source of Truth in Git**:
   - **NEVER** build or upload binaries out-of-band without committing the version bump and changelog to the Git repository.
   - Version files (`package.json`, `build.gradle.kts`, `tauri.conf.json`, `Cargo.toml`) and `CHANGELOG.md` (plus `CHANGELOG_EN.md`) must be updated and committed together.
3. **Changelog-Driven Presentation**:
   - The official website (`site`) and distribution portal read directly from each platform's `CHANGELOG.md` at build/ISR time.
   - A release is only complete when its user-facing changelog entry is present in both Chinese (`CHANGELOG.md`) and English (`CHANGELOG_EN.md`).
4. **Pre-Release Quality Gate**:
   - Working tree must be clean.
   - Must be on the latest `main` branch.
   - `pnpm verify` (`lint` + `test` + `typecheck`) must pass 100% before any release command is executed.

---

## 2. Multi-Platform Release Matrix

| Platform / Target | Full Release Command | Version Bump Only | Git Tag Pattern | CI/CD Workflow | Version Files & Changelog | Distribution Target |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Desktop App** | `pnpm release:desktop` | `pnpm release:desktop:version` | `v*` (e.g. `v0.12.1`) | `.github/workflows/release-desktop.yml` | `apps/desktop/package.json`<br>`src-tauri/tauri.conf.json`<br>`src-tauri/Cargo.toml`<br>`apps/desktop/CHANGELOG*.md` | Cloudflare R2 (`/inkpoint/desktop/`)<br>Homebrew Tap<br>GitHub Releases |
| **Web Playground** | `pnpm release:web` | `pnpm release:web:version`<br>`pnpm release:web:publish` | `web-v*` (archival tag only) | `.github/workflows/release-web.yml` | `apps/web/package.json`<br>`apps/web/CHANGELOG*.md` | Vercel Production (`editor.jiaqi.im/playground`) |
| **Official Site** | `pnpm release:site` | N/A | Triggered on release or manual | Vercel CLI Prebuilt Deploy | Sourced from Desktop & Web changelogs | Vercel Production (`editor.jiaqi.im`) |
| **Distribution Worker** | `pnpm deploy:worker` | N/A | Manual / Infrastructure deploy | Cloudflare Worker CLI | `infra/distribution-worker` | Cloudflare Edge (`download.jiaqi.im`) |
| **uTools Plugin** | Manual Review | `apps/utools/package.json` | `utools-v*` | `.github/workflows/release-utools.yml` | `apps/utools/package.json`<br>`apps/utools/CHANGELOG*.md` | uTools Developer Center (manual submission) |
| **Public NPM Packages** | `pnpm release:packages` | `pnpm changeset:version` | `<pkg>@<version>` | `.github/workflows/release-npm-packages.yml` | `packages/*/package.json`<br>`packages/*/CHANGELOG.md` | npm registry (`https://registry.npmjs.org`) |

---

## 3. Platform Release Workflows

### 3.1 Desktop Release (`apps/desktop`)
1. **Pre-check**: Ensure working tree is clean and `pnpm verify` passes.
2. **Execute release**:
   ```bash
   # Interactive mode (prompts for patch / minor / major / beta / notes)
   pnpm release:desktop

   # Or non-interactive CLI:
   pnpm release:desktop patch --notes "修复已知缺陷"
   ```
3. **What happens automatically**:
   - Updates version in `apps/desktop/package.json`, `tauri.conf.json`, `Cargo.toml`.
   - Prepends new version block into `apps/desktop/CHANGELOG.md` and `apps/desktop/CHANGELOG_EN.md`.
   - Creates commit `chore(release): release vX.Y.Z` and annotated tag `vX.Y.Z`.
   - Pushes tag to origin, triggering `.github/workflows/release-desktop.yml`.
   - GitHub Actions builds macOS (DMG + updater), Linux (AppImage + DEB), and Windows (Setup EXE).
   - Uploads artifacts to Cloudflare R2, updates `version.json`, purges CDN cache, and triggers `pnpm release:site`.

### 3.2 Mobile (Android / iOS)
Mobile is no longer released: there is no release script, no tag-triggered CI, and no changelog to update. The site and the distribution gateway only offer the last published builds (Android 0.2.1, iOS 0.2.1). Newer builds are compiled locally:

```bash
pnpm build:android   # dist-mobile/Inkpoint_<version>.apk (needs JDK 17 + Android SDK)
pnpm build:ios       # dist-mobile/Inkpoint-<version>-unsigned.ipa (needs macOS + Xcode)
```

### 3.3 Web Playground Release (`apps/web`)
1. **Scheme A - Vercel CLI Direct Deploy (Recommended)**:
   ```bash
   pnpm release:web
   ```
   Directly pulls production environment, prebuilds, and deploys to Vercel production without polluting GitHub Releases.
2. **With Version & Changelog Archive**:
   ```bash
   pnpm release:web:publish patch --notes "新增 MDX 动态预览支持"
   ```
   Updates `apps/web/package.json`, updates `apps/web/CHANGELOG*.md`, pushes `web-v*` archival tag, and deploys.

### 3.4 Official Site Deployment (`site`)
1. **Deploy Site**:
   ```bash
   pnpm release:site
   ```
2. **Mechanics**:
   - Uses Vercel CLI with prebuilt output (`pull` -> `build --prod` -> `deploy --prebuilt`).
   - Reads `apps/desktop/CHANGELOG.md` and `apps/web/CHANGELOG.md`.
   - `/changelog` route uses Next.js ISR (`export const revalidate = 300`) for high-performance edge caching.

### 3.5 Distribution Worker Deployment (`infra/distribution-worker`)
1. **Deploy Worker**:
   ```bash
   pnpm deploy:worker
   ```
2. Deploys updated Cloudflare Worker handling download redirects, device directories, and release API metadata.

### 3.6 Public NPM Packages Release (`packages/*`)
1. **Prerequisite**: Ensure `NPM_TOKEN` is configured in GitHub Repository Secrets (**Settings -> Secrets and variables -> Actions**).
2. **Changeset generation**: When modifying public packages (`core`, `editor`, `plugin-sdk`, `shared`, `markdown-fidelity`, `plugin-host`), run `pnpm changeset` in your PR branch, choose the SemVer type, write an English description, and commit `.changeset/*.md`.
3. **Automated Versioning**: When changesets merge into `main`, `.github/workflows/release-npm-packages.yml` automatically updates the "chore(release): version npm packages" PR with bumped versions and changelogs.
4. **Automated Publishing**: Merging the "Version Packages" PR triggers `.github/workflows/release-npm-packages.yml`, executing `pnpm release:packages` (which runs `pnpm verify:packages` and publishes to npm with Git tags).
5. **Reference**: See [`docs/agent/release/npm_automated_release_changesets.md`](../../../docs/agent/release/npm_automated_release_changesets.md).

---

## 4. Post-Release Verification Checklist

After the release workflow runs, verify each checkpoint:

1. **GitHub Actions Workflow**:
   ```bash
   gh run list --limit 3
   gh run watch <run_id>
   ```
   Ensure all matrix jobs (build, package, upload, site deploy) are green.
2. **Distribution Edge API**:
   ```bash
   curl -s https://download.jiaqi.im/api/inkpoint/releases | jq '{latestDesktopVersion}'
   ```
   Confirm `latestDesktopVersion` matches the expected version.
3. **Direct Download Links**:
   - Desktop: `https://download.jiaqi.im/inkpoint/desktop/macos/latest`
4. **Website Rendering**:
   - Home page: check that the download CTA displays the correct version badge.
   - Changelog page (`/changelog`): verify the tabs (Desktop, Web, Model) show the newly released version and notes.

---

## 5. Troubleshooting & Rollback SOP

- **Broken Release CI Job**:
  1. Inspect failed logs: `gh run view --log-failed <run_id>`.
  2. If caused by network timeout or temporary R2 token glitch, re-run failed jobs via GitHub CLI or Actions UI.
  3. If code or script error, fix on a `fix/<description>` branch, land PR to `main`, and re-trigger release.
- **R2 Edge Cache Stale**:
  Run cache purge manually:
  ```bash
  node scripts/release/purge-download-cache.mjs
  ```
- **Never delete or rewrite published tags on remote**:
  Always increment with a new patch release (e.g. `0.12.2` or `0.2.1`) to preserve immutable download history.
