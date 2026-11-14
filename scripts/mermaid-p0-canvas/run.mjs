import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "scratch/mermaid-visual-editing-p0/canvas-results");
await fs.mkdir(out, { recursive: true });
const require = createRequire(path.join(root, "apps/desktop/package.json"));
const { createServer } = await import(require.resolve("vite"));
const { chromium } = require("@playwright/test");
const deps = path.join(root, "scratch/mermaid-visual-editing-p0/dependencies/node_modules");
const mermaidRoot = path.join(root, "packages/syntax-plugins/node_modules/mermaid");
const reactRoot = createRequire(path.join(root, "apps/desktop/package.json")).resolve(
  "react/package.json",
);
const reactDomRoot = createRequire(path.join(root, "apps/desktop/package.json")).resolve(
  "react-dom/package.json",
);
const errors = [];
const results = [];
const mark = (id, pass, detail) => results.push({ id, status: pass ? "PASS" : "FAIL", detail });
const record = (id, status, detail) => results.push({ id, status, detail });
const packageJson = (name) =>
  JSON.parse(require("node:fs").readFileSync(path.join(deps, name, "package.json"), "utf8"));
const versions = {
  core: packageJson("@visimer/core").version,
  xyflow: packageJson("@xyflow/react").version,
  dagre: packageJson("@dagrejs/dagre").version,
  mermaid: JSON.parse(
    require("node:fs").readFileSync(path.join(mermaidRoot, "package.json"), "utf8"),
  ).version,
};
for (const [name, expected] of Object.entries({
  core: "1.1.3",
  xyflow: "12.12.1",
  dagre: "3.1.3",
  mermaid: "11.17.2",
}))
  if (versions[name] !== expected)
    throw new Error(`${name} version mismatch: expected ${expected}, got ${versions[name]}`);
// Match each SVG path to the exact core entity and handle ID. A union CSS
// selector is ordered by DOM, not by source/target role (duplicate messages matter).
async function edgeGeometry(page) {
  return page.evaluate(() => {
    const result = window.__mermaidP0.editor.result;
    const models = result.flowchart
      ? result.flowchart.edges.map((edge) => ({
          id: edge.entityId,
          source: edge.source,
          target: edge.target,
        }))
      : result.sequence.events
          .filter((event) => event.kind === "message")
          .map((event, index) => ({
            id: event.entityId,
            source: event.stmt.source,
            target: event.stmt.target,
            sourceHandle: `source-${index}`,
            targetHandle: `target-${index}`,
          }));
    return models.map((model) => {
      const edgeElement = [...document.querySelectorAll(".react-flow__edge")].find(
        (element) => element.dataset.id === model.id,
      );
      const svgPath = edgeElement?.querySelector(".react-flow__edge-path");
      if (!svgPath) throw new Error(`Missing SVG edge for ${model.id}`);
      const matrix = svgPath.getScreenCTM();
      const start = svgPath.getPointAtLength(0).matrixTransform(matrix);
      const end = svgPath.getPointAtLength(svgPath.getTotalLength()).matrixTransform(matrix);
      const centers = ["source", "target"].map((role) => {
        const node = [...document.querySelectorAll(".react-flow__node")].find(
          (element) => element.dataset.id === model[role],
        );
        const handle = [...node.querySelectorAll(`.react-flow__handle.${role}`)].find(
          (element) =>
            !model[`${role}Handle`] || element.dataset.handleid === model[`${role}Handle`],
        );
        if (!handle) throw new Error(`Missing ${role} handle for ${model.id}`);
        const box = handle.getBoundingClientRect();
        const inputBox = result.sequence
          ? node.querySelector("input").getBoundingClientRect()
          : null;
        const lifelineBox = result.sequence
          ? node.querySelector(".lifeline").getBoundingClientRect()
          : null;
        return {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          headerBottom: inputBox?.bottom,
          lifelineX: lifelineBox ? lifelineBox.x + lifelineBox.width / 2 : undefined,
        };
      });
      return {
        id: model.id,
        source: model.source,
        target: model.target,
        sourceDistance: Math.hypot(start.x - centers[0].x, start.y - centers[0].y),
        targetDistance: Math.hypot(end.x - centers[1].x, end.y - centers[1].y),
        outsideParticipantHeaders: centers.every(
          (center) => center.headerBottom === undefined || center.y > center.headerBottom + 1,
        ),
        onLifelines: centers.every(
          (center) => center.lifelineX === undefined || Math.abs(center.x - center.lifelineX) < 3,
        ),
        marker: svgPath.getAttribute("marker-end"),
        path: svgPath.getAttribute("d"),
      };
    });
  });
}
let server;
let browser;
try {
  server = await createServer({
    root: path.join(root, "scripts/mermaid-p0-canvas"),
    cacheDir: path.join(root, "scratch/mermaid-visual-editing-p0/vite-canvas-cache"),
    configFile: false,
    server: { host: "127.0.0.1", port: 0 },
    resolve: {
      alias: [
        { find: "@visimer/core", replacement: path.join(deps, "@visimer/core/dist/index.js") },
        {
          find: "@xyflow/react/dist/style.css",
          replacement: path.join(deps, "@xyflow/react/dist/style.css"),
        },
        { find: "@xyflow/react", replacement: path.join(deps, "@xyflow/react/dist/esm/index.js") },
        {
          find: "@dagrejs/dagre",
          replacement: path.join(deps, "@dagrejs/dagre/dist/dagre.esm.js"),
        },
        { find: "mermaid", replacement: path.join(mermaidRoot, "dist/mermaid.core.mjs") },
        {
          find: "react-dom/client",
          replacement: path.join(path.dirname(reactDomRoot), "client.js"),
        },
        { find: "react-dom", replacement: path.dirname(reactDomRoot) },
        { find: "react", replacement: path.dirname(reactRoot) },
      ],
    },
  });
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(1500);
  if (!(await page.locator('.react-flow__node[data-id="A"]').count()))
    throw new Error(
      `Prototype failed to mount: ${JSON.stringify({ errors, body: await page.locator("body").innerText() })}`,
    );
  const orig = await page.locator("[data-testid=source]").inputValue();
  mark(
    "existing-flow-and-source-loaded",
    orig.includes("%% 保留注释") &&
      orig.includes("classDef custom") &&
      (await page.locator(".react-flow__node").count()) === 3,
    { source: orig },
  );
  await page.getByTestId("add").click();
  await page.waitForTimeout(100);
  const afterAdd = await page.locator("[data-testid=source]").inputValue();
  await page.evaluate(() => window.__mermaidP0.editor.undo());
  await page.waitForTimeout(100);
  const afterUndo = await page.locator("[data-testid=source]").inputValue();
  mark("single-semantic-add-undo-restores-source", afterAdd !== orig && afterUndo === orig, {
    before: orig,
    afterAdd,
    afterUndo,
  });
  await page.evaluate(() =>
    window.__mermaidP0.editor.dispatch({ type: "renameNode", id: "A", label: "开始" }),
  );
  mark(
    "no-op-semantic-operation-preserves-source",
    (await page.locator("[data-testid=source]").inputValue()) === orig,
    await page.locator("[data-testid=source]").inputValue(),
  );
  const a = page.locator('.react-flow__node[data-id="A"]');
  const before = await a.boundingBox();
  const flowPathBefore = await page.locator(".react-flow__edge path").first().getAttribute("d");
  await a.dragTo(a, { targetPosition: { x: 110, y: 50 }, steps: 8 });
  await page.waitForTimeout(250);
  const afterDrag = await a.boundingBox();
  const flowPathAfterDrag = await page.locator(".react-flow__edge path").first().getAttribute("d");
  const flowAttachment = (await edgeGeometry(page))[0];
  mark(
    "flowchart-node-manual-drag-and-edge-attachment",
    Boolean(
      before &&
      afterDrag &&
      Math.abs(before.x - afterDrag.x) > 20 &&
      flowPathBefore !== flowPathAfterDrag &&
      flowAttachment.sourceDistance < 12 &&
      flowAttachment.targetDistance < 12 &&
      flowAttachment.marker,
    ),
    {
      before,
      after: afterDrag,
      sourceToHandleAndTargetToHandlePx: flowAttachment,
      pathBefore: flowPathBefore,
      pathAfter: flowPathAfterDrag,
    },
  );
  const layoutBefore = JSON.parse(await page.locator("[data-testid=summary]").innerText()).layout;
  await a.locator("input").fill("启动");
  await page.waitForTimeout(200);
  const srcAfterLabel = await page.locator("[data-testid=source]").inputValue();
  const layoutAfterLabel = JSON.parse(
    await page.locator("[data-testid=summary]").innerText(),
  ).layout;
  mark(
    "flowchart-label-source-fidelity-and-position",
    srcAfterLabel === orig.replace("A[开始]", "A[启动]") &&
      JSON.stringify(layoutBefore.A) === JSON.stringify(layoutAfterLabel.A),
    { source: srcAfterLabel, before: layoutBefore.A, after: layoutAfterLabel.A },
  );
  await page.getByTestId("theme").click();
  await page.waitForTimeout(150);
  const layoutTheme = JSON.parse(await page.locator("[data-testid=summary]").innerText()).layout;
  mark(
    "flowchart-theme-rerender-position",
    JSON.stringify(layoutAfterLabel.A) === JSON.stringify(layoutTheme.A),
    layoutTheme.A,
  );
  await page.getByTestId("save").click();
  await page.reload();
  await page.waitForTimeout(500);
  const savedFlowPayload = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mermaid-p0:flow")),
  );
  const reopenedSrc = await page.locator("[data-testid=source]").inputValue();
  const reopenedLayout = JSON.parse(await page.locator("[data-testid=summary]").innerText()).layout;
  mark(
    "flowchart-save-reopen-source-layout",
    reopenedSrc.includes("启动") &&
      JSON.stringify(layoutTheme.A) === JSON.stringify(reopenedLayout.A),
    { source: reopenedSrc, layout: reopenedLayout.A, savedPayload: savedFlowPayload },
  );
  const beforeResetSource = reopenedSrc;
  const reopenedBox = await page.locator('.react-flow__node[data-id="A"]').boundingBox();
  await page.getByTestId("reset").click();
  await page.waitForTimeout(200);
  const resetSource = await page.locator("[data-testid=source]").inputValue();
  const resetLayout = JSON.parse(await page.locator("[data-testid=summary]").innerText()).layout;
  const resetBox = await page.locator('.react-flow__node[data-id="A"]').boundingBox();
  mark(
    "flowchart-reset-layout-keeps-source",
    resetSource === beforeResetSource &&
      JSON.stringify(resetLayout.A) !== JSON.stringify(reopenedLayout.A) &&
      JSON.stringify(resetBox) !== JSON.stringify(reopenedBox),
    {
      sameSource: resetSource === beforeResetSource,
      before: reopenedLayout.A,
      after: resetLayout.A,
      resetBox,
      reopenedBox,
    },
  );
  await page.screenshot({ path: path.join(out, "flowchart.png"), fullPage: true });
  await page.getByTestId("blank").click();
  await page.getByTestId("add").click();
  await page.getByTestId("add").click();
  await page.waitForTimeout(300);
  const emptyFlowCount = await page.locator(".react-flow__node").count();
  const flowIds = await page
    .locator(".react-flow__node")
    .evaluateAll((es) => es.map((e) => e.getAttribute("data-id")));
  const flowHandles = page
    .locator(`.react-flow__node[data-id="${flowIds[0]}"] .react-flow__handle.source`)
    .first();
  const flowTarget = page
    .locator(`.react-flow__node[data-id="${flowIds[1]}"] .react-flow__handle.target`)
    .first();
  await flowHandles.dragTo(flowTarget, { steps: 10 });
  await page.waitForTimeout(350);
  const firstFlowCode = await page.locator("[data-testid=source]").inputValue();
  const blankFlowNode = page.locator(".react-flow__node").first();
  await blankFlowNode.dragTo(blankFlowNode, { targetPosition: { x: 110, y: 50 }, steps: 8 });
  await page.waitForTimeout(150);
  const positionsBeforeThird = JSON.parse(
    await page.locator("[data-testid=summary]").innerText(),
  ).layout;
  await page.getByTestId("add").click();
  await page.waitForTimeout(150);
  const flowIdsFinal = await page
    .locator(".react-flow__node")
    .evaluateAll((es) => es.map((e) => e.getAttribute("data-id")));
  await page
    .locator(`.react-flow__node[data-id="${flowIdsFinal[1]}"] .react-flow__handle.source`)
    .first()
    .dragTo(
      page
        .locator(`.react-flow__node[data-id="${flowIdsFinal[2]}"] .react-flow__handle.target`)
        .first(),
      { steps: 10 },
    );
  await page.waitForTimeout(300);
  const flowCode = await page.locator("[data-testid=source]").inputValue();
  const positionsAfterThird = JSON.parse(
    await page.locator("[data-testid=summary]").innerText(),
  ).layout;
  mark(
    "empty-flow-graphical-create-three-nodes-two-edges",
    emptyFlowCount === 2 &&
      flowIdsFinal.length === 3 &&
      firstFlowCode.includes("-->") &&
      flowCode.includes(`${flowIdsFinal[1]} --> ${flowIdsFinal[2]}`),
    { firstFlowCode, flowIdsFinal, source: flowCode },
  );
  mark(
    "flow-add-node-preserves-existing-manual-positions",
    Boolean(positionsBeforeThird[flowIds[0]]) &&
      JSON.stringify(positionsBeforeThird[flowIds[0]]) ===
        JSON.stringify(positionsAfterThird[flowIds[0]]) &&
      JSON.stringify(positionsBeforeThird[flowIds[1]]) ===
        JSON.stringify(positionsAfterThird[flowIds[1]]),
    { positionsBeforeThird, positionsAfterThird },
  );
  await page.getByRole("button", { name: "Sequence" }).click();
  await page.waitForTimeout(250);
  const sequenceCode = await page.locator("[data-testid=source]").inputValue();
  mark(
    "existing-sequence-and-aliases-loaded",
    sequenceCode.includes("客户端 as 用户") &&
      (await page.locator(".react-flow__node").count()) === 2,
    sequenceCode,
  );
  const sequenceNodes = page.locator(".react-flow__node");
  const seqDrag = page.locator(".participant-drag-area").first();
  const seqPos = await sequenceNodes.first().boundingBox();
  await seqDrag.dragTo(seqDrag, { targetPosition: { x: 110, y: 20 }, steps: 8 });
  await page.waitForTimeout(200);
  const seqPosAfter = await sequenceNodes.first().boundingBox();
  const seqPaths = await page
    .locator(".react-flow__edge path")
    .evaluateAll((paths) => paths.map((p) => p.getAttribute("d")));
  const seqAttachments = await edgeGeometry(page);
  const seqOrder = JSON.parse(await page.locator("[data-testid=summary]").innerText()).eventOrder;
  await sequenceNodes.first().locator("input").fill("用户甲");
  await page.waitForTimeout(200);
  const seqRename = await page.locator("[data-testid=source]").inputValue();
  mark(
    "sequence-horizontal-layout-and-alias-edit",
    Boolean(
      seqPos &&
      seqPosAfter &&
      Math.abs(seqPos.x - seqPosAfter.x) > 20 &&
      Math.abs(seqPos.y - seqPosAfter.y) < 2,
    ) &&
      new Set(seqPaths).size === 3 &&
      seqRename === sequenceCode.replace("as 用户", "as 用户甲"),
    {
      before: seqPos,
      after: seqPosAfter,
      distinctOrderedMessagePaths: new Set(seqPaths).size,
      source: seqRename,
    },
  );
  mark(
    "sequence-message-endpoints-align-with-lifelines",
    seqAttachments.length === 3 &&
      seqAttachments.every(
        (item) =>
          item.sourceDistance < 12 &&
          item.targetDistance < 12 &&
          item.marker &&
          item.outsideParticipantHeaders &&
          item.onLifelines,
      ),
    seqAttachments,
  );
  const edge = page.locator(".react-flow__edge").first();
  page.once("dialog", (dialog) => dialog.accept("修改消息"));
  await edge.dblclick({ force: true });
  await page.waitForTimeout(200);
  const seqEdit = await page.locator("[data-testid=source]").inputValue();
  const newOrder = JSON.parse(await page.locator("[data-testid=summary]").innerText()).eventOrder;
  mark(
    "sequence-specific-duplicate-message-edit-preserves-order",
    seqEdit === seqRename.replace("客户端->>服务端: 查询", "客户端->>服务端: 修改消息") &&
      JSON.stringify(seqOrder) === JSON.stringify(newOrder),
    { source: seqEdit, before: seqOrder, after: newOrder },
  );
  const sequenceView = async () =>
    page
      .locator(".react-flow__node")
      .evaluateAll((nodes) =>
        Object.fromEntries(nodes.map((node) => [node.dataset.id, node.style.transform])),
      );
  const seqLayoutBeforeReload = JSON.parse(await page.getByTestId("summary").innerText()).layout;
  const seqViewBeforeReload = await sequenceView();
  await page.getByTestId("save").click();
  const savedSequencePayload = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mermaid-p0:sequence")),
  );
  await page.reload();
  await page.waitForTimeout(500);
  const seqReloadSummary = JSON.parse(await page.getByTestId("summary").innerText());
  const seqReloadOrder = seqReloadSummary.eventOrder;
  mark(
    "sequence-reopen-source-order-and-manual-layout",
    JSON.stringify(seqReloadOrder) === JSON.stringify(newOrder) &&
      JSON.stringify(seqReloadSummary.layout) === JSON.stringify(seqLayoutBeforeReload) &&
      JSON.stringify(await sequenceView()) === JSON.stringify(seqViewBeforeReload) &&
      (await page.getByTestId("source").inputValue()) === seqEdit,
    {
      eventOrder: seqReloadOrder,
      layout: seqReloadSummary.layout,
      transforms: await sequenceView(),
      savedPayload: savedSequencePayload,
    },
  );
  await page.getByTestId("theme").click();
  const beforeNewParticipant = await sequenceView();
  await page.getByTestId("add").click();
  await page.waitForTimeout(200);
  const afterNewParticipant = await sequenceView();
  mark(
    "sequence-theme-and-participant-add-preserve-manual-layout",
    Object.entries(seqViewBeforeReload).every(
      ([id, transform]) =>
        beforeNewParticipant[id] === transform && afterNewParticipant[id] === transform,
    ) && Object.keys(afterNewParticipant).length === 3,
    { before: seqViewBeforeReload, theme: beforeNewParticipant, after: afterNewParticipant },
  );
  const sourceBeforeSeqReset = await page.getByTestId("source").inputValue();
  const beforeSeqReset = await sequenceView();
  await page.getByTestId("reset").click();
  await page.waitForTimeout(200);
  const afterSeqReset = await sequenceView();
  mark(
    "sequence-reset-visible-layout-preserves-source-order",
    (await page.getByTestId("source").inputValue()) === sourceBeforeSeqReset &&
      beforeSeqReset["客户端"] !== afterSeqReset["客户端"] &&
      (await edgeGeometry(page)).every(
        (item) => item.sourceDistance < 12 && item.targetDistance < 12,
      ),
    { before: beforeSeqReset, after: afterSeqReset, source: sourceBeforeSeqReset },
  );
  await page.screenshot({ path: path.join(out, "sequence-existing.png"), fullPage: true });
  await page.getByTestId("blank").click();
  await page.getByTestId("add").click();
  await page.getByTestId("add").click();
  await page.waitForTimeout(250);
  const seqNodesBlank = page.locator(".react-flow__node");
  const blankParticipantDrag = page.locator(".participant-drag-area").first();
  await blankParticipantDrag.dragTo(blankParticipantDrag, {
    targetPosition: { x: 110, y: 20 },
    steps: 8,
  });
  await page.waitForTimeout(150);
  const blankSeqPositions = JSON.parse(
    await page.locator("[data-testid=summary]").innerText(),
  ).layout;
  await seqNodesBlank
    .nth(0)
    .locator(".react-flow__handle.source")
    .last()
    .dragTo(seqNodesBlank.nth(1).locator(".react-flow__handle.target").last(), { steps: 10 });
  await page.waitForTimeout(250);
  await page.getByTestId("message-op").selectOption("-->>");
  await seqNodesBlank
    .nth(1)
    .locator(".react-flow__handle.source")
    .last()
    .dragTo(seqNodesBlank.nth(0).locator(".react-flow__handle.target").last(), { steps: 10 });
  await page.waitForTimeout(350);
  const blankSeqCode = await page.locator("[data-testid=source]").inputValue();
  const blankSeqFinalLayout = JSON.parse(
    await page.locator("[data-testid=summary]").innerText(),
  ).layout;
  mark(
    "empty-sequence-create-participants-and-request-return",
    (await seqNodesBlank.count()) === 2 &&
      /P1->>P2: 消息/.test(blankSeqCode) &&
      /P2-->>P1: 消息/.test(blankSeqCode) &&
      Object.keys(blankSeqPositions).length > 0 &&
      JSON.stringify(blankSeqPositions) === JSON.stringify(blankSeqFinalLayout),
    {
      source: blankSeqCode,
      layoutBeforeMessages: blankSeqPositions,
      layoutAfterMessages: blankSeqFinalLayout,
    },
  );
  const blankSeqPaths = await page
    .locator(".react-flow__edge-path")
    .evaluateAll((paths) => paths.map((p) => p.getAttribute("d")));
  const blankSeqEndpoints = await edgeGeometry(page);
  mark(
    "empty-sequence-renders-two-distinct-request-return-edges",
    blankSeqPaths.length === 2 &&
      new Set(blankSeqPaths).size === 2 &&
      blankSeqEndpoints.every((item) => item.marker),
    { paths: blankSeqPaths, endpoints: blankSeqEndpoints },
  );
  mark(
    "empty-sequence-request-return-lifeline-attachment",
    blankSeqEndpoints.every(
      (item) =>
        item.sourceDistance < 12 &&
        item.targetDistance < 12 &&
        item.outsideParticipantHeaders &&
        item.onLifelines,
    ),
    blankSeqEndpoints,
  );
  const generatedFlowValid = await page.evaluate(async (code) => {
    try {
      return Boolean(await window.__mermaidP0.mermaid.parse(code));
    } catch (error) {
      return String(error);
    }
  }, flowCode);
  const generatedSequenceValid = await page.evaluate(async (code) => {
    try {
      return Boolean(await window.__mermaidP0.mermaid.parse(code));
    } catch (error) {
      return String(error);
    }
  }, blankSeqCode);
  mark("generated-flow-valid-mermaid-11", generatedFlowValid === true, generatedFlowValid);
  mark(
    "generated-sequence-valid-mermaid-11",
    generatedSequenceValid === true,
    generatedSequenceValid,
  );
  await page.screenshot({ path: path.join(out, "sequence.png"), fullPage: true });
  const loopSource =
    "sequenceDiagram\n  participant A\n  participant B\n  loop retry\n    A->>B: original\n  end";
  await page.locator("[data-testid=source]").fill(loopSource);
  await page.waitForTimeout(200);
  mark(
    "sequence-loop-safe-source-fallback",
    (await page.getByTestId("unsupported").isVisible()) &&
      (await page.locator("[data-testid=source]").inputValue()) === loopSource &&
      (await page.locator(".canvas").count()) === 0,
    {
      fallback: await page.getByTestId("unsupported").innerText(),
      sourcePreserved: await page.locator("[data-testid=source]").inputValue(),
    },
  );
  await page.getByRole("button", { name: "Flowchart" }).click();
  await page.waitForTimeout(200);
  const subgraphSource = "flowchart TD\n  subgraph group[Group]\n    A[开始] --> B[结束]\n  end";
  await page.locator("[data-testid=source]").fill(subgraphSource);
  await page.waitForTimeout(200);
  mark(
    "flow-subgraph-safe-source-fallback",
    (await page.getByTestId("unsupported").isVisible()) &&
      (await page.locator("[data-testid=source]").inputValue()) === subgraphSource &&
      (await page.locator(".canvas").count()) === 0,
    {
      fallback: await page.getByTestId("unsupported").innerText(),
      sourcePreserved: await page.locator("[data-testid=source]").inputValue(),
    },
  );
  const invalidSource = "not-a-mermaid-header\nunchanged user text";
  await page.getByTestId("source").fill(invalidSource);
  await page.waitForTimeout(100);
  mark(
    "invalid-source-safe-fallback",
    (await page.getByTestId("source").inputValue()) === invalidSource &&
      (await page.getByTestId("unsupported").isVisible()) &&
      (await page.getByTestId("add").isDisabled()),
    { source: invalidSource },
  );
  await page.getByTestId("source").fill("");
  await page.getByTestId("save").click();
  await page.reload();
  await page.waitForTimeout(300);
  mark(
    "empty-source-survives-save-reload",
    (await page.getByTestId("source").inputValue()) === "" &&
      (await page.getByTestId("unsupported").isVisible()),
    "Empty source is preserved instead of replaced by the sample fixture.",
  );
  const malformed = "{invalid-json";
  await page.evaluate((raw) => localStorage.setItem("mermaid-p0:flow", raw), malformed);
  await page.reload();
  await page.waitForTimeout(300);
  mark(
    "malformed-storage-reported-and-preserved",
    (await page.getByRole("alert").filter({ hasText: "Saved layout ignored" }).isVisible()) &&
      (await page.evaluate(() => localStorage.getItem("mermaid-p0:flow"))) === malformed,
    "Raw malformed data remains stored and an error is visible; no automatic overwrite.",
  );
  record(
    "cancel-interaction",
    "NOT RUN",
    "The bounded prototype has no separate pending-edit/cancel interaction.",
  );
  record(
    "production-editor-transaction-integration",
    "NOT RUN",
    "Undo was checked against Visimer core API; this prototype is not integrated with the repository CM6 editor transaction/selection contract.",
  );
  mark("browser-console-clean", errors.length === 0, errors);
} catch (error) {
  mark(
    "probe-runtime",
    false,
    error instanceof Error ? error.stack || error.message : String(error),
  );
} finally {
  await browser?.close();
  await server?.close();
}
const data = {
  date: new Date().toISOString(),
  versions,
  browser: "Chromium headless via @playwright/test",
  results,
  consoleErrors: errors,
};
await fs.writeFile(path.join(out, "results.json"), JSON.stringify(data, null, 2) + "\n");
console.log(results.map((r) => `${r.status} ${r.id}`).join("\n"));
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
