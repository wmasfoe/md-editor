# Mermaid default renderer integration probe

Run from the repository root with installed workspace dependencies and Playwright Chromium:

```sh
node scripts/mermaid-default-layout-render-p0/runner.mjs
node --test scripts/mermaid-default-layout-render-p0/*.test.mjs
```

The probe uses the installed `@visimer/core` / `@visimer/dom` 1.1.3 and Mermaid 11.17.2, a temporary loopback Vite page, and actual Chromium renders. Results are saved to `scratch/mermaid-default-layout-render-p0/results/results.json`.

It preserves two raw findings: concurrent themes contaminate the shared Mermaid singleton, and a view destroyed after render starts can write into its detached SVG host. The second finding is repaired only in an isolated scratch copy of the published DOM 1.1.3 package. The runner checks the upstream `dist/index.js` SHA256 (`19e36af849b528373fca55f30675a6300d3596abe3f00719ff33ab150b637f9c`), applies exact unique source anchors, and verifies the generated diff equals [visimer-dom-1.1.3-lifecycle.patch](./visimer-dom-1.1.3-lifecycle.patch). The patched copy SHA256 is recorded in results. No installed package or production file is modified.

The lifecycle patch increments `renderSeq` on destroy, ignores successful or failed render completions after destroy, and prevents `validate()` from reporting success or diagnostics after destroy. A gated real render and parser exercise both success and rejection after destruction; the patched view produces no detached SVG writes, render events, or diagnostic writes. The unpatched upstream control reproduces the detached write.

A separate test-only serialized facade snapshots per-view config and queues initialize/render/parse, forcing `securityLevel: strict`. It passes reference-based mixed theme renders, rapid same-view theme switching, strict malicious-link checks, and invalid parse/render recovery. It also balances document/canvas-root listeners, ResizeObserver/MutationObserver disconnects, and pending timers across 20 cycles. The facade is an experiment rather than existing production integration.
