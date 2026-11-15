import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const resultsDir = path.join(root, "scratch/mermaid-visual-editing-p0/results");
await fs.mkdir(resultsDir, { recursive: true });
const require = createRequire(path.join(root, "apps/desktop/package.json"));
const viteEntry = require.resolve("vite");
const { createServer } = await import(viteEntry);
const { chromium } = require("@playwright/test");
const deps = path.join(root, "scratch/mermaid-visual-editing-p0/dependencies/node_modules");
// Resolve from the owning workspace instead of assuming a node_modules layout.
const syntaxRequire = createRequire(path.join(root, "packages/syntax-plugins/package.json"));
const mermaid = path.dirname(syntaxRequire.resolve("mermaid/package.json"));
const errors = [];
const results = [];
const mark = (id, status, detail) => results.push({ id, status, detail });
const manifest = (file) => JSON.parse(fsSync.readFileSync(file, "utf8"));
const versions = {
  core: manifest(path.join(deps, "@visimer/core/package.json")).version,
  dom: manifest(path.join(deps, "@visimer/dom/package.json")).version,
  mermaid: manifest(path.join(mermaid, "package.json")).version,
  playwright: manifest(require.resolve("@playwright/test/package.json")).version,
  vite: manifest(require.resolve("vite/package.json")).version,
};
const expectedVersions = {
  core: "1.1.3",
  dom: "1.1.3",
  mermaid: "11.17.2",
  playwright: "1.61.1",
  vite: "6.4.3",
};
for (const [name, expected] of Object.entries(expectedVersions)) {
  if (versions[name] !== expected)
    throw new Error(
      `${name} version mismatch: expected ${expected}, found ${versions[name]}. ` +
        "After a dependency upgrade, rerun the probes before updating expectedVersions and test assertions; " +
        "see docs/agent/status/mermaid-default-layout-editing.md#探针依赖维护。",
    );
}
let server;
let browser;
try {
  server = await createServer({
    root: path.join(root, "scripts/mermaid-p0"),
    // Concurrent probes have different aliases; their optimized deps must not mix.
    cacheDir: path.join(root, "scratch/mermaid-visual-editing-p0/vite-dom-cache"),
    configFile: false,
    server: { host: "127.0.0.1", port: 0 },
    resolve: {
      alias: [
        { find: "@visimer/core", replacement: path.join(deps, "@visimer/core/dist/index.js") },
        { find: "@visimer/dom", replacement: path.join(deps, "@visimer/dom/dist/index.js") },
        { find: "mermaid", replacement: path.join(mermaid, "dist/mermaid.core.mjs") },
      ],
    },
  });
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${address.port}/fixtures.html`);
  await page.waitForTimeout(2500);
  const initialized = await page.evaluate(() =>
    Boolean(window.probe?.editors?.flow && document.querySelector("#flow svg")),
  );
  if (!initialized) {
    mark("browser-app-initialization", "FAIL", {
      errors,
      body: await page.locator("body").innerText(),
      html: await page.locator("body").evaluate((e) => e.innerHTML.slice(0, 1200)),
    });
    await page.screenshot({
      path: path.join(root, "scratch/mermaid-visual-editing-p0/results/browser.png"),
      fullPage: true,
    });
  } else {
    const counts = await page.evaluate(() => ({
      flowNodes: new Set(
        [...document.querySelectorAll('#flow [data-mw-entity^="node:"]')].map((e) =>
          e.getAttribute("data-mw-entity"),
        ),
      ).size,
      flowEdges: new Set(
        [...document.querySelectorAll('#flow [data-mw-entity^="edge:"]')].map((e) =>
          e.getAttribute("data-mw-entity"),
        ),
      ).size,
      seqParticipants: new Set(
        [...document.querySelectorAll('#sequence [data-mw-entity^="participant:"]')].map((e) =>
          e.getAttribute("data-mw-entity"),
        ),
      ).size,
      seqEvents: new Set(
        [...document.querySelectorAll('#sequence [data-mw-entity^="event:"]')].map((e) =>
          e.getAttribute("data-mw-entity"),
        ),
      ).size,
    }));
    mark(
      "existing-flowchart-hit-correlation",
      counts.flowNodes === 3 && counts.flowEdges === 2 ? "PASS" : "FAIL",
      { expected: { nodeIds: 3, edgeIds: 2 }, actual: counts },
    );
    mark(
      "existing-sequence-hit-correlation",
      counts.seqEvents === 3 && counts.seqParticipants > 0 ? "PASS" : "FAIL",
      { expected: "3 event entities and participant entities are reachable", actual: counts },
    );
    mark("sequence-alias-entity-correlation", counts.seqParticipants === 2 ? "PASS" : "FAIL", {
      expected:
        "2 participant IDs for 2 declarations; messages reference the declared IDs, aliases are display labels",
      actual: counts.seqParticipants,
    });
    const flowBefore = await page.evaluate(() => window.probe.editors.flow.code);
    const node = page.locator('#flow [data-mw-entity^="node:"]').first();
    await node.dblclick();
    const editable = page.locator('#flow [contenteditable="true"]').first();
    if (await editable.count()) {
      await editable.fill("启动");
      await editable.press("Enter");
    }
    await page.waitForTimeout(350);
    const flowAfter = await page.evaluate(() => window.probe.editors.flow.code);
    const expectedFlowPatch = flowBefore.replace("A[开始]", "A[启动]");
    mark("flowchart-label-edit-source-patch", flowAfter === expectedFlowPatch ? "PASS" : "FAIL", {
      expected: expectedFlowPatch,
      before: flowBefore,
      after: flowAfter,
    });
    const flowEdgesBefore = await page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('#flow [data-mw-entity^="edge:"]')].map((e) =>
          e.getAttribute("data-mw-entity"),
        ),
      ),
    ]);
    await page.evaluate(() => window.probe.views.flow.setTool("connect"));
    const nodes = page.locator('#flow g.node[data-mw-entity^="node:"]');
    await nodes.nth(0).scrollIntoViewIfNeeded();
    await nodes.nth(0).dragTo(nodes.nth(2), { steps: 8 });
    await page.waitForTimeout(350);
    const flowConnected = await page.evaluate(() => window.probe.editors.flow.code);
    const flowEdgesAfter = await page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('#flow [data-mw-entity^="edge:"]')].map((e) =>
          e.getAttribute("data-mw-entity"),
        ),
      ),
    ]);
    const newFlowEdges = flowEdgesAfter.filter((id) => !flowEdgesBefore.includes(id));
    const hasExactConnection = /(?:^|\n)\s*A --> C\s*(?:\n|$)/.test(flowConnected);
    mark(
      "flowchart-real-mouse-drag-connect",
      hasExactConnection && newFlowEdges.length === 1 && newFlowEdges[0].startsWith("edge:A->C#")
        ? "PASS"
        : "FAIL",
      {
        expected: "exact source line A --> C and exactly one new A->C edge entity",
        before: flowAfter,
        after: flowConnected,
        beforeEdgeIds: flowEdgesBefore,
        afterEdgeIds: flowEdgesAfter,
        newEdgeIds: newFlowEdges,
        toolClass: await page.locator("#flow").getAttribute("class"),
        sourceEntity: await nodes.nth(0).getAttribute("data-mw-entity"),
        targetEntity: await nodes.nth(2).getAttribute("data-mw-entity"),
        drag: "Playwright Locator.dragTo with 8 interpolated mouse steps",
      },
    );
    const seqBefore = await page.evaluate(() => window.probe.editors.sequence.code);
    await page.locator('#sequence [data-mw-entity^="event:"]').first().dblclick();
    const seqEdit = page.locator('#sequence [contenteditable="true"]').first();
    if (await seqEdit.count()) {
      await seqEdit.fill("修改文字");
      await seqEdit.press("Enter");
    }
    await page.waitForTimeout(350);
    const seqAfter = await page.evaluate(() => window.probe.editors.sequence.code);
    const expectedSequencePatch = seqBefore.replace(
      "客户端->>服务端: 查询",
      "客户端->>服务端: 修改文字",
    );
    mark("sequence-label-edit-source-patch", seqAfter === expectedSequencePatch ? "PASS" : "FAIL", {
      expected: expectedSequencePatch,
      before: seqBefore,
      after: seqAfter,
    });
    const coreSrc = path.join(deps, "@visimer/core/src");
    const layoutEvidence = {
      flowchartOperations: {
        file: "src/flowchart/ops.ts",
        source: await fs
          .readFile(path.join(coreSrc, "flowchart/ops.ts"), "utf8")
          .then((s) =>
            s.slice(
              s.indexOf("export type FlowchartOp ="),
              s.indexOf("\n\nexport interface OpResult"),
            ),
          ),
      },
      sequenceOperations: {
        file: "src/sequence/ops.ts",
        source: await fs
          .readFile(path.join(coreSrc, "sequence/ops.ts"), "utf8")
          .then((s) =>
            s.slice(
              s.indexOf("export type SequenceOp ="),
              s.indexOf("\n\nexport interface SeqOpContext"),
            ),
          ),
      },
      sequenceMoveImplementation: {
        file: "src/sequence/ops.ts",
        source: await fs
          .readFile(path.join(coreSrc, "sequence/ops.ts"), "utf8")
          .then((s) =>
            s.slice(s.indexOf("case 'seq.moveEvent':"), s.indexOf("case 'seq.wrapInFragment':")),
          ),
      },
      domSequenceDrag: {
        file: "@visimer/dom/src/view.ts",
        source: await fs
          .readFile(path.join(deps, "@visimer/dom/src/view.ts"), "utf8")
          .then((s) =>
            s.slice(
              s.indexOf("  private onSvgPointerDown("),
              s.indexOf("  private entityElement("),
            ),
          ),
      },
    };
    await fs.writeFile(
      path.join(resultsDir, "layout-api-evidence.json"),
      JSON.stringify(layoutEvidence, null, 2) + "\n",
    );
    mark("manual-display-layout-api", "UNSUPPORTED", {
      conclusion:
        "The real exported flowchart/sequence operation unions contain no display-coordinate/layout operation; seq.moveEvent edits source statement order.",
      evidence: "layout-api-evidence.json",
    });
    const emptySource = await page.evaluate(() => ({
      flow: window.probeEmpty.flow.code,
      sequence: window.probeEmpty.sequence.code,
    }));
    mark(
      "empty-diagram-source-operations",
      /A\[开始\]/.test(emptySource.flow) &&
        /A -->\|继续\| B/.test(emptySource.flow) &&
        emptySource.sequence.includes("用户->>API: 请求")
        ? "PASS"
        : "FAIL",
      {
        method: "real core package dispatched against blank Mermaid source; source-level only",
        actual: emptySource,
      },
    );
    mark(
      "empty-diagram-creation-gesture",
      "NOT RUN",
      "The mounted @visimer/dom view exposes no blank-canvas create-node affordance; its drag connector requires existing node entities. No gesture claimed.",
    );
    mark(
      "sequence-real-mouse-message-creation",
      "NOT RUN",
      "The blank sequence view has no participant lifelines for the DOM plus controls. Core addMessage dispatch is source-only and not treated as gesture evidence.",
    );
    mark(
      "flowchart-layout-preserves-edges",
      "NOT RUN",
      "No layout operation is available to exercise; no SVG transforms were applied.",
    );
    mark(
      "sequence-layout-preserves-message-order",
      "NOT RUN",
      "No independent visual-layout operation exists in the fixed API.",
    );
    mark(
      "ordinary-rerender-theme-save-reopen-reset-undo",
      "NOT RUN",
      "Outside the minimal source-edit/connection probe.",
    );
    await page.screenshot({
      path: path.join(root, "scratch/mermaid-visual-editing-p0/results/browser.png"),
      fullPage: true,
    });
    mark("browser-console-clean", errors.length === 0 ? "PASS" : "FAIL", errors);
  }
} finally {
  await browser?.close();
  await server?.close();
}
await fs.writeFile(
  path.join(resultsDir, "results.json"),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      versions,
      browser: "Chromium headless via @playwright/test",
      results,
      consoleErrors: errors,
    },
    null,
    2,
  ) + "\n",
);
console.log(results.map((r) => `${r.status} ${r.id}`).join("\n"));
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
