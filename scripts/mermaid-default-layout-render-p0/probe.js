import mermaid from "mermaid";
import { MermaidWysiwygEditor } from "@visimer/core";
import { MermaidCanvasView } from "@visimer/dom";
import { MermaidCanvasView as PatchedCanvasView } from "@visimer/dom-patched";

const listenerCounts = { added: 0, removed: 0 };
const viewListenerCounts = { added: 0, removed: 0 };
const lifecycleCounts = {
  resizeCreated: 0,
  resizeDisconnected: 0,
  mutationCreated: 0,
  mutationDisconnected: 0,
};
const pendingTimers = new Set();
const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
globalThis.setTimeout = (callback, delay, ...args) => {
  const timer = nativeSetTimeout(() => {
    pendingTimers.delete(timer);
    callback(...args);
  }, delay);
  pendingTimers.add(timer);
  return timer;
};
globalThis.clearTimeout = (timer) => {
  pendingTimers.delete(timer);
  return nativeClearTimeout(timer);
};
for (const [name, counter] of [
  ["ResizeObserver", "resize"],
  ["MutationObserver", "mutation"],
]) {
  const NativeObserver = globalThis[name];
  if (!NativeObserver) continue;
  globalThis[name] = class extends NativeObserver {
    constructor(...args) {
      super(...args);
      lifecycleCounts[`${counter}Created`]++;
    }
    disconnect() {
      lifecycleCounts[`${counter}Disconnected`]++;
      return super.disconnect();
    }
  };
}
const originalAdd = EventTarget.prototype.addEventListener;
const originalRemove = EventTarget.prototype.removeEventListener;
EventTarget.prototype.addEventListener = function (...args) {
  if (this === document || this.classList?.contains("mw-canvas")) {
    listenerCounts.added++;
    viewListenerCounts.added++;
  }
  return originalAdd.apply(this, args);
};
EventTarget.prototype.removeEventListener = function (...args) {
  if (this === document || this.classList?.contains("mw-canvas")) {
    listenerCounts.removed++;
    viewListenerCounts.removed++;
  }
  return originalRemove.apply(this, args);
};
const root = document.querySelector("#root");
const views = new Map();
const samples = {
  flow: "flowchart TD\n  A[Alpha] --> B[Beta]",
  sequence: "sequenceDiagram\n  participant A as Alpha\n  participant B as Beta\n  A->>B: Hello",
};
// Distinct theme variables make cross-view config contamination observable.
const configs = {
  light: { theme: "default", themeVariables: { primaryColor: "#f8e9b0", actorBkg: "#f8e9b0" } },
  dark: { theme: "dark", themeVariables: { primaryColor: "#24364b", actorBkg: "#24364b" } },
};
function createSerializedFacade() {
  let requestedConfig = { startOnLoad: false, securityLevel: "strict" };
  let tail = Promise.resolve();
  return {
    initialize(config) {
      requestedConfig = { ...config, securityLevel: "strict" };
    },
    render(id, code) {
      const config = { ...requestedConfig };
      const rendered = tail.then(() => {
        mermaid.initialize({ ...config, securityLevel: "strict" });
        return mermaid.render(id, code);
      });
      tail = rendered.catch(() => undefined);
      return rendered;
    },
    parse(code, options) {
      const config = { ...requestedConfig, securityLevel: "strict" };
      const parsed = tail.then(() => {
        mermaid.initialize(config);
        return mermaid.parse(code, options);
      });
      tail = parsed.catch(() => undefined);
      return parsed;
    },
  };
}
function createDeferredFacade({ rejectRender = false, rejectParse = false } = {}) {
  const facade = createSerializedFacade();
  const starts = {};
  const started = {};
  const gates = {};
  for (const op of ["render", "parse"])
    started[op] = new Promise((resolve) => {
      starts[op] = resolve;
    });
  const markStarted = (op) => starts[op]();
  let releaseAll;
  const gate = new Promise((resolve) => {
    releaseAll = resolve;
  });
  for (const op of ["render", "parse"]) gates[op] = gate;
  return {
    initialize: (config) => facade.initialize(config),
    parse: (code, options) => {
      markStarted("parse");
      return gates.parse.then(() => {
        if (rejectParse) throw new Error("deferred parse rejection");
        return facade.parse(code, options);
      });
    },
    render: (id, code) => {
      markStarted("render");
      return gates.render.then(() => {
        if (rejectRender) throw new Error("deferred render rejection");
        return facade.render(id, code);
      });
    },
    waitStarted: (op = "render") => started[op],
    release: () => releaseAll(),
  };
}
function open(id, kind, theme, renderer = mermaid, View = MermaidCanvasView) {
  const container = document.createElement("section");
  container.id = id;
  container.style.cssText = "width:640px;height:360px";
  root.append(container);
  const editor = new MermaidWysiwygEditor({ code: samples[kind] });
  const view = new View({
    editor,
    container,
    mermaid: renderer,
    mermaidConfig: { startOnLoad: false, securityLevel: "strict", ...configs[theme] },
    debounceMs: 0,
    panZoom: true,
  });
  const rendered = new Promise((resolve) => {
    const timeout = setTimeout(() => {
      off();
      resolve(false);
    }, 5000);
    const off = view.on("render", (event) => {
      if (event.ok) {
        off();
        clearTimeout(timeout);
        resolve(true);
      }
    });
  });
  views.set(id, { view, editor, container, rendered, kind, theme });
  return rendered;
}
function close(id) {
  const entry = views.get(id);
  if (!entry) return;
  entry.view.destroy();
  entry.container.remove();
  views.delete(id);
}
window.probe = {
  open,
  close,
  views,
  samples,
  mermaid,
  MermaidCanvasView,
  PatchedCanvasView,
  createSerializedFacade,
  createDeferredFacade,
  listenerCounts,
  viewListenerCounts,
  lifecycleCounts,
  pendingTimers,
};
