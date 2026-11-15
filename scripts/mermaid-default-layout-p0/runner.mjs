import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(root, "scratch/mermaid-default-layout-p0");
await fs.mkdir(outputDir, { recursive: true });
const require = createRequire(path.join(root, "apps/desktop/package.json"));
const { createServer } = await import(require.resolve("vite"));
const { chromium } = require("@playwright/test");
const deps = path.join(root, "scratch/mermaid-visual-editing-p0/dependencies/node_modules");
// Resolve from the owning workspace instead of assuming a node_modules layout.
const syntaxRequire = createRequire(path.join(root, "packages/syntax-plugins/package.json"));
const mermaidRoot = path.dirname(syntaxRequire.resolve("mermaid/package.json"));
const version = (file) => JSON.parse(fsSync.readFileSync(file, "utf8")).version;
const versions = {
  core: version(path.join(deps, "@visimer/core/package.json")),
  dom: version(path.join(deps, "@visimer/dom/package.json")),
  mermaid: version(path.join(mermaidRoot, "package.json")),
  playwright: version(require.resolve("@playwright/test/package.json")),
  vite: version(require.resolve("vite/package.json")),
};
const expected = {
  core: "1.1.3",
  dom: "1.1.3",
  mermaid: "11.17.2",
  playwright: "1.61.1",
  vite: "6.4.3",
};
for (const [key, value] of Object.entries(expected)) {
  if (versions[key] !== value) throw new Error(`${key} must be ${value}, found ${versions[key]}`);
}
const server = await createServer({
  root: path.join(root, "scripts/mermaid-default-layout-p0"),
  cacheDir: path.join(root, "scratch/mermaid-default-layout-p0/vite-cache"),
  configFile: false,
  server: { host: "127.0.0.1", port: 0 },
  resolve: {
    alias: [
      { find: "@visimer/core", replacement: path.join(deps, "@visimer/core/dist/index.js") },
      { find: "@visimer/dom", replacement: path.join(deps, "@visimer/dom/dist/index.js") },
      { find: "mermaid", replacement: path.join(mermaidRoot, "dist/mermaid.core.mjs") },
    ],
  },
});
let browser;
const results = [];
const errors = [];
const mark = (id, ok, detail) => {
  results.push({ id, status: ok ? "PASS" : "FAIL", detail });
  fsSync.writeFileSync(
    path.join(outputDir, "partial-results.json"),
    JSON.stringify({ versions, results, consoleErrors: errors }, null, 2),
  );
};
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1500 } });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/fixtures.html`);
  await page.waitForFunction(
    () =>
      window.probe?.flow.view.svg &&
      window.probe?.seq.view.svg &&
      window.probe?.duplicateAlias.view.svg,
  );
  await page.waitForTimeout(500);

  const select = async (selector, index = 0) => {
    const loc = page.locator(selector).nth(index);
    await loc.scrollIntoViewIfNeeded();
    await loc.click({ force: true });
    await page.waitForTimeout(300);
    return page.evaluate(() => ({
      flow: window.probe.flow.editor.selection,
      seq: window.probe.seq.editor.selection,
      duplicateAlias: window.probe.duplicateAlias.editor.selection,
    }));
  };
  const clickControl = (container, label) =>
    page
      .getByRole("navigation", { name: `${container} probe controls`, exact: true })
      .getByRole("button", { name: label, exact: true })
      .click({ timeout: 5000 });

  // Equal labels make a label-based lookup ambiguous; selection must retain node B's identity.
  const flowBefore = await page.evaluate(() => window.probe.flow.editor.code);
  const flowSelection = await select('#flow g.node[data-mw-entity="node:B"]');
  const nodeB = page.locator('#flow g.node[data-mw-entity="node:B"]');
  await nodeB.dblclick();
  const flowInput = page.locator('#flow [contenteditable="true"]').first();
  await flowInput.fill("Changed");
  await flowInput.press("Enter");
  await page.waitForTimeout(400);
  const flowAfterRename = await page.evaluate(() => window.probe.flow.editor.code);
  const flowExpectedRename = flowBefore.replace("B[Same]", "B[Changed]");
  mark("flow-duplicate-label-selected-entity-patch", flowAfterRename === flowExpectedRename, {
    selected: flowSelection.flow,
    expectedSelection: ["node:B"],
    before: flowBefore,
    expected: flowExpectedRename,
    after: flowAfterRename,
  });
  const edgeIds = await page
    .locator('#flow path[data-mw-entity^="edge:"]')
    .evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute("data-mw-entity")))]);
  mark(
    "flow-duplicate-relations-have-distinct-identities",
    edgeIds.length === 2 && edgeIds[0] !== edgeIds[1],
    { edgeIds },
  );
  const edgeSelection = await select(`#flow path[data-mw-entity="${edgeIds[1]}"]`);
  await clickControl("flow", "rename selected edge");
  const flowAfterEdgeRename = await page.evaluate(() => window.probe.flow.editor.code);
  const flowEdgeExpected = flowExpectedRename.replace("|second|", "|changed relation|");
  mark("flow-selected-edge-label-patch", flowAfterEdgeRename === flowEdgeExpected, {
    selected: edgeSelection.flow,
    expected: flowEdgeExpected,
    after: flowAfterEdgeRename,
  });
  const renamedEdgeId = await page.evaluate(
    () =>
      window.probe.flow.editor.result.flowchart.edges.find(
        (edge) => edge.label === "changed relation",
      )?.entityId,
  );
  await select(`#flow path[data-mw-entity="${renamedEdgeId}"]`);
  await clickControl("flow", "delete selected edge");
  const flowAfterEdgeDelete = await page.evaluate(() => window.probe.flow.editor.code);
  const flowAfterEdgeExpected = flowEdgeExpected.replace("  A -->|changed relation| B\n", "");
  mark(
    "flow-delete-only-selected-duplicate-relation",
    flowAfterEdgeDelete === flowAfterEdgeExpected,
    {
      selected: edgeSelection.flow,
      before: flowExpectedRename,
      expected: flowAfterEdgeExpected,
      after: flowAfterEdgeDelete,
    },
  );
  await select('#flow g.node[data-mw-entity="node:B"]');
  const flowDeleteButton = page
    .getByRole("navigation", { name: "flow probe controls", exact: true })
    .getByRole("button", { name: "delete selected node" });
  const flowDeleteDisabled = await flowDeleteButton.isDisabled();
  const flowDeleteReason = await page
    .getByRole("navigation", { name: "flow probe controls", exact: true })
    .locator("output[data-reason-for='delete selected node']")
    .textContent();
  const flowBeforeBlockedDelete = await page.evaluate(() => window.probe.flow.editor.code);
  mark(
    "flow-referenced-node-delete-disabled-with-reason",
    flowDeleteDisabled &&
      flowDeleteReason === "Delete connected edges first" &&
      flowBeforeBlockedDelete === flowAfterEdgeExpected,
    {
      reason: flowDeleteReason,
      disabled: flowDeleteDisabled,
      unchanged: flowBeforeBlockedDelete === flowAfterEdgeExpected,
    },
  );
  const remainingEdgeSelection = await select('#flow path[data-mw-entity^="edge:"]');
  await clickControl("flow", "delete selected edge");
  const flowAfterLastEdge = await page.evaluate(() => ({
    code: window.probe.flow.editor.code,
    edges: window.probe.flow.editor.result.flowchart.edges.map((edge) => edge.entityId),
    selected: window.probe.flow.editor.selection,
  }));
  mark(
    "flow-last-edge-delete-preserves-unconnected-node",
    flowAfterLastEdge.edges.length === 0 && flowAfterLastEdge.code.includes("B[Changed]"),
    { ...flowAfterLastEdge, selectedBefore: remainingEdgeSelection.flow },
  );
  await select('#flow g.node[data-mw-entity="node:B"]');
  const nodeDeleteEnabled = await flowDeleteButton.isEnabled();
  if (nodeDeleteEnabled) await clickControl("flow", "delete selected node");
  const flowAfterSafeDelete = await page.evaluate(() => window.probe.flow.editor.code);
  const flowSafeDeleteExpected = flowAfterLastEdge.code.replace("  B[Changed]\n", "");
  mark(
    "flow-delete-node-after-relation",
    nodeDeleteEnabled && flowAfterSafeDelete === flowSafeDeleteExpected,
    {
      enabled: nodeDeleteEnabled,
      expected: flowSafeDeleteExpected,
      after: flowAfterSafeDelete,
    },
  );

  // Exact duplicate messages must stay addressable by source occurrence, and no-alias rename must update references.
  const seqBefore = await page.evaluate(() => window.probe.seq.editor.code);
  const seqEvents = await page.evaluate(() =>
    window.probe.seq.editor.result.sequence.events.map((event) => ({
      id: event.entityId,
      kind: event.kind,
    })),
  );
  const duplicateMessageIds = seqEvents
    .filter(({ kind }) => kind === "message")
    .slice(0, 2)
    .map(({ id }) => id);
  const seqSelection = await select(`#seq [data-mw-entity="${duplicateMessageIds[1]}"]`);
  await clickControl("seq", "rename selected message");
  const seqAfterMessage = await page.evaluate(() => window.probe.seq.editor.code);
  const seqExpectedMessage = seqBefore.replace(
    "  Alice->>Bob: identical\n  Alice->>Bob: identical\n",
    "  Alice->>Bob: identical\n  Alice->>Bob: changed\n",
  );
  mark("sequence-exact-duplicate-message-patch", seqAfterMessage === seqExpectedMessage, {
    ids: duplicateMessageIds,
    selected: seqSelection.seq,
    expected: seqExpectedMessage,
    after: seqAfterMessage,
  });
  await select('#seq [data-mw-entity="participant:Alice"]');
  await clickControl("seq", "rename selected participant");
  const seqAfterRename = await page.evaluate(() => window.probe.seq.editor.code);
  const seqExpectedRename = seqExpectedMessage.replaceAll("Alice", "Renamed");
  mark(
    "sequence-unaliased-participant-rename-updates-references",
    seqAfterRename === seqExpectedRename,
    {
      selected: await page.evaluate(() => window.probe.seq.editor.selection),
      before: seqExpectedMessage,
      expected: seqExpectedRename,
      after: seqAfterRename,
    },
  );
  await select('#seq [data-mw-entity="participant:Bob"]');
  const seqDeleteButton = page
    .getByRole("navigation", { name: "seq probe controls", exact: true })
    .getByRole("button", { name: "delete selected participant" });
  const seqDeleteDisabled = await seqDeleteButton.isDisabled();
  const seqGuard = await page
    .getByRole("navigation", { name: "seq probe controls", exact: true })
    .locator("output[data-reason-for='delete selected participant']")
    .textContent();
  const seqAfterBlockedDelete = await page.evaluate(() => window.probe.seq.editor.code);
  mark(
    "sequence-referenced-participant-delete-disabled-with-reason",
    seqGuard === "Delete messages first" &&
      seqDeleteDisabled &&
      seqAfterBlockedDelete === seqExpectedRename,
    {
      reason: seqGuard,
      disabled: seqDeleteDisabled,
      selected: await page.evaluate(() => window.probe.seq.editor.selection),
      unchanged: seqAfterBlockedDelete === seqExpectedRename,
    },
  );
  // A no-alias rename to another participant's ID must be rejected at the UI boundary.
  await select('#seq [data-mw-entity="participant:Renamed"]');
  const collisionButton = page
    .getByRole("navigation", { name: "seq probe controls", exact: true })
    .getByRole("button", { name: "rename selected participant to existing ID" });
  const collisionDisabled = await collisionButton.isDisabled();
  const collisionReason = await page
    .getByRole("navigation", { name: "seq probe controls", exact: true })
    .locator("output[data-reason-for='rename selected participant to existing ID']")
    .textContent();
  const collisionCode = await page.evaluate(() => window.probe.seq.editor.code);
  mark(
    "sequence-noalias-rename-id-collision-rejected",
    collisionDisabled &&
      collisionReason === "That ID already belongs to another participant" &&
      collisionCode === seqExpectedRename,
    {
      disabled: collisionDisabled,
      reason: collisionReason,
      unchanged: collisionCode === seqExpectedRename,
      code: collisionCode,
    },
  );

  let deletedMessages = 0;
  let messagesBeforeDelete = await page.evaluate(
    () =>
      window.probe.seq.editor.result.sequence.events.filter((event) => event.kind === "message")
        .length,
  );
  while (messagesBeforeDelete > 0 && deletedMessages < 3) {
    const eventId = await page.evaluate(
      () =>
        window.probe.seq.editor.result.sequence.events.findLast((event) => event.kind === "message")
          .entityId,
    );
    await select(`#seq text[data-mw-entity="${eventId}"]`);
    await clickControl("seq", "delete selected message");
    await page.waitForTimeout(500);
    const messagesAfterDelete = await page.evaluate(
      () =>
        window.probe.seq.editor.result.sequence.events.filter((event) => event.kind === "message")
          .length,
    );
    if (messagesAfterDelete === messagesBeforeDelete) break;
    deletedMessages++;
    messagesBeforeDelete = messagesAfterDelete;
  }
  await select('#seq [data-mw-entity="participant:Bob"]');
  const unreferencedDeleteEnabled = await seqDeleteButton.isEnabled();
  if (unreferencedDeleteEnabled) await clickControl("seq", "delete selected participant");
  const seqAfterSafeDelete = await page.evaluate(() => window.probe.seq.editor.code);
  const seqAfterMessageDeleteExpected = seqExpectedRename.replace(
    "  Renamed->>Bob: identical\n  Renamed->>Bob: changed\n  Bob-->>Renamed: reply\n",
    "",
  );
  const seqSafeDeleteExpected = seqAfterMessageDeleteExpected.replace("  participant Bob\n", "");
  mark(
    "sequence-delete-messages-before-unreferenced-participant",
    deletedMessages === 3 &&
      unreferencedDeleteEnabled &&
      seqAfterSafeDelete === seqSafeDeleteExpected,
    {
      deletedMessages,
      enabled: unreferencedDeleteEnabled,
      expected: seqSafeDeleteExpected,
      after: seqAfterSafeDelete,
    },
  );
  const aliasBefore = await page.evaluate(() => window.probe.duplicateAlias.editor.code);
  const aliasSelection = await select('#duplicate-alias [data-mw-entity="participant:A"]');
  await clickControl("duplicate-alias", "rename selected duplicate-alias participant");
  const aliasAfter = await page.evaluate(() => window.probe.duplicateAlias.editor.code);
  const aliasExpected = aliasBefore.replace("participant A as Same", "participant A as Unique");
  mark(
    "sequence-duplicate-alias-selected-id-patch",
    aliasSelection.duplicateAlias.includes("participant:A") && aliasAfter === aliasExpected,
    {
      selected: aliasSelection.duplicateAlias,
      before: aliasBefore,
      expected: aliasExpected,
      after: aliasAfter,
    },
  );

  const parseChecks = await page.evaluate(async () => ({
    flow: await window.probe.mermaid.parse(window.probe.flow.editor.code),
    sequence: await window.probe.mermaid.parse(window.probe.seq.editor.code),
  }));
  mark(
    "patched-existing-diagrams-still-parse",
    Boolean(parseChecks.flow && parseChecks.sequence),
    parseChecks,
  );
  const capabilityCases = await page.evaluate(async () => {
    const fixtures = [
      {
        id: "duplicate-primary-declarations",
        source: "flowchart TD\n A[First]\n A[Second]",
        op: { type: "renameNode", id: "A", label: "Changed" },
      },
      {
        id: "subgraph",
        source: "flowchart TD\nsubgraph Group\n A-->B\nend",
        op: { type: "renameNode", id: "A", label: "Changed" },
      },
      {
        id: "sequence-loop",
        source:
          "sequenceDiagram\n participant A\n participant B\n loop retry\n A->>B: request\n end",
        op: { type: "seq.setEventText", eventId: "event:4", text: "Changed" },
      },
      {
        id: "invalid-source",
        source: "flowchart TD\n A[",
        op: { type: "renameNode", id: "A", label: "Changed" },
      },
      {
        id: "other-diagram",
        source: "classDiagram\n A <|-- B",
        op: { type: "renameNode", id: "A", label: "Changed" },
      },
    ];
    const outcomes = [];
    for (const fixture of fixtures) {
      const editor = new window.probe.MermaidWysiwygEditor({ code: fixture.source });
      let parseError = false;
      try {
        await window.probe.mermaid.parse(fixture.source);
      } catch {
        parseError = true;
      }
      const reason = window.probe.mutationBlockReason(editor, parseError);
      const result = reason ? null : editor.dispatch(fixture.op);
      outcomes.push({
        id: fixture.id,
        reason,
        unchanged: editor.code === fixture.source,
        dispatched: result !== null,
        nodeRefs:
          fixture.id === "duplicate-primary-declarations"
            ? editor.result.flowchart.nodes.map((node) => ({
                id: node.id,
                labels: node.refs.map((ref) => ref.ref.labelSpan ?? null),
              }))
            : undefined,
      });
    }
    const noOpSource = "flowchart TD\n A[Same]";
    const noOpEditor = new window.probe.MermaidWysiwygEditor({ code: noOpSource });
    let changeEvents = 0;
    noOpEditor.on("change", () => {
      changeEvents++;
    });
    noOpEditor.dispatch({ type: "renameNode", id: "A", label: "Same" });
    outcomes.push({
      id: "same-label-noop",
      reason: null,
      unchanged: noOpEditor.code === noOpSource,
      changeEvents,
    });
    return outcomes;
  });
  mark(
    "unsafe-and-unsupported-source-falls-back-with-zero-writes",
    capabilityCases
      .filter((testCase) => testCase.id !== "same-label-noop")
      .every((testCase) => Boolean(testCase.reason) && testCase.unchanged && !testCase.dispatched),
    capabilityCases,
  );
  const repeatedPrimary = capabilityCases.find(
    (testCase) => testCase.id === "duplicate-primary-declarations",
  );
  mark(
    "flow-repeated-primary-declaration-explicit-fallback",
    repeatedPrimary.reason === "Repeated primary declarations are ambiguous; use source editing" &&
      repeatedPrimary.unchanged &&
      !repeatedPrimary.dispatched,
    repeatedPrimary,
  );
  const noOp = capabilityCases.find((testCase) => testCase.id === "same-label-noop");
  mark(
    "same-label-noop-does-not-create-source-change",
    noOp.unchanged && noOp.changeEvents === 0,
    noOp,
  );

  for (const [container, actions, expectedLines] of [
    ["empty-flow", ["add node A", "add node B"], ["flowchart TD", "A[开始]", "B[结束]", "A --> B"]],
    [
      "empty-seq",
      ["add participant Alice", "add participant Bob", "add request", "add return"],
      [
        "sequenceDiagram",
        "participant Alice",
        "participant Bob",
        "Alice->>Bob: request",
        "Bob-->>Alice: response",
      ],
    ],
  ]) {
    for (const action of actions) await clickControl(container, action);
    const target = container === "empty-flow" ? "emptyFlow" : "emptySeq";
    if (container === "empty-flow") {
      await page.waitForTimeout(400);
      await page.evaluate(() => window.probe.emptyFlow.view.setTool("connect"));
      const nodes = page.locator('#empty-flow g.node[data-mw-entity^="node:"]');
      await nodes.nth(0).dragTo(nodes.nth(1), { steps: 8 });
    }
    const code = await page.evaluate((key) => window.probe[key].editor.code, target);
    const parsed = await page.evaluate(
      (key) => window.probe.mermaid.parse(window.probe[key].editor.code).then(() => true),
      target,
    );
    const actualLines = code
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const exactLines = JSON.stringify(actualLines) === JSON.stringify(expectedLines);
    mark(`${container}-real-ui-creation-and-parse`, exactLines && parsed, {
      code,
      parsed,
      expectedLines,
      actualLines,
      exactLines,
    });
  }
  mark("browser-console-clean", errors.length === 0, errors);
  const report = {
    versions,
    browser: "Playwright Chromium headless",
    results,
    consoleErrors: errors,
  };
  await fs.writeFile(path.join(outputDir, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  await page.screenshot({ path: path.join(outputDir, "browser.png"), fullPage: true });
  for (const item of results) console.log(`${item.status} ${item.id}`);
  if (results.some((item) => item.status === "FAIL") || errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
