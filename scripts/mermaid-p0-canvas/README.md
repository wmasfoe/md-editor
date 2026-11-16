# Mermaid canvas P0 prototype (candidate B)

This isolated probe combines `@visimer/core@1.1.3` for Mermaid parsing and source patches, `@xyflow/react@12.12.1` for interactive nodes/edges, and `@dagrejs/dagre@3.1.3` for default flowchart positions. Generated source is parsed by the repository's Mermaid 11.17.2. This is feasibility code; production P1 is held until the remaining gates are met.

Install the shared isolated dependencies and run from the repository root:

Shared setup uses the tracked `../mermaid-p0/dependency-lock.json` and `npm ci` to reproduce the isolated dependency tree, without changing workspace dependencies.

```sh
node scripts/mermaid-p0/setup.mjs
node scripts/mermaid-p0-canvas/run.mjs
node --test scripts/mermaid-p0/*.test.mjs scripts/mermaid-p0-canvas/*.test.mjs
```

The runner checks actual installed versions, launches local Vite and Chromium, then writes `scratch/mermaid-visual-editing-p0/canvas-results/results.json`, `flowchart.png`, `sequence-existing.png`, and `sequence.png`. Each candidate uses a separate Vite optimization cache. Chromium and the repository's existing desktop development dependencies are required. Loopback listening/browser launch may require the environment's network permission. A runtime/assertion failure exits nonzero and remains in the JSON; `NOT RUN` is not a product pass.

The same source fixtures as candidate A cover:

- Existing flow/sequence labels, aliases and exact duplicate-message targeting, with byte-exact source replacement assertions.
- Real mouse dragging, exact graph entity/Handle ID correlation, SVG endpoints and arrow markers. Sequence participants move horizontally; message row order comes from core events.
- Three-node/two-edge flow creation; two-participant sequence creation with a request P1→P2 and return P2→P1. Both outputs pass Mermaid 11 parsing.
- Real nondefault positions retained through edits/additions/theme changes, browser reload, and visible default-position reset without source changes.
- A core source undo and no-op check; unsupported `loop`/`subgraph` and invalid source fallback; empty source reload; malformed saved JSON is reported and retained.

The initial endpoint measurement incorrectly treated DOM-order union-query results as source/target pairs. It was repaired by matching each core entity to its exact handles and measuring SVG points. Preservation tests now require nonempty manual positions, rather than comparing two empty maps.

The prototype saves `{version, source, layout}` to `localStorage` keys `mermaid-p0:flow` and `mermaid-p0:sequence`; `mermaid-p0:type` selects the active view. It holds one diagram per type, not document/block identity. “Save layout” writes a source/position snapshot. “Reset layout” removes that cached entry and recalculates visible positions; the next save writes the new snapshot. This behavior does not implement a draft transaction, cancellation or combined source/layout undo. Deleting a prototype cache is not a production document operation.

Full session cancel/apply/undo, structural deletion, participant-ID changes without aliases, multi-diagram/document isolation, file copying/moving, unknown metadata versions/limits, WebView, common preview/export rendering, full grammar, and production performance remain unverified. A successful runner exit means its executed checks passed; the complete product P0 gate remains unmet. See the [P0 report](../../docs/agent/status/mermaid-visual-editing-p0.md).
