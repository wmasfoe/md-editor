# Rust workspace structure

> Scope: this document describes the Beta Rust workspace. The former JavaScript workspace structure checker and its generated rules have been retired.

## Workspace members

| Path | Responsibility |
| --- | --- |
| `apps/desktop` | Native GPUI application, platform integration, documents, files, settings and local AI process integration. Binary package: `inkpoint-gpui`. |
| `packages/editor-core` | Markdown source document, editing session, selection, commands and editing transactions. |
| `packages/editor-typeset` | Markdown layout projection, rendered text mapping and geometry helpers. |
| `packages/editor-gpui` | GPUI editor view, native input handling, rendering and host-facing editor actions. |

The workspace definition in the root `Cargo.toml` is authoritative. Keep platform UI and OS integration in `apps/desktop`; put reusable document behavior in the crate that owns that behavior. Avoid duplicating editing semantics in the host.

## Rust conventions

- Keep implementation modules under each crate's `src/` directory.
- Put integration tests under the crate's `tests/` directory. Unit tests may live beside the code they exercise.
- Make cross-crate dependencies explicit in `Cargo.toml`. `editor-typeset` depends on `editor-core`; `editor-gpui` depends on both editor crates; the desktop host integrates the core and GPUI view.
- When moving a module, update its callers and imports directly. Do not keep compatibility-only forwarding modules.
- Use `cargo fmt --all` for formatting and keep the lockfile current when dependency declarations change.

## Verification

Run workspace checks from the repository root:

```sh
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
```
