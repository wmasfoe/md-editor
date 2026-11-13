import type {
  Disposable,
  PluginContext,
  PluginDefinition,
  PluginPackage,
  PluginSettingValue,
} from "@md-editor/plugin-sdk";
import { isSettingValue, validatePluginPackage } from "./validation.ts";

type Syntax = Parameters<PluginContext["syntax"]["register"]>[0];
type Command = Parameters<PluginContext["commands"]["register"]>[0];
type Keymap = Parameters<PluginContext["keymaps"]["register"]>[0];
type Edit = Parameters<PluginContext["editor"]["applyEdit"]>[0];
type Registry<T> = { register(value: T, pluginId: string): Disposable };
export interface PluginHostOptions {
  syntax: Registry<Syntax>;
  commands: Registry<Command>;
  keymaps: Registry<Keymap>;
  editor: {
    getSnapshot: PluginContext["editor"]["getSnapshot"];
    applyEdit(edit: Edit, signal?: AbortSignal): ReturnType<PluginContext["editor"]["applyEdit"]>;
  };
  dependencies: PluginContext["dependencies"];
  settings: {
    get(
      id: string,
    ):
      | Readonly<Record<string, PluginSettingValue>>
      | Promise<Readonly<Record<string, PluginSettingValue>>>;
    update(id: string, values: Readonly<Record<string, PluginSettingValue>>): Promise<void>;
  };
  styles: { mount(id: string, css: string): Disposable };
  loadModule?: (code: string) => Promise<{ default: PluginDefinition }>;
}
export interface PluginStatus {
  id: string;
  status: "loading" | "active" | "disabled" | "error";
  error?: string;
}
interface Session {
  controller: AbortController;
  resources: Disposable[];
  ids: Set<string>;
  nodes: Set<string>;
  updateSettings?: PluginContext["settings"]["update"];
  synchronizeSettings?: (values: Readonly<Record<string, PluginSettingValue>>) => Promise<void>;
}

async function loadModule(code: string): Promise<{ default: PluginDefinition }> {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function collectNodes(config: Syntax["markdownExtension"]): string[] {
  if (!config) return [];
  if (Array.isArray(config)) return config.flatMap(collectNodes);
  return (config.defineNodes ?? []).map((node) => (typeof node === "string" ? node : node.name));
}

/**
 * 由插件 ID 推导语法节点名的命名空间前缀，节点名必须是 `<前缀><后缀>`。
 *
 * 规则：按 `.` 分段转 PascalCase 后以 `_` 结尾，段内的 `-` 也转大写并保留为 `_`
 * 以外的独立边界，例如 `author.weekly` → `AuthorWeekly_`，`my-org.tool` → `My_OrgTool_`。
 *
 * - 结尾的 `_` 让前缀不再是另一个更长 ID 前缀的前缀（`owner.plugin` 与 `owner.pluginx`）。
 * - `.` 与 `-` 映射成不同形态，`a.b`（`AB_`）与 `a-b`（`A_B_`）不会得到同一个前缀。
 * 插件 ID 只含小写字母、数字、`.` 与 `-`（见 `validation.ts`），所以 `_` 只来自本函数。
 */
const pascal = (part: string) => part.charAt(0).toUpperCase() + part.slice(1);

export function syntaxNodePrefix(id: string): string {
  return `${id
    .split(".")
    .map((segment) => segment.split("-").map(pascal).join("_"))
    .join("")}_`;
}

export function createPluginHost(options: PluginHostOptions) {
  const sessions = new Map<string, Session>();
  const statuses = new Map<string, PluginStatus>();
  const listeners = new Set<() => void>();
  const ids = new Set<string>();
  const nodes = new Set<string>();
  const settingsTasks = new Map<string, Promise<unknown>>();
  function serializeSettings<T>(id: string, task: () => T | Promise<T>): Promise<T> {
    const previous = settingsTasks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    settingsTasks.set(id, next);
    void next
      .finally(() => {
        if (settingsTasks.get(id) === next) settingsTasks.delete(id);
      })
      .catch(() => {});
    return next;
  }
  let disposed = false;
  function publish(status: PluginStatus) {
    statuses.set(status.id, status);
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* Subscribers must not break lifecycle cleanup. */
      }
    }
  }
  function cleanup(session: Session) {
    session.controller.abort();
    for (const resource of session.resources.splice(0).toReversed()) {
      try {
        resource.dispose();
      } catch {
        /* Dispose every resource even if one fails. */
      }
    }
    for (const id of session.ids) ids.delete(id);
    for (const node of session.nodes) nodes.delete(node);
    session.ids.clear();
    session.nodes.clear();
  }
  function disable(id: string) {
    const session = sessions.get(id);
    if (session) {
      sessions.delete(id);
      cleanup(session);
    }
    if (statuses.has(id)) publish({ id, status: "disabled" });
  }
  async function enable(input: PluginPackage): Promise<void> {
    if (disposed) throw new Error("Plugin host is disposed");
    const pkg = validatePluginPackage(input);
    const id = pkg.manifest.id;
    disable(id);
    const session: Session = {
      controller: new AbortController(),
      resources: [],
      ids: new Set(),
      nodes: new Set(),
    };
    sessions.set(id, session);
    publish({ id, status: "loading" });
    const active = () => sessions.get(id) === session && !session.controller.signal.aborted;
    const guard = () => {
      if (!active()) throw new Error("Plugin is disabled");
    };
    const register = <T extends { id: string }>(
      kind: string,
      registry: Registry<T>,
      value: T,
      names: string[] = [],
    ): Disposable => {
      guard();
      if (!value.id.startsWith(`${id}.`) || value.id.length === id.length + 1)
        throw new Error(`Contribution id must be namespaced by ${id}`);
      const key = `${kind}:${value.id}`;
      if (
        ids.has(key) ||
        names.some((name) => nodes.has(name)) ||
        new Set(names).size !== names.length
      )
        throw new Error("Conflicting plugin contribution");
      const resource = registry.register(value, id);
      ids.add(key);
      session.ids.add(key);
      for (const name of names) {
        nodes.add(name);
        session.nodes.add(name);
      }
      let live = true;
      const wrapped = {
        dispose() {
          if (!live) return;
          live = false;
          ids.delete(key);
          session.ids.delete(key);
          for (const name of names) {
            nodes.delete(name);
            session.nodes.delete(name);
          }
          resource.dispose();
        },
      };
      session.resources.push(wrapped);
      return wrapped;
    };
    try {
      const stored = await serializeSettings(id, () => options.settings.get(id));
      if (!active()) return;
      const values: Record<string, PluginSettingValue> = Object.create(null);
      for (const [key, definition] of Object.entries(pkg.settings ?? {}))
        values[key] = isSettingValue(definition, stored[key]) ? stored[key] : definition.default;
      const context: PluginContext = {
        manifest: pkg.manifest,
        signal: session.controller.signal,
        syntax: {
          register(value) {
            const extension = value.markdownExtension;
            const names = [
              ...collectNodes(extension),
              ...Object.keys(value.nodePolicies ?? {}),
              ...(value.nodePolicy ? [value.nodePolicy.nodeName] : []),
            ];
            const uniqueNames = [...new Set(names)];
            const prefix = syntaxNodePrefix(id);
            if (
              uniqueNames.some((name) => !name.startsWith(prefix) || name.length === prefix.length)
            )
              throw new Error(`Syntax nodes must be namespaced by ${prefix}`);
            return register("syntax", options.syntax, value, uniqueNames);
          },
        },
        commands: {
          register: (value) =>
            register("command", options.commands, {
              ...value,
              run: async () => {
                guard();
                await value.run();
              },
            }),
        },
        keymaps: {
          register: (value) => {
            if (!value.commandId.startsWith(`${id}.`))
              throw new Error("Command id must be namespaced");
            return register("keymap", options.keymaps, value);
          },
        },
        editor: {
          getSnapshot: () => {
            guard();
            return options.editor.getSnapshot();
          },
          applyEdit: (edit) => {
            if (!active()) return Promise.resolve({ status: "cancelled" as const });
            return options.editor.applyEdit(edit, session.controller.signal);
          },
        },
        settings: {
          get: () => {
            guard();
            return { ...values };
          },
          async update(patch) {
            guard();
            for (const [key, value] of Object.entries(patch)) {
              const definition = pkg.settings?.[key];
              if (!definition || !isSettingValue(definition, value))
                throw new Error(`Invalid setting: ${key}`);
            }
            await serializeSettings(id, async () => {
              guard();
              const next = { ...values, ...patch };
              await options.settings.update(id, next);
              guard();
              Object.assign(values, next);
            });
          },
        },
        dependencies: options.dependencies,
      };
      session.updateSettings = context.settings.update;
      session.synchronizeSettings = async (incoming) => {
        await serializeSettings(id, () => {
          guard();
          for (const [key, definition] of Object.entries(pkg.settings ?? {}))
            values[key] = isSettingValue(definition, incoming[key])
              ? incoming[key]
              : definition.default;
        });
      };
      if (pkg.styles) session.resources.push(options.styles.mount(id, pkg.styles));
      const module = await (options.loadModule ?? loadModule)(pkg.code);
      if (!active()) return;
      if (!module.default || typeof module.default.activate !== "function")
        throw new Error("Plugin must export a default definition with activate");
      const dispose = await module.default.activate(context);
      if (typeof dispose === "function") {
        if (active()) session.resources.push({ dispose });
        else {
          try {
            dispose();
          } catch {
            /* Activation finished after cancellation. */
          }
        }
      }
      if (active()) publish({ id, status: "active" });
    } catch (error) {
      if (!active()) return;
      sessions.delete(id);
      cleanup(session);
      publish({
        id,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  return {
    enable,
    disable,
    async synchronizeSettings(id: string, values: Readonly<Record<string, PluginSettingValue>>) {
      const synchronize = sessions.get(id)?.synchronizeSettings;
      if (!synchronize) throw new Error("Plugin is not ready");
      await synchronize(values);
    },
    async updateSettings(id: string, patch: Readonly<Record<string, PluginSettingValue>>) {
      const update = sessions.get(id)?.updateSettings;
      if (!update) throw new Error("Plugin is not ready");
      await update(patch);
    },
    getStatuses: (): readonly PluginStatus[] => [...statuses.values()],
    subscribe(listener: () => void): Disposable {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    dispose() {
      if (disposed) return;
      for (const id of sessions.keys()) disable(id);
      disposed = true;
      listeners.clear();
    },
  };
}
