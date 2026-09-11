---
name: git-workflow
description: "Standard Git commit, verification, push, CI watch, and multi-platform release workflow for md-editor"
---

# Git Workflow & Multi-Platform Release Protocol

This skill guides agents through the mandatory lifecycle for committing, verifying, pushing code, monitoring CI checks, and executing multi-platform releases in the `md-editor` workspace.

## 1. Commit Protocol (Mandatory Conventional Commits)

All commit messages MUST strictly adhere to the Conventional Commits specification:

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Allowed Types
- `feat`: A new feature or capability (e.g. `feat(renderer): add dynamic plugin registration`)
- `fix`: A bug fix (e.g. `fix(wysiwyg): calibrate code-block drag alignment`)
- `perf`: A code change that improves performance (e.g. `perf(parser): bypass ast rebuild for ui plugins`)
- `refactor`: A code change that neither fixes a bug nor adds a feature (e.g. `refactor(plugins): decouple syntax plugins to subpackage`)
- `docs`: Documentation only changes (e.g. `docs: update plugin development guide`)
- `test`: Adding or correcting tests (e.g. `test(core): add regression tests for markdown fidelity`)
- `chore`: Changes to build process, dependencies, or tooling (e.g. `chore: update dependencies`)
- `style`: Formatting or whitespace fixes (e.g. `style: format markdown tables`)
- `ci`: Changes to CI configuration or workflow files (e.g. `ci: add automated desktop release`)

### Disallowed Patterns
- ❌ No arbitrary capitalized sentences (e.g. `Update some files`, `Fixed bug`)
- ❌ No Lore trailers (`Constraint:`, `Rejected:`, `Directive:`, `Confidence:`)
- ❌ No vague messages (e.g. `wip`, `misc fixes`)

---

## 2. Pre-Push Verification (Mandatory)

Before executing `git push`, the agent MUST run and ensure the following checks pass:

```bash
# 1. Check linting, Prettier formatting, and Rust cargo clippy/fmt
pnpm lint

# 2. Run unit tests across all workspaces (unit tests must pass 100%; e2e is optional)
pnpm test

# 3. Verify TypeScript types across all 14 packages
pnpm typecheck
```

Alternatively, run the unified verification script:
```bash
pnpm verify
```

If ANY of these commands fail:
- DO NOT proceed to push.
- Investigate and fix the issue first.
- Re-run verification until all commands exit with code 0.

---

## 3. Push and Post-Push CI Monitoring (Mandatory)

After pushing changes to the remote branch:

```bash
git push origin <branch>
```

### Automated CI Watch
If the current branch has an associated open Pull Request, the agent MUST automatically monitor CI status:

```bash
pnpm pr:watch
# or:
gh pr checks <pr_number> --watch
```

### Reporting
- If all checks pass: Report the success and active PR link to the user.
- If any check fails: Inspect the failed step log (`gh run view --log-failed`), identify the failure reason, and either fix it or provide a detailed diagnostic report.

---

## 4. Multi-Platform Release & Changelog Protocol

All release and deployment commands are strictly scoped under the `release:*` namespace to ensure platform symmetry and zero legacy alias baggage.

| Platform / Target | Full Release (Interactive) | Version Bump Only | Git Tag Pattern | CI/CD Workflow | Changelog Files |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Desktop App** | `pnpm release:desktop` | `pnpm release:desktop:version` | `v*` (e.g. `v0.10.2`) | `.github/workflows/release-desktop.yml` | `apps/desktop/CHANGELOG.md` & `CHANGELOG_EN.md`<br>(root `CHANGELOG.md` & `CHANGELOG_EN.md` mirrored) |
| **Web Playground** | `pnpm release:web` | `pnpm release:web:version` | `web-v*` (e.g. `web-v0.2.0`) | `.github/workflows/release-web.yml` | `apps/web/CHANGELOG.md` & `apps/web/CHANGELOG_EN.md` |
| **Official Site** | `pnpm release:site` | N/A | Triggered on release or manual | Vercel CLI Prebuilt Deploy | Sourced from Desktop & Web changelogs (bilingual zh/en) |

### Platform-Specific Rules

1. **Desktop App (`apps/desktop`)**:
   - `pnpm release:desktop` updates version across `package.json`, `apps/desktop/package.json`, `tauri.conf.json`, `Cargo.toml`.
   - Appends release notes to `apps/desktop/CHANGELOG.md` and root `CHANGELOG.md` (English entries maintained in `apps/desktop/CHANGELOG_EN.md` and root `CHANGELOG_EN.md`).
   - Pushes commit and annotated tag `v<version>`, triggering multi-platform builds (macOS DMG, Linux AppImage/deb, Windows NSIS).

2. **Web Playground (`apps/web`)**:
   - `pnpm release:web` updates `apps/web/package.json`.
   - Appends release notes to `apps/web/CHANGELOG.md` (English entries maintained in `apps/web/CHANGELOG_EN.md`).
   - Runs `pnpm build:web` validation.
   - Pushes commit and annotated tag `web-v<version>`, triggering `.github/workflows/release-web.yml` bundle packaging and GitHub Release.

3. **Official Site (`site`)**:
   - Runs `pnpm release:site` via `scripts/site/deploy-site.mjs`.
   - The `/changelog` page dynamically supports Desktop and Web tab switching as well as seamless Chinese/English bilingual language toggling.

### Removed / Deprecated Commands (Do NOT Use)
- ❌ `pnpm release` → Replaced by `pnpm release:desktop`
- ❌ `pnpm release:version` → Replaced by `pnpm release:desktop:version`
- ❌ `pnpm deploy:site` → Replaced by `pnpm release:site`
