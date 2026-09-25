---
name: git-workflow
description: "Standard Git commit, verification, push, and CI watch workflow for md-editor"
---

# Git Workflow & Pre-Push Quality Protocol

This skill guides agents through the mandatory lifecycle for branching, committing, verifying, pushing code, and monitoring CI checks in the `md-editor` workspace.

## 1. Branch Naming Protocol (Mandatory)

All git branches MUST follow the `<category>/<kebab-case-description>` pattern:
- **Features**: `feature/<name>` (⚠️ **STRICTLY FORBIDDEN to use `feat/<name>`**; `feat` is for commit types, while branches must use `feature/`)
- **Bug Fixes**: `fix/<name>` or `hotfix/<name>`
- **Refactoring**: `refactor/<name>`
- **Documentation**: `docs/<name>`
- **Performance**: `perf/<name>`
- **CI / Build**: `ci/<name>` or `chore/<name>`

### Examples
- ✅ `feature/desktop-r2-distribution`
- ✅ `feature/mobile-editor-core`
- ✅ `fix/table-cell-editing`
- ✅ `refactor/split-desktop-view`
- ❌ `feat/desktop-r2-distribution` (Do NOT abbreviate to `feat/`)
- ❌ `update-something` (Missing category prefix)

---

## 2. Commit Protocol (Mandatory Conventional Commits)

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

## 3. Pre-Push Verification (Mandatory)

Before executing `git push`, the agent MUST run and ensure the following checks pass:

```bash
# 1. Check linting, Prettier formatting, and Rust cargo clippy/fmt
pnpm lint

# 2. Run unit tests across all workspaces (unit tests must pass 100%; e2e is optional)
pnpm test

# 3. Verify TypeScript types across all workspaces
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

## 4. Push and Post-Push CI Monitoring (Mandatory)

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

## 5. Multi-Platform Release Protocol

For multi-platform releases, version bumps, changelog maintenance, and production deployment, refer to the dedicated **Release Skill**:
- [`.agents/skills/release/SKILL.md`](file:///Users/ikun/code/md-editor/.agents/skills/release/SKILL.md)

### Release Command Quick Reference

| Platform | Command | Tag Pattern | CI Workflow |
| :--- | :--- | :--- | :--- |
| **Desktop** | `pnpm release:desktop` | `v*` | `.github/workflows/release-desktop.yml` |
| **Android** | `pnpm release:android` | `android-v*` | `.github/workflows/release-mobile.yml` |
| **Web** | `pnpm release:web` | `web-v*` | `.github/workflows/release-web.yml` |
| **Site** | `pnpm release:site` | N/A | Vercel CLI Prebuilt Deploy |
| **Worker** | `pnpm deploy:worker` | N/A | Cloudflare Worker CLI |
