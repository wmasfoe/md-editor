import { mountPlayground } from "@md-editor/editor-web";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Missing #root element in index.html");
const appRoot = root;

void startPlayground();

async function startPlayground() {
  appRoot.innerHTML = `
    <header class="playground-toolbar">
      <strong>Inkpoint Web Playground</strong>
      <div class="playground-actions">
        <label class="playground-button" for="markdown-file">Open Markdown</label>
        <input id="markdown-file" type="file" accept=".md,.markdown,text/markdown,text/plain" hidden />
        <button id="copy-markdown" class="playground-button" type="button">Copy Markdown</button>
        <button id="download-markdown" class="playground-button" type="button">Download</button>
      </div>
    </header>
    <main id="gpui-mount" aria-label="Markdown editor"></main>
    <output id="playground-status" class="playground-status" aria-live="polite"></output>
  `;

  const status = appRoot.querySelector<HTMLOutputElement>("#playground-status")!;
  const initialMarkdown = location.pathname.replace(/\/$/, "").endsWith("/plugins")
    ? "# Plugin Preview Playground\n\nThe plugin gallery is being ported to the shared GPUI editor.\n\nUse this page to inspect and edit Markdown while the plugin preview host is unavailable.\n"
    : "# GPUI Web Playground\n\nEdit this Markdown in the shared GPUI editor.\n";
  const editor = await mountPlayground({
    initialMarkdown,
    assetBasePath: import.meta.env.BASE_URL,
    onChange: () => {
      status.value = "Unsaved changes";
    },
  });

  appRoot
    .querySelector<HTMLInputElement>("#markdown-file")!
    .addEventListener("change", async (event) => {
      const file = (event.currentTarget as HTMLInputElement).files?.[0];
      if (!file) return;
      editor.setMarkdown(await file.text());
      status.value = `Opened ${file.name}`;
    });
  appRoot
    .querySelector<HTMLButtonElement>("#copy-markdown")!
    .addEventListener("click", async () => {
      await navigator.clipboard.writeText(editor.getMarkdown());
      status.value = "Copied Markdown";
    });
  appRoot.querySelector<HTMLButtonElement>("#download-markdown")!.addEventListener("click", () => {
    const blob = new Blob([editor.getMarkdown()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "untitled.md";
    anchor.click();
    URL.revokeObjectURL(url);
    status.value = "Downloaded untitled.md";
  });
}
