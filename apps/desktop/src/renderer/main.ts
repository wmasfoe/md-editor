import { resolveCodeFontStack, resolveProseFontStack } from "@md-editor/app-ui/themes";
import { createDocumentState, switchEditorModeSafely } from "@md-editor/core";
import { createCodeMirrorEditorBridge } from "@md-editor/editor";
import {
  containerDirectivePlugin,
  highlightPlugin,
  mathPlugin,
  mermaidPlugin,
} from "@md-editor/syntax-plugins";
import type { EditorSnapshot, HostMessage, NativeCommand } from "./protocol.ts";
import "./style.css";

const editorRoot = document.querySelector<HTMLElement>("#editor")!;
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let generation = 0;
let composing = false;
let readonly = false;
let sequence = 0;
let mdx = false;
let lastSnapshot = "";
let settings: Extract<NativeCommand, { type: "settings" }> = {
  type: "settings",
  theme: "system",
  editor: {
    wysiwygFontSize: 17,
    proseFontFamily: "",
    codeFontFamily: "",
    showCodeBlockLineNumbers: false,
    showInlineStyleMarkers: false,
    enableMarkdownLint: true,
  },
};
const assetBase = new URL("/document-assets/", window.location.href);

const post = (message: HostMessage) => window.ipc?.postMessage(JSON.stringify(message));
const byteOffset = (markdown: string, offset: number) =>
  encoder.encode(markdown.slice(0, offset)).length;
function utf16Offset(markdown: string, byte: number): number {
  const bytes = encoder.encode(markdown);
  return decoder.decode(bytes.slice(0, Math.max(0, Math.min(byte, bytes.length)))).length;
}

const state = createDocumentState({ markdown: "", mode: "wysiwyg" });
const bridgeOptions = (mdxMode: boolean) => ({
  parent: editorRoot,
  document: state,
  mdxMode,
  plugins: [highlightPlugin, containerDirectivePlugin, mathPlugin, mermaidPlugin],
  resolveImageSrc: (source: string) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(source)) return source;
    const image = new URL(source, assetBase);
    image.searchParams.set("document", String(generation));
    return image.href;
  },
  onSyncError: (error: unknown) => console.error("Editor synchronization failed", error),
  onQueuedExternalEditResult: (result: unknown) => console.warn("External edit result", result),
  openLinkTarget: (url: string) => post({ type: "link", url }),
});
let bridge = createCodeMirrorEditorBridge(bridgeOptions(mdx));
let ports = bridge.ports;

function applyTheme(): void {
  document.documentElement.dataset.theme =
    settings.theme === "system" ? (systemDark.matches ? "dark" : "light") : settings.theme;
}

function applySettings(): void {
  const { editor } = settings;
  applyTheme();
  document.documentElement.style.setProperty(
    "--theme-editor-font-size",
    `${editor.wysiwygFontSize}px`,
  );
  if (editor.proseFontFamily) {
    document.documentElement.style.setProperty(
      "--theme-font",
      resolveProseFontStack(editor.proseFontFamily),
    );
  } else {
    document.documentElement.style.removeProperty("--theme-font");
  }
  if (editor.codeFontFamily) {
    document.documentElement.style.setProperty(
      "--theme-mono-font",
      resolveCodeFontStack(editor.codeFontFamily),
    );
  } else {
    document.documentElement.style.removeProperty("--theme-mono-font");
  }
  ports.setCodeBlockLineNumbers(editor.showCodeBlockLineNumbers);
  ports.setInlineStyleMarkers(editor.showInlineStyleMarkers);
  ports.setMarkdownLint(editor.enableMarkdownLint);
}

function snapshot(flush = false): EditorSnapshot {
  if (flush && !ports.isComposing()) ports.flushPendingEdits();
  const documentSnapshot = state.getSnapshot();
  const selection = ports.getSelectionSnapshot();
  return {
    type: "snapshot",
    generation,
    revision: documentSnapshot.contentRevision,
    markdown: documentSnapshot.markdown,
    from: byteOffset(documentSnapshot.markdown, selection.from),
    to: byteOffset(documentSnapshot.markdown, selection.to),
    composing: composing || ports.isComposing(),
    mode: documentSnapshot.mode,
  };
}

function publishSnapshot(force = false): void {
  const current = snapshot();
  const fingerprint = JSON.stringify(current);
  if (force || fingerprint !== lastSnapshot) {
    lastSnapshot = fingerprint;
    post(current);
  }
}

function setReadonly(value: boolean): void {
  readonly = value;
  editorRoot.classList.toggle("is-readonly", readonly);
  const content = editorRoot.querySelector<HTMLElement>(".cm-content");
  if (content) content.contentEditable = String(!readonly);
}

function toggleMode(): void {
  if (readonly) return;
  const current = state.getSnapshot();
  switchEditorModeSafely(state, current.mode === "wysiwyg" ? "source" : "wysiwyg", {
    renderer: ports.mode,
  });
  publishSnapshot(true);
}

function receive(command: NativeCommand): void {
  switch (command.type) {
    case "load": {
      generation = command.generation;
      if (mdx !== command.mdx) {
        mdx = command.mdx;
        bridge.destroy();
        bridge = createCodeMirrorEditorBridge(bridgeOptions(mdx));
        ports = bridge.ports;
        applySettings();
      }
      readonly = command.readonly;
      const result = state.replaceDocument(
        { markdown: command.markdown, mode: "wysiwyg", replaceIntent: "different" },
        { kind: "command", commandId: "file.open" },
      );
      if (result.status !== "applied" && result.status !== "noop") {
        console.error("Could not load document", result);
      }
      setReadonly(readonly);
      ports.focus();
      publishSnapshot(true);
      break;
    }
    case "readonly":
      setReadonly(command.readonly);
      break;
    case "settings":
      settings = command;
      applySettings();
      break;
    case "toggle-mode":
      toggleMode();
      break;
    case "focus":
      ports.focus();
      break;
    case "format":
      ports.executeFormatting(command.id);
      break;
    case "seek":
      ports.scrollToLine(command.line, { select: true, focus: true });
      break;
    case "insert": {
      const canFlush = !composing && !ports.isComposing() && !readonly;
      if (canFlush) ports.flushPendingEdits();
      const current = state.getSnapshot();
      const selection = ports.getSelectionSnapshot();
      const selectionFrom = byteOffset(current.markdown, selection.from);
      const selectionTo = byteOffset(current.markdown, selection.to);
      let applied = false;
      if (
        canFlush &&
        command.generation === generation &&
        command.revision === current.contentRevision &&
        command.from === selectionFrom &&
        command.to === selectionTo &&
        command.from <= command.to
      ) {
        const from = utf16Offset(current.markdown, command.from);
        const to = utf16Offset(current.markdown, command.to);
        const markdown =
          current.markdown.slice(0, from) + command.text + current.markdown.slice(to);
        const result = ports.applyExternalEdit({
          operationId: `native-insert:${generation}:${++sequence}`,
          markdown,
          expectedGeneration: current.documentGeneration,
          expectedContentRevision: command.revision,
          selection: { anchor: from + command.text.length, head: from + command.text.length },
        });
        applied = result.status === "applied" || result.status === "noop";
      }
      post({ type: "insert-result", applied });
      publishSnapshot(true);
      break;
    }
  }
}

window.inkpointReceive = receive;
window.inkpointSnapshot = () => snapshot(true);
state.subscribeSnapshot(() => publishSnapshot());
document.addEventListener("selectionchange", () => publishSnapshot());
// The native child receives these clicks without a GPUI mouse event. A click on
// an already focused DOM element may leave its DOM focus unchanged.
const reportEditorFocus = () => post({ type: "editor-focus" });
editorRoot.addEventListener("pointerdown", reportEditorFocus, { capture: true });
editorRoot.addEventListener("focusin", reportEditorFocus);
editorRoot.addEventListener(
  "beforeinput",
  (event: InputEvent) => {
    if (event.inputType !== "insertText" || event.data?.length !== 1) return;

    // WKWebView can submit legacy arrow control codes as text during cursor movement.
    const code = event.data.charCodeAt(0);
    if (code >= 0x1c && code <= 0x1f) event.preventDefault();
  },
  { capture: true },
);
editorRoot.addEventListener("compositionstart", () => {
  composing = true;
  publishSnapshot(true);
});
editorRoot.addEventListener("compositionend", () => {
  composing = false;
  publishSnapshot(true);
});
editorRoot.addEventListener("click", (event) => {
  const target =
    event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (target) {
    event.preventDefault();
    post({ type: "link", url: target.href });
  }
});
editorRoot.addEventListener("paste", (event) => {
  const items = [...(event.clipboardData?.items ?? [])];
  const hasImage = items.some((item) => item.type.startsWith("image/"));
  const hasText = items.some((item) => item.kind === "string");
  if (hasImage && !hasText) {
    event.preventDefault();
    const current = snapshot(true);
    post(current);
    post({ type: "paste-image" });
  }
});
const commands: Record<string, Extract<HostMessage, { type: "command" }>["command"]> = {
  n: "new",
  o: "open",
  s: "save",
  "shift+s": "save-as",
  w: "close",
  "alt+o": "open-folder",
  "shift+b": "outline",
};

window.addEventListener(
  "keydown",
  (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "/") {
      // Reserve the mode shortcut before CodeMirror handles its Markdown comment binding.
      event.preventDefault();
      if (!event.isComposing && !composing) toggleMode();
    }
  },
  { capture: true },
);
document.addEventListener("keydown", (event) => {
  if (!event.metaKey && !event.ctrlKey) return;
  if (event.key === "," && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    post({ type: "command", command: "settings" });
    return;
  }
  const key = event.key.toLowerCase();
  const command =
    event.altKey && event.code === "KeyO"
      ? commands["alt+o"]
      : commands[`${event.shiftKey ? "shift+" : ""}${key}`];
  if (command) {
    event.preventDefault();
    post({ type: "command", command });
  }
});

systemDark.addEventListener("change", applyTheme);
applySettings();
post({ type: "ready" });
