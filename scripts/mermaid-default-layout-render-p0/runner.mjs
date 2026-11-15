import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const resultsDir = path.join(root, "scratch/mermaid-default-layout-render-p0/results");
await fs.mkdir(resultsDir, { recursive: true });
const require = createRequire(path.join(root, "apps/desktop/package.json"));
const { createServer } = await import(require.resolve("vite"));
const { chromium } = require("@playwright/test");
const deps = path.join(root, "scratch/mermaid-visual-editing-p0/dependencies/node_modules");
const mermaidPath = path.join(root, "packages/syntax-plugins/node_modules/mermaid");
const upstreamDomDir = path.join(deps, "@visimer/dom");
const patchedDomDir = path.join(
  root,
  "scratch/mermaid-default-layout-render-p0/patched-visimer-dom",
);
const version = (file) => JSON.parse(fsSync.readFileSync(file, "utf8")).version;
const versions = {
  core: version(path.join(deps, "@visimer/core/package.json")),
  dom: version(path.join(deps, "@visimer/dom/package.json")),
  mermaid: version(path.join(mermaidPath, "package.json")),
};
for (const [name, expected] of Object.entries({
  core: "1.1.3",
  dom: "1.1.3",
  mermaid: "11.17.2",
})) {
  if (versions[name] !== expected)
    throw new Error(`${name} expected ${expected}, found ${versions[name]}`);
}
const upstreamSource = await fs.readFile(path.join(upstreamDomDir, "dist/index.js"), "utf8");
const upstreamSha256 = createHash("sha256").update(upstreamSource).digest("hex");
const expectedUpstreamSha256 = "19e36af849b528373fca55f30675a6300d3596abe3f00719ff33ab150b637f9c";
if (upstreamSha256 !== expectedUpstreamSha256)
  throw new Error(`Visimer DOM tarball drift: ${upstreamSha256}`);
await fs.rm(patchedDomDir, { recursive: true, force: true });
await fs.cp(upstreamDomDir, patchedDomDir, { recursive: true });
const patchedEntry = path.join(patchedDomDir, "dist/index.js");
let patchedSource = upstreamSource;
const replacements = [
  [
    "      const { svg } = await this.mermaid.render(id, code);\n      if (seq !== this.renderSeq) return;",
    "      const { svg } = await this.mermaid.render(id, code);\n      if (this.destroyed || seq !== this.renderSeq) return;",
  ],
  [
    "      if (seq !== this.renderSeq) return;\n      document.getElementById(`d${id}`)?.remove();",
    "      if (this.destroyed || seq !== this.renderSeq) return;\n      document.getElementById(`d${id}`)?.remove();",
  ],
  [
    "  async validate() {\n    try {\n      await this.mermaid.parse(this.editor.code);\n      return true;\n    } catch (err) {\n      const message",
    "  async validate() {\n    if (this.destroyed) return false;\n    try {\n      await this.mermaid.parse(this.editor.code);\n      return !this.destroyed;\n    } catch (err) {\n      if (this.destroyed) return false;\n      const message",
  ],
];
for (const [before, after] of replacements) {
  const count = patchedSource.split(before).length - 1;
  if (count !== 1)
    throw new Error(
      `Expected one exact lifecycle patch anchor, found ${count}: ${before.slice(0, 80)}`,
    );
  patchedSource = patchedSource.replace(before, after);
}
const destroyAnchor = "  destroy() {\n    this.destroyed = true;";
if (patchedSource.split(destroyAnchor).length - 1 !== 1)
  throw new Error("destroy invalidation anchor is not unique");
patchedSource = patchedSource.replace(
  destroyAnchor,
  "  destroy() {\n    this.destroyed = true;\n    this.renderSeq++;",
);
await fs.writeFile(patchedEntry, patchedSource);
const patchedSha256 = createHash("sha256").update(patchedSource).digest("hex");
const patchArtifact = await fs.readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "visimer-dom-1.1.3-lifecycle.patch"),
  "utf8",
);
const actualPatch = spawnSync(
  "diff",
  [
    "-u",
    "--label",
    "a/dist/index.js",
    "--label",
    "b/dist/index.js",
    path.join(upstreamDomDir, "dist/index.js"),
    patchedEntry,
  ],
  { encoding: "utf8" },
);
if (actualPatch.status !== 1 || actualPatch.stdout !== patchArtifact)
  throw new Error("Lifecycle patch artifact does not match generated pinned scratch copy");
const results = [];
const mark = (id, status, detail) => results.push({ id, status, detail });
const expectedThemeFill = (kind, theme) => {
  if (kind === "sequence") return theme === "dark" ? "rgb(36, 54, 75)" : "rgb(248, 233, 176)";
  return theme === "dark" ? "rgb(31, 32, 32)" : "rgb(236, 236, 255)";
};
const themeMatchesExpected = (entry) =>
  (entry.kind === "sequence" ? entry.actorFill : entry.nodeFill) ===
  expectedThemeFill(entry.kind, entry.theme);
const errors = [];
let server;
let browser;
try {
  server = await createServer({
    root: path.dirname(fileURLToPath(import.meta.url)),
    cacheDir: path.join(root, "scratch/mermaid-default-layout-render-p0/vite-cache"),
    configFile: false,
    server: { host: "127.0.0.1", port: 0 },
    resolve: {
      alias: [
        { find: "@visimer/core", replacement: path.join(deps, "@visimer/core/dist/index.js") },
        { find: "@visimer/dom", replacement: path.join(deps, "@visimer/dom/dist/index.js") },
        { find: "@visimer/dom-patched", replacement: patchedEntry },
        { find: "mermaid", replacement: path.join(mermaidPath, "dist/mermaid.core.mjs") },
      ],
    },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/fixtures.html`);
  const initial = await page.evaluate(async () => {
    const states = await Promise.all([
      window.probe.open("flow-light", "flow", "light"),
      window.probe.open("sequence-dark", "sequence", "dark"),
      window.probe.open("flow-dark", "flow", "dark"),
      window.probe.open("sequence-light", "sequence", "light"),
    ]);
    return states.map((ok, index) => {
      const entry = [...window.probe.views.values()][index];
      const svg = entry.container.querySelector("svg");
      const themeTarget = entry.theme === "dark" ? "#24364b" : "#f8e9b0";
      return {
        ok,
        id: entry.container.id,
        kind: entry.kind,
        svg: Boolean(svg),
        background: svg?.style.backgroundColor ?? null,
        theme: entry.theme,
        themeTarget,
        nodeFill: svg?.querySelector(".node rect")
          ? getComputedStyle(svg.querySelector(".node rect")).fill
          : null,
        actorFill: svg?.querySelector(".actor")
          ? getComputedStyle(svg.querySelector(".actor")).fill
          : null,
      };
    });
  });
  const serialized = await page.evaluate(async () => {
    for (const id of window.probe.views.keys()) window.probe.close(id);
    const renderer = window.probe.createSerializedFacade();
    const completion = await Promise.all([
      window.probe.open("serialized-flow-light", "flow", "light", renderer),
      window.probe.open("serialized-sequence-dark", "sequence", "dark", renderer),
      window.probe.open("serialized-flow-dark", "flow", "dark", renderer),
      window.probe.open("serialized-sequence-light", "sequence", "light", renderer),
    ]);
    return [...window.probe.views.values()].map((entry, index) => ({
      ok: completion[index],
      theme: entry.theme,
      kind: entry.kind,
      nodeFill: entry.container.querySelector(".node rect")
        ? getComputedStyle(entry.container.querySelector(".node rect")).fill
        : null,
      actorFill: entry.container.querySelector(".actor")
        ? getComputedStyle(entry.container.querySelector(".actor")).fill
        : null,
      svg: Boolean(entry.container.querySelector("svg")),
    }));
  });
  const serializedThemePass = serialized.every(
    (entry) => entry.ok && entry.svg && themeMatchesExpected(entry),
  );
  // Feed the same assertion deliberately collapsed outputs, including the views
  // whose requested theme happens to match the collapsed result.
  const collapsedThemeChecks = ["light", "dark"].map((collapsedTo) => ({
    collapsedTo,
    incorrectlyAccepted: serialized
      .map((entry) => ({
        ...entry,
        nodeFill: expectedThemeFill(entry.kind, collapsedTo),
        actorFill: expectedThemeFill(entry.kind, collapsedTo),
      }))
      .every(themeMatchesExpected),
  }));
  mark(
    "theme-isolation-assertion-rejects-collapsed-theme",
    collapsedThemeChecks.every((check) => !check.incorrectlyAccepted) ? "PASS" : "FAIL",
    collapsedThemeChecks,
  );
  mark(
    "raw-concurrent-themes-match-serial-reference",
    serializedThemePass && initial.every((raw) => raw.ok && raw.svg && themeMatchesExpected(raw))
      ? "PASS"
      : "FAIL",
    { concurrent: initial, serializedReference: serialized },
  );
  mark(
    "serialized-facade-isolates-per-view-theme",
    serializedThemePass ? "PASS" : "FAIL",
    serialized,
  );
  const switching = await page.evaluate(async () => {
    const entry = window.probe.views.get("serialized-sequence-light");
    const lightConfig = { ...entry.view.mermaidConfig };
    const darkConfig = { ...window.probe.views.get("serialized-sequence-dark").view.mermaidConfig };
    const outcome = new Promise((resolve) => {
      const off = entry.view.on("render", (event) => {
        if (event.ok) {
          off();
          clearTimeout(timeout);
          resolve(true);
        }
      });
      const timeout = setTimeout(() => {
        off();
        resolve(false);
      }, 5000);
    });
    entry.view.setMermaidConfig(darkConfig);
    entry.view.setMermaidConfig(lightConfig);
    const rendered = await outcome;
    const actor = entry.container.querySelector(".actor");
    return {
      rendered,
      actual: actor ? getComputedStyle(actor).fill : null,
      expected: "rgb(248, 233, 176)",
    };
  });
  mark(
    "rapid-same-view-theme-switch-keeps-latest-theme",
    switching.rendered && switching.actual === switching.expected ? "PASS" : "FAIL",
    switching,
  );
  const security = await page.evaluate(async () => {
    const renderer = window.probe.createSerializedFacade();
    renderer.initialize({ startOnLoad: false, securityLevel: "loose" });
    const { svg } = await renderer.render(
      "strict-probe",
      'flowchart TD\nA[Click target]\nclick A "javascript:alert(1)" "unsafe"',
    );
    const scriptDetectorWorks = /<script\b/i.test("<script>");
    const hrefDetectorWorks = /href=["']javascript:/i.test('href="javascript:alert(1)"');
    const handlerDetectorWorks = /\bon(?:click|error)\s*=/i.test('onclick="alert(1)"');
    return {
      level: window.probe.mermaid.mermaidAPI.getConfig().securityLevel,
      hasScript: /<script\b/i.test(svg),
      hasUnsafeHref: /href=["']javascript:/i.test(svg),
      hasHandler: /\bon(?:click|error)\s*=/i.test(svg),
      detectorSelfTest: scriptDetectorWorks && hrefDetectorWorks && handlerDetectorWorks,
      svgLength: svg.length,
    };
  });
  mark(
    "facade-forces-strict-for-scriptable-link",
    security.level === "strict" &&
      security.detectorSelfTest &&
      !security.hasScript &&
      !security.hasUnsafeHref &&
      !security.hasHandler
      ? "PASS"
      : "FAIL",
    security,
  );
  const parseRecovery = await page.evaluate(async () => {
    const renderer = window.probe.createSerializedFacade();
    let invalidRejected = false;
    try {
      await renderer.parse("flowchart TD\\nA-->");
    } catch {
      invalidRejected = true;
    }
    const validAccepted = await renderer.parse(window.probe.samples.flow);
    return {
      invalidRejected: invalidRejected || validAccepted === false,
      validAccepted: validAccepted !== false,
      securityLevel: window.probe.mermaid.mermaidAPI.getConfig().securityLevel,
    };
  });
  mark(
    "serialized-parse-error-does-not-poison-next-renderer-use",
    parseRecovery.invalidRejected &&
      parseRecovery.validAccepted &&
      parseRecovery.securityLevel === "strict"
      ? "PASS"
      : "FAIL",
    parseRecovery,
  );
  const renderRecovery = await page.evaluate(async () => {
    const renderer = window.probe.createSerializedFacade();
    renderer.initialize({ startOnLoad: false, securityLevel: "strict" });
    let invalidRejected = false;
    try {
      await renderer.render("invalid-render", "flowchart TD\\nA-->");
    } catch {
      invalidRejected = true;
    }
    const recoveredViews = await Promise.all([
      window.probe.open("recovered-flow", "flow", "light", renderer),
      window.probe.open("recovered-sequence", "sequence", "dark", renderer),
    ]);
    const recovered =
      recoveredViews.every(Boolean) &&
      Boolean(document.querySelector("#recovered-flow svg")) &&
      Boolean(document.querySelector("#recovered-sequence svg"));
    window.probe.close("recovered-flow");
    window.probe.close("recovered-sequence");
    return {
      invalidRejected: invalidRejected || recoveredViews.every(Boolean) === false,
      recovered,
    };
  });
  mark(
    "invalid-render-then-valid-multiview-recovers",
    renderRecovery.invalidRejected && renderRecovery.recovered ? "PASS" : "FAIL",
    renderRecovery,
  );
  const cycling = await page.evaluate(async () => {
    const before = {
      ...window.probe.listenerCounts,
      ...window.probe.lifecycleCounts,
      timers: window.probe.pendingTimers.size,
    };
    let renders = 0;
    for (let i = 0; i < 20; i++) {
      const kind = i % 2 ? "sequence" : "flow";
      const theme = i % 2 ? "dark" : "light";
      const id = `cycle-${i}`;
      const ok = await window.probe.open(id, kind, theme);
      if (ok && document.querySelector(`#${id} svg`)) renders++;
      window.probe.close(id);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      renders,
      listenerDelta: {
        added: window.probe.listenerCounts.added - before.added,
        removed: window.probe.listenerCounts.removed - before.removed,
      },
      observerDelta: {
        resizeCreated: window.probe.lifecycleCounts.resizeCreated - before.resizeCreated,
        resizeDisconnected:
          window.probe.lifecycleCounts.resizeDisconnected - before.resizeDisconnected,
        mutationCreated: window.probe.lifecycleCounts.mutationCreated - before.mutationCreated,
        mutationDisconnected:
          window.probe.lifecycleCounts.mutationDisconnected - before.mutationDisconnected,
      },
      pendingTimerDelta: window.probe.pendingTimers.size - before.timers,
      remainingViews: window.probe.views.size,
      remainingCanvases: document.querySelectorAll(".mw-canvas").length,
      remainingSvgHosts: document.querySelectorAll(".mw-svg-host").length,
    };
  });
  mark(
    "twenty-open-render-destroy-cycles",
    cycling.renders === 20 &&
      cycling.listenerDelta.added === cycling.listenerDelta.removed &&
      cycling.observerDelta.resizeCreated === cycling.observerDelta.resizeDisconnected &&
      cycling.observerDelta.mutationCreated === cycling.observerDelta.mutationDisconnected &&
      cycling.pendingTimerDelta <= 0 &&
      cycling.remainingViews === 4 &&
      cycling.remainingCanvases === 4 &&
      cycling.remainingSvgHosts === 4
      ? "PASS"
      : "FAIL",
    cycling,
  );
  const patchedLifecycle = await page.evaluate(async () => {
    const probe = window.probe;
    const run = async (kind, { rejectRender = false, rejectParse = false } = {}) => {
      const container = document.createElement("section");
      document.body.append(container);
      const Editor = [...probe.views.values()][0].editor.constructor;
      const editor = new Editor({ code: probe.samples.flow });
      const diagnostics = [];
      editor.setDiagnostics = (items) => diagnostics.push(items);
      const renderer = probe.createDeferredFacade({ rejectRender, rejectParse });
      const view = new probe.PatchedCanvasView({
        editor,
        container,
        mermaid: renderer,
        debounceMs: 0,
      });
      let renderEvents = 0;
      view.on("render", () => renderEvents++);
      const svgHost = view.svgHost;
      let validatePromise;
      if (kind === "validate") validatePromise = view.validate();
      await renderer.waitStarted(kind === "validate" ? "parse" : "render");
      view.destroy();
      container.remove();
      renderer.release();
      if (validatePromise) await validatePromise;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        detachedSvgWritten: Boolean(svgHost.querySelector("svg")),
        renderEvents,
        diagnosticWrites: diagnostics.length,
        validationResult: validatePromise ? await validatePromise : null,
      };
    };
    return {
      renderSuccess: await run("render"),
      renderReject: await run("render", { rejectRender: true }),
      validateSuccess: await run("validate"),
      validateReject: await run("validate", { rejectParse: true }),
    };
  });
  const patchedLifecyclePass =
    Object.values(patchedLifecycle).every(
      (r) => !r.detachedSvgWritten && r.renderEvents === 0 && r.diagnosticWrites === 0,
    ) &&
    patchedLifecycle.validateSuccess.validationResult === false &&
    patchedLifecycle.validateReject.validationResult === false;
  mark(
    "patched-view-invalidates-pending-render-and-validation",
    patchedLifecyclePass ? "PASS" : "FAIL",
    patchedLifecycle,
  );
  const destroy = await page.evaluate(async () => {
    const container = document.createElement("section");
    document.body.append(container);
    const Editor = [...window.probe.views.values()][0].editor.constructor;
    const editor = new Editor({ code: window.probe.samples.flow });
    const renderer = window.probe.createDeferredFacade();
    const view = new window.probe.MermaidCanvasView({
      editor,
      container,
      mermaid: renderer,
      debounceMs: 0,
    });
    await renderer.waitStarted();
    const svgHost = view.svgHost;
    view.destroy();
    container.remove();
    renderer.release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { detachedSvgWritten: Boolean(svgHost.querySelector("svg")) };
  });
  mark(
    "upstream-view-control-reproduces-late-detached-write",
    destroy.detachedSvgWritten ? "FAIL" : "PASS",
    destroy,
  );
  mark("browser-console-clean", errors.length === 0 ? "PASS" : "FAIL", errors);
  mark(
    "pinned-upstream-lifecycle-patch",
    versions.dom === "1.1.3" &&
      upstreamSha256 === expectedUpstreamSha256 &&
      patchedSha256 !== upstreamSha256
      ? "PASS"
      : "FAIL",
    { upstreamSha256, patchedSha256, version: versions.dom },
  );
  await fs.writeFile(
    path.join(resultsDir, "results.json"),
    JSON.stringify({ versions, results, consoleErrors: errors }, null, 2) + "\n",
  );
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}
// The raw shared Mermaid singleton's theme failure is an expected P0a finding
// and must remain visible in evidence without making the evidence runner unusable.
const failed = results.filter(
  (result) =>
    result.status === "FAIL" &&
    ![
      "raw-concurrent-themes-match-serial-reference",
      "upstream-view-control-reproduces-late-detached-write",
    ].includes(result.id),
);
process.stdout.write(`${JSON.stringify({ versions, results, consoleErrors: errors }, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
