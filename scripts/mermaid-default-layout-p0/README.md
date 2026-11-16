# Mermaid default-layout P0a probe

This bounded probe exercises the pinned `@visimer/core`/`@visimer/dom` 1.1.3 and Mermaid 11.17.2 using Playwright Chromium. It checks selected entity identity and byte-preserving source edits for same-label flow nodes, duplicate edges/messages, duplicate aliases, unaliased participant rename and ID collision, reference-first deletion, and flow/sequence creation from their legal empty headers. Empty sequence creation is checked against the full exact source line order, including request direction and return direction. Repeated primary declarations and unsupported source shapes must fall back without writes. Operations are triggered by visible browser controls, and selected graph entities by actual pointer input. Mermaid parses the resulting diagrams.

The toolbar is intentionally inside each canvas because Visimer's document-level capture-phase pointer handler clears graph selection when a click lands outside that canvas. The deletion controls have a bounded reference guard. Visimer's raw `deleteNode` and `seq.deleteParticipant` operations cascade references; the product surface must continue blocking deletion until relations/messages are removed. The sequence rename to an already used ID is also blocked because the raw core operation currently merges the participants.

The separate baseline runner supplies real mouse drag-connect and built-in inline label-edit regression evidence for existing diagrams. The new probe adds empty flow/sequence creation by UI controls; it does not count API dispatch alone as gesture evidence.

From the repository root:

```sh
node scripts/mermaid-default-layout-p0/runner.mjs
node --test scripts/mermaid-default-layout-p0/*.test.mjs
```

The browser runner opens a temporary loopback Vite server. In sandboxed environments, run the command with the environment's approved loopback permission. Reports and screenshot are written under ignored `scratch/mermaid-default-layout-p0/`; the existing baseline report remains under `scratch/mermaid-visual-editing-p0/`.
