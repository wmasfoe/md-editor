import { useEffect, useRef, useState } from "react";
import * as codemirrorState from "@codemirror/state";
import * as codemirrorView from "@codemirror/view";
import * as lezerMarkdown from "@lezer/markdown";
import * as lezerCommon from "@lezer/common";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  highlightPlugin,
  containerDirectivePlugin,
  mathPlugin,
  mermaidPlugin,
} from "@md-editor/syntax-plugins";
import { validateKeymapKey } from "@md-editor/core";
import { createPluginHost, createPluginCommandBindings } from "@md-editor/plugin-host";
import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";
import type { CodeMirrorEditorPorts } from "@md-editor/editor";
import { promotePendingPlugins } from "./promote-pending";
import { verifyStoredPlugin } from "./verify-plugin";
import { runtime } from "../runtime/editor-runtime";
import {
  listenForPluginChanges,
  loadPlugins,
  savePlugin,
  type PluginStatusEvent,
  type StoredPlugin,
} from "./storage";

function syntaxNodeNames(plugin: MarkdownSyntaxPlugin): string[] {
  const extension = plugin.markdownExtension;
  const definitions = extension && !Array.isArray(extension) ? extension.defineNodes : undefined;
  return [
    ...(definitions ?? []).map((node) => (typeof node === "string" ? node : node.name)),
    ...Object.keys(plugin.nodePolicies ?? {}),
    ...(plugin.nodePolicy ? [plugin.nodePolicy.nodeName] : []),
  ];
}

let promotedPendingVersions = false;

/** The editor window alone owns the host; settings windows only change persisted state. */
export function useExternalPlugins(
  ports: CodeMirrorEditorPorts | null,
): readonly MarkdownSyntaxPlugin[] {
  const [syntax, setSyntax] = useState<readonly MarkdownSyntaxPlugin[]>([]);
  const portsRef = useRef(ports);
  portsRef.current = ports;
  useEffect(() => {
    const builtins = [highlightPlugin, containerDirectivePlugin, mathPlugin, mermaidPlugin];
    const registered = new Map<string, MarkdownSyntaxPlugin>();
    const validationErrors = new Map<string, string>();
    const activationTokens = new Map<string, object>();
    let records: StoredPlugin[] = [];
    let closed = false;
    const safeStart = isTauri()
      ? invoke<boolean>("external_plugins_safe_start")
      : Promise.resolve(false);
    let chain = Promise.resolve();
    const commandBindings = createPluginCommandBindings({
      commands: {
        register: (command) =>
          runtime.commands.register({ ...command, placement: ["command-palette"] }),
      },
      keymaps: runtime.keymaps,
      getBindings: (id) => records.find((plugin) => plugin.id === id)?.keymapOverrides ?? {},
      validateKey: validateKeymapKey,
      onChange: () => publishStatus(),
    });
    const host = createPluginHost({
      syntax: {
        register(plugin) {
          if (registered.has(plugin.id) || builtins.some((builtin) => builtin.id === plugin.id))
            throw new Error(`Duplicate syntax: ${plugin.id}`);
          const builtInNodes = new Set(builtins.flatMap(syntaxNodeNames));
          if (syntaxNodeNames(plugin).some((name) => builtInNodes.has(name)))
            throw new Error(`Syntax node conflicts with a built-in plugin: ${plugin.id}`);
          registered.set(plugin.id, plugin);
          setSyntax([...registered.values()]);
          return {
            dispose() {
              registered.delete(plugin.id);
              setSyntax([...registered.values()]);
            },
          };
        },
      },
      commands: commandBindings.commands,
      keymaps: commandBindings.keymaps,
      editor: {
        getSnapshot() {
          const state = runtime.document.getSnapshot();
          const selection = portsRef.current?.getSelectionSnapshot();
          if (!selection) throw new Error("No editor is open");
          return {
            markdown: state.markdown,
            selection: {
              anchor: selection.anchor,
              head: selection.head,
            },
            documentGeneration: state.documentGeneration,
            contentRevision: state.contentRevision,
          };
        },
        async applyEdit(edit, signal) {
          if (signal?.aborted) return { status: "cancelled" };
          if (!portsRef.current) return { status: "reconcile-required" };
          const result = portsRef.current.applyExternalEdit({
            ...edit,
            selection: edit.selection ?? "preserve-offset-clamped",
            operationId: `plugin:${crypto.randomUUID()}`,
            signal,
          });
          switch (result.status) {
            case "applied":
            case "noop":
            case "queued-composition":
            case "stale":
            case "cancelled":
            case "reconcile-required":
              return { status: result.status };
            default:
              return { status: "reconcile-required" };
          }
        },
      },
      dependencies: { codemirrorState, codemirrorView, lezerMarkdown, lezerCommon },
      settings: {
        get(id) {
          return records.find((p) => p.id === id)?.settings ?? {};
        },
        async update(id, settings) {
          const plugin = records.find((p) => p.id === id);
          if (!plugin) throw new Error("Plugin no longer installed");
          // Persistence events arrive asynchronously. Read the latest revision for each
          // queued SDK update rather than reusing the host's last event snapshot.
          const latest = (await loadPlugins()).find((p) => p.id === id);
          if (!latest?.enabled || latest.current.source.sha256 !== plugin.current.source.sha256)
            throw new Error("Plugin changed before its settings could be saved");
          await savePlugin({ ...latest, settings });
        },
      },
      styles: {
        mount(id, css) {
          const style = document.createElement("style");
          style.dataset.plugin = id;
          style.textContent = css;
          document.head.append(style);
          return { dispose: () => style.remove() };
        },
      },
    });
    const publishStatus = (requestId?: string) => {
      if (isTauri())
        void emit<PluginStatusEvent>("inkpoint:plugin-status", {
          ...(requestId ? { requestId } : {}),
          statuses: [
            ...host.getStatuses().filter((status) => !validationErrors.has(status.id)),
            ...[...validationErrors].map(([id, error]) => ({
              id,
              status: "error" as const,
              error,
            })),
          ],
          keymaps: commandBindings.getStatuses(),
          occupiedKeys: runtime.keymaps.list().filter((keymap) => !keymap.when),
        });
    };
    const statusSubscription = host.subscribe(publishStatus);
    let stopStatusRequest: (() => void) | undefined;
    if (isTauri())
      void listen<{ requestId?: string }>("inkpoint:plugin-status-request", (event) => {
        publishStatus(event.payload?.requestId);
      }).then((fn) => {
        if (closed) fn();
        else stopStatusRequest = fn;
      });
    const sync = () => {
      chain = chain
        .then(async () => {
          let next = await loadPlugins();
          if (await safeStart) return;
          if (closed) return;
          if (!promotedPendingVersions) {
            await promotePendingPlugins(next, false, savePlugin);
            next = await loadPlugins();
            promotedPendingVersions = true;
          }
          const previous = records;
          records = next;
          for (const old of previous)
            if (!next.some((p) => p.id === old.id && p.enabled)) {
              activationTokens.delete(old.id);
              validationErrors.delete(old.id);
              host.disable(old.id);
              publishStatus();
            }
          for (const plugin of next) {
            const old = previous.find((p) => p.id === plugin.id);
            if (
              plugin.enabled &&
              (!old?.enabled ||
                JSON.stringify(old.current) !== JSON.stringify(plugin.current) ||
                JSON.stringify(old.keymapOverrides) !== JSON.stringify(plugin.keymapOverrides))
            ) {
              host.disable(plugin.id);
              validationErrors.delete(plugin.id);
              const token = {};
              activationTokens.set(plugin.id, token);
              void verifyStoredPlugin(plugin.id, plugin.current)
                .then(async (pkg) => {
                  if (closed || activationTokens.get(plugin.id) !== token) return;
                  await host.enable(pkg);
                  const latest = records.find((item) => item.id === plugin.id && item.enabled);
                  if (!closed && latest && activationTokens.get(plugin.id) === token) {
                    await host.synchronizeSettings(plugin.id, latest.settings);
                  }
                })
                .catch((error: unknown) => {
                  if (!closed && activationTokens.get(plugin.id) === token) {
                    validationErrors.set(
                      plugin.id,
                      error instanceof Error ? error.message : String(error),
                    );
                    publishStatus();
                  }
                });
            } else if (
              plugin.enabled &&
              old &&
              JSON.stringify(old.settings) !== JSON.stringify(plugin.settings)
            ) {
              void host
                .synchronizeSettings(plugin.id, plugin.settings)
                .catch((error) => console.error("Plugin settings update failed", error));
            }
          }
        })
        .catch((error) => console.error("Could not load external plugins", error));
    };
    let unlisten: (() => void) | undefined;
    void listenForPluginChanges(sync).then((fn) => {
      if (closed) fn();
      else {
        unlisten = fn;
        sync();
      }
    });
    return () => {
      closed = true;
      unlisten?.();
      stopStatusRequest?.();
      statusSubscription.dispose();
      host.dispose();
      setSyntax([]);
    };
  }, []);
  return syntax;
}
