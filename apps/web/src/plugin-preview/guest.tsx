import { changeLanguage, configureI18n, useTranslation } from "@md-editor/i18n";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createDocumentState, switchEditorModeSafely } from "@md-editor/editor-core";
import { CodeMirrorEditor, type CodeMirrorEditorPorts } from "@md-editor/editor-ui";
import { createPluginHost } from "@md-editor/plugin-host";
import type { PluginContext, PluginPackage, PluginSettingValue } from "@md-editor/plugin-sdk";
import * as codemirrorState from "@codemirror/state";
import * as codemirrorView from "@codemirror/view";
import * as lezerMarkdown from "@lezer/markdown";
import * as lezerCommon from "@lezer/common";
import "../styles.css";
import "./guest.css";

// 预览页是独立文档，不经过 App.tsx。lint 文案按 documentElement.lang 选语言。
configureI18n({ syncDocumentLang: true });

type Syntax = Parameters<PluginContext["syntax"]["register"]>[0];
type Command = Parameters<PluginContext["commands"]["register"]>[0];
type Keymap = Parameters<PluginContext["keymaps"]["register"]>[0];

function Guest({
  pkg,
  initialTheme,
  channel,
}: {
  pkg: PluginPackage;
  initialTheme: string;
  channel: MessagePort;
}) {
  const { t } = useTranslation();
  const [documentState] = useState(() =>
    createDocumentState({ markdown: pkg.examples[0]?.markdown ?? "" }),
  );
  const ports = useRef<CodeMirrorEditorPorts | null>(null);
  const [syntax, setSyntax] = useState<Syntax[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [keymaps, setKeymaps] = useState<Keymap[]>([]);
  const [values, setValues] = useState<Record<string, PluginSettingValue>>({});
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [example, setExample] = useState(0);
  const [theme, setTheme] = useState(initialTheme);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const [host] = useState(() => {
    function registry<T>(update: React.Dispatch<React.SetStateAction<T[]>>) {
      return {
        register(value: T) {
          update((old) => [...old, value]);
          return {
            dispose() {
              update((old) => old.filter((item) => item !== value));
            },
          };
        },
      };
    }
    return createPluginHost({
      syntax: registry(setSyntax),
      commands: registry(setCommands),
      keymaps: registry(setKeymaps),
      dependencies: { codemirrorState, codemirrorView, lezerMarkdown, lezerCommon },
      editor: {
        getSnapshot() {
          const snapshot = documentState.getSnapshot();
          const selection = ports.current?.getSelectionSnapshot();
          return {
            markdown: snapshot.markdown,
            selection: { anchor: selection?.anchor ?? 0, head: selection?.head ?? 0 },
            documentGeneration: snapshot.documentGeneration,
            contentRevision: snapshot.contentRevision,
          };
        },
        async applyEdit(edit, signal) {
          if (signal?.aborted || !ports.current) return { status: "cancelled" };
          const result = ports.current.applyExternalEdit({
            ...edit,
            selection: edit.selection ?? "preserve-offset-clamped",
            operationId: `plugin:${++sequence.current}`,
            signal,
          });
          return {
            status:
              result.status === "busy" || result.status === "rejected"
                ? "reconcile-required"
                : result.status,
          };
        },
      },
      settings: {
        get: () => valuesRef.current,
        async update(_id, next) {
          valuesRef.current = { ...next };
          setValues({ ...next });
        },
      },
      styles: {
        mount(_id, css) {
          const element = document.createElement("style");
          element.textContent = css;
          document.head.append(element);
          return { dispose: () => element.remove() };
        },
      },
    });
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme !== "dark");
  }, [theme]);
  useEffect(() => {
    void host
      .enable(pkg)
      .then(() => setActive(true))
      .catch((cause) => setError(String(cause)));
  }, [host, pkg]);
  useEffect(() => {
    const receiveTheme = (event: MessageEvent) => {
      if (event.data?.type === "theme") setTheme(event.data.theme);
    };
    channel.addEventListener("message", receiveTheme);
    return () => {
      channel.removeEventListener("message", receiveTheme);
      host.dispose();
      channel.close();
    };
  }, [channel, host]);
  async function toggle() {
    setError("");
    if (active) {
      host.disable(pkg.manifest.id);
      setActive(false);
    } else {
      try {
        await host.enable(pkg);
        setActive(true);
      } catch (cause) {
        setError(String(cause));
      }
    }
  }
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      const parts = [
        event.ctrlKey && "Ctrl",
        event.metaKey && "Meta",
        event.altKey && "Alt",
        event.shiftKey && "Shift",
        event.key.length === 1 ? event.key.toUpperCase() : event.key,
      ]
        .filter(Boolean)
        .join("-");
      const binding = keymaps.find(
        (item) =>
          item.key
            .replace(/\bMod\b/gi, /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Ctrl")
            .toLowerCase() === parts.toLowerCase(),
      );
      const command = commands.find((item) => item.id === binding?.commandId);
      if (command) {
        event.preventDefault();
        void Promise.resolve(command.run()).catch((cause) => setError(String(cause)));
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [commands, keymaps]);
  function reset(index: number) {
    const item = pkg.examples[index];
    if (!item) return;
    setExample(index);
    documentState.replaceDocument(
      { markdown: item.markdown, replaceIntent: "different" },
      { kind: "command", commandId: "preview.reset" },
    );
    if (item.selection) ports.current?.setSelection(item.selection.anchor, item.selection.head);
  }
  function mode(value: "source" | "wysiwyg") {
    if (ports.current)
      switchEditorModeSafely(documentState, value, {
        renderer: ports.current.mode,
        operationId: `preview:mode:${++sequence.current}`,
      });
  }
  return (
    <main data-theme={theme}>
      <header>
        <strong>{pkg.manifest.name}</strong> · API {pkg.manifest.apiVersion}{" "}
        <button onClick={() => void toggle()}>
          {active ? t("pluginPreview.disable") : t("pluginPreview.enable")}
        </button>{" "}
        <button onClick={() => mode("wysiwyg")}>{t("pluginPreview.visual")}</button>{" "}
        <button onClick={() => mode("source")}>{t("pluginPreview.sourceMode")}</button>{" "}
        <button onClick={() => ports.current?.undo()}>{t("pluginPreview.undo")}</button>{" "}
        <button onClick={() => reset(example)}>{t("pluginPreview.reset")}</button>
      </header>
      {error && <p role="alert">{error}</p>}
      <label>
        {t("pluginPreview.example")}{" "}
        <select value={example} onChange={(event) => reset(Number(event.target.value))}>
          {pkg.examples.map((item, index) => (
            <option key={item.id} value={index}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <p>{pkg.examples[example]?.instructions}</p>
      <div>
        {commands.map((command) => (
          <button
            key={command.id}
            onClick={() =>
              void Promise.resolve(command.run()).catch((cause) => setError(String(cause)))
            }
          >
            {command.title}
          </button>
        ))}
      </div>
      {Object.entries(pkg.settings ?? {}).map(([key, definition]) => (
        <label key={key}>
          {definition.label}{" "}
          {definition.type === "enum" ? (
            <select
              value={String(values[key] ?? definition.default)}
              onChange={(event) => {
                void host
                  .updateSettings(pkg.manifest.id, { [key]: event.target.value })
                  .catch((cause) => setError(String(cause)));
              }}
            >
              {definition.values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={
                definition.type === "boolean"
                  ? "checkbox"
                  : definition.type === "number"
                    ? "number"
                    : "text"
              }
              checked={
                definition.type === "boolean"
                  ? Boolean(values[key] ?? definition.default)
                  : undefined
              }
              value={
                definition.type === "boolean"
                  ? undefined
                  : String(values[key] ?? definition.default)
              }
              onChange={(event) => {
                const value =
                  definition.type === "boolean"
                    ? event.target.checked
                    : definition.type === "number"
                      ? Number(event.target.value)
                      : event.target.value;
                void host
                  .updateSettings(pkg.manifest.id, { [key]: value })
                  .catch((cause) => setError(String(cause)));
              }}
            />
          )}
        </label>
      ))}
      <p>{keymaps.map((item) => `${item.key}: ${item.commandId}`).join(" · ")}</p>
      <div className="editor">
        <CodeMirrorEditor
          document={documentState}
          plugins={syntax}
          onRendererPortsChange={(value) => {
            ports.current = value;
            if (value && pkg.examples[example]?.selection) {
              const selection = pkg.examples[example]!.selection!;
              value.setSelection(selection.anchor, selection.head);
            }
          }}
        />
      </div>
    </main>
  );
}

// Accept exactly one transferred channel from the embedding parent, then ignore all window messages.
window.addEventListener("message", function initialize(event) {
  if (
    event.source !== window.parent ||
    event.data?.type !== "inkpoint-plugin-preview" ||
    event.ports.length !== 1
  )
    return;
  window.removeEventListener("message", initialize);
  const channel = event.ports[0]!;
  const receivePackage = (message: MessageEvent) => {
    if (message.data?.type !== "initialize") return;
    channel.removeEventListener("message", receivePackage);
    void changeLanguage(message.data.locale).then(() =>
      createRoot(document.getElementById("root")!).render(
        <Guest pkg={message.data.package} initialTheme={message.data.theme} channel={channel} />,
      ),
    );
  };
  channel.addEventListener("message", receivePackage);
  channel.start();
});
