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
import { validateKeymapKey } from "@md-editor/editor-core";
import { createPluginHost } from "@md-editor/plugin-host";
import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";
import type { CodeMirrorEditorPorts } from "@md-editor/editor-ui";
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
    const contributedKeys = new Map<string, PluginStatusEvent["keymaps"][number]>();
    let records: StoredPlugin[] = [];
    let closed = false;
    const safeStart = isTauri()
      ? invoke<boolean>("external_plugins_safe_start")
      : Promise.resolve(false);
    let chain = Promise.resolve();
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
      commands: {
        register(command) {
          return runtime.commands.register({ ...command, placement: ["command-palette"] });
        },
      },
      keymaps: {
        register(keymap) {
          const owner = records
            .filter((plugin) => keymap.id.startsWith(`${plugin.id}.`))
            .toSorted((left, right) => right.id.length - left.id.length)[0];
          if (!owner) throw new Error(`Unknown plugin for keymap: ${keymap.id}`);
          // 用户覆盖键可能格式不合法，或与内置/其他插件冲突。覆盖键失败时回退到插件声明的
          // 默认键并把原因展示给用户，不能让一个快捷键拖垮整个插件的语法与命令。
          const override = owner.keymapOverrides?.[keymap.id];
          let overrideError: PluginStatusEvent["keymaps"][number]["overrideError"];
          let effectiveKey: string | null = keymap.key;
          if (override && override !== keymap.key) {
            const invalid = validateKeymapKey(override);
            const conflict = invalid ? undefined : runtime.keymaps.findConflict(override);
            if (invalid) overrideError = { kind: "invalid", message: invalid };
            else if (conflict) overrideError = { kind: "conflict", message: conflict.id };
            else effectiveKey = override;
          }
          // 默认键同样可能被内置功能或先启用的插件占用。这时只跳过这条快捷键，
          // 命令仍可从命令面板执行，语法与其他贡献不受影响。
          const defaultConflict =
            effectiveKey === keymap.key ? runtime.keymaps.findConflict(keymap.key) : undefined;
          if (defaultConflict) {
            effectiveKey = null;
            overrideError ??= { kind: "conflict", message: defaultConflict.id };
          }
          const registration = effectiveKey
            ? runtime.keymaps.register({ ...keymap, key: effectiveKey })
            : { dispose() {} };
          contributedKeys.set(keymap.id, {
            id: keymap.id,
            key: keymap.key,
            pluginId: owner.id,
            effectiveKey,
            ...(overrideError ? { overrideError } : {}),
          });
          publishStatus();
          return {
            dispose() {
              registration.dispose();
              contributedKeys.delete(keymap.id);
              publishStatus();
            },
          };
        },
      },
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
    const publishStatus = () => {
      if (isTauri())
        void emit<PluginStatusEvent>("inkpoint:plugin-status", {
          statuses: [
            ...host.getStatuses().filter((status) => !validationErrors.has(status.id)),
            ...[...validationErrors].map(([id, error]) => ({
              id,
              status: "error" as const,
              error,
            })),
          ],
          keymaps: [...contributedKeys.values()],
        });
    };
    const statusSubscription = host.subscribe(publishStatus);
    let stopStatusRequest: (() => void) | undefined;
    if (isTauri())
      void listen("inkpoint:plugin-status-request", publishStatus).then((fn) => {
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
