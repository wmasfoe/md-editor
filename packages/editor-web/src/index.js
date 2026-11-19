import * as wasm from "../dist/inkpoint_editor_web.js";

/**
 * Loads the GPUI canvas editor and returns its small browser-facing API.
 *
 * @param {{ initialMarkdown?: string, onChange?: (markdown: string) => void }} options
 */
export async function mountPlayground({
  initialMarkdown = "",
  onChange,
  assetBasePath = "/playground/",
} = {}) {
  await wasm.default();
  wasm.run(initialMarkdown, assetBasePath);
  await waitForEditorReady();

  let lastRevision = wasm.get_revision();
  let disposed = false;
  const observer = onChange
    ? window.setInterval(() => {
        const nextRevision = wasm.get_revision();
        if (nextRevision === lastRevision) return;
        lastRevision = nextRevision;
        onChange(wasm.get_markdown());
      }, 100)
    : undefined;

  return {
    getMarkdown: wasm.get_markdown,
    setMarkdown(markdown) {
      wasm.set_markdown(markdown);
      lastRevision = wasm.get_revision();
    },
    setReadonly: wasm.set_readonly,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (observer !== undefined) window.clearInterval(observer);
    },
  };
}

async function waitForEditorReady() {
  const timeoutAt = performance.now() + 10_000;
  while (performance.now() < timeoutAt) {
    try {
      wasm.get_revision();
      return;
    } catch {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }
  }
  throw new Error("GPUI Web editor did not mount within 10 seconds");
}
