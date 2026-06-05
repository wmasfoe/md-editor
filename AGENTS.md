# Repository Guidelines

## Project Structure & Module Organization

This repository currently contains project documentation for an AI-assisted Markdown / MDX editor. The entry point is `docs/index.md`, which routes readers to:

- `docs/agent/`: technical requirements, implementation planning, and agent-facing records.
- `docs/human/`: human-facing project summaries and coordination notes.

The planned product structure is a TypeScript monorepo with `apps/desktop`, `apps/web`, and feature packages under `packages/`, but those directories are not scaffolded yet. When implementation begins, keep source code, tests, and assets near their owning app or package.

## Build, Test, and Development Commands

There is no package manager or build system configured yet. Useful current commands:

- `find docs -type f -name '*.md'`: list documentation files.
- `rg "Milkdown|MDX|Tauri" docs/`: search project decisions.
- `git status`: check pending changes once a Git repository is initialized.

After scaffolding, document the real commands here, for example `npm run dev`, `npm run build`, and `npm test`.

## Coding Style & Naming Conventions

Keep Markdown concise and structured with clear headings. Use fenced code blocks with language tags where applicable, such as `ts`, `txt`, or `md`. Prefer ASCII punctuation unless preserving existing Chinese-language content.

For future TypeScript code, use descriptive module names matching the technical plan, for example `editor-core`, `feature-source-mode`, and `file-system`. Prefer kebab-case for package folders and PascalCase for React components.

## Testing Guidelines

No tests exist yet. When code is added, place tests close to the module they cover or in a package-level `tests/` directory. Use explicit names such as `source-mode.test.ts` or `file-service.spec.ts`. Prioritize coverage for Markdown/MDX serialization fidelity, file lifecycle behavior, and export pipelines.

## Commit & Pull Request Guidelines

This directory is not currently a Git repository, so no local commit convention can be inferred. Use concise, imperative commit messages such as `Add MDX parsing plan` or `Implement file service tests`.

Pull requests should include a short summary, changed files or areas, validation steps, and screenshots for UI work. Link related issues or planning docs when available.

## Agent-Specific Instructions

Before editing implementation plans, read `docs/agent/index.md` and the relevant requirement or technical plan. Preserve the distinction between agent-facing and human-facing documents, and update communication records when making planning changes.

## 文档规范

你可以**按需阅读** [agent/index](./docs/agent/index.md) 这篇文档，来获得相应的信息，**注意是按需阅读目录下的文件**，不可一下加载所有的文档。

如果你有文档需要记录，只可以记录在 `./docs/agent/` 目录下，并且更新 `./docs/agent/index.md` 这篇目录文档，在记录时说清楚文档的用途，以便将来更好的查询。

## 代码规范

编码过程中注意写注释。
