# Mermaid P0 browser probe

For a clean checkout, install the fixed Visimer packages and canvas alternative into the isolated scratch directory:

```sh
node scripts/mermaid-p0/setup.mjs
```

The tracked `dependency-lock.json` fixes the isolated dependency tree and tarball integrity values. Setup derives a private manifest from that lock, copies it to `scratch/mermaid-visual-editing-p0/dependencies/package-lock.json`, and runs `npm ci` with lifecycle scripts, audit, and funding notices disabled. npm verifies lockfile integrity and replaces only that scratch directory's `node_modules`. It does not change the workspace manifest or lockfile. The probe also expects the repository's Mermaid package and the desktop app's Vite/Playwright dependencies to be installed, plus a Playwright Chromium browser.

The shared setup pins `@visimer/core`/`@visimer/dom` 1.1.3, `@xyflow/react` 12.12.1, and `@dagrejs/dagre` 3.1.3. The canvas alternative has its own runner and results directory; see `../mermaid-p0-canvas/README.md`.

Run from the repository root:

```sh
node scripts/mermaid-p0/runner.mjs
node --test scripts/mermaid-p0/*.test.mjs
```

The runner reads each installed package manifest and aborts if versions differ from core/dom 1.1.3, Mermaid 11.17.2, Playwright 1.61.1, and Vite 6.4.3. It resolves Vite and Playwright from `apps/desktop` with `createRequire`, and aliases the isolated Visimer packages plus the repository's Mermaid installation into a temporary Vite page. Chromium must be available to Playwright. Local loopback listening may require the environment's approved network permission.

Each run creates `scratch/mermaid-visual-editing-p0/results/` before starting, then writes `results.json`, `browser.png`, and `layout-api-evidence.json`. The layout evidence contains the installed packages' actual operation unions and sequence move implementation. Gesture results describe real page input. `NOT RUN` is deliberately not inferred as pass from headless core API operations. Failure results stay in the evidence file.
