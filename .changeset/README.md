# Changesets

Welcome! This directory contains Changesets configurations and pending change fragments for `@md-editor/*` public npm packages.

## Instructions for Contributors & Agents

Whenever a pull request makes changes to any of the published public npm packages (`packages/core`, `packages/editor`, `packages/plugin-sdk`, `packages/shared`, `packages/markdown-fidelity`, `packages/plugin-host`):

1. Run:
   ```bash
   pnpm changeset
   ```
2. Select the changed package(s) and specify the appropriate SemVer bump level:
   - `patch`: backwards-compatible bug fixes or performance tweaks.
   - `minor`: backwards-compatible new features, new APIs, or extended types.
   - `major`: breaking changes.
3. Write a concise summary of the changes in English.
4. Commit the generated `.changeset/*.md` file alongside your PR.

## Release Process

When changesets are merged into the `main` branch:
1. GitHub Actions automatically creates or updates the **"Version Packages"** pull request.
2. Merging that PR triggers automated package verification (`pnpm verify:packages`) and publishes the updated packages to npm with proper Git tags.
