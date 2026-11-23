# Using `@md-editor/plugin-host`

Runtime side of the plugin system: validate a package, host it (commands, keymaps, settings,
styles), and wire the GitHub catalog if you distribute plugins. Plugin authors should read
[`@md-editor/plugin-sdk`](../plugin-sdk/USAGE.md) instead.

- [Validate before you run](#validate-before-you-run)
- [Host model](#host-model)
- [Command bindings](#command-bindings)
- [MDX registries](#mdx-registries)
- [GitHub catalog](#github-catalog)
- [API map](#api-map)

## Validate before you run

Plugins arrive as JSON (user files, URLs, the catalog). Validation is structural and size-capped;
it returns a typed package or throws with a specific reason, so you can surface it to the user.

<!-- readme-check -->
```ts
import { validateCatalog, validatePluginPackage } from "@md-editor/plugin-host";

export function readPackage(raw: string) {
  try {
    const parsed: unknown = JSON.parse(raw);
    return { status: "ok" as const, plugin: validatePluginPackage(parsed) };
  } catch (error) {
    return { status: "invalid" as const, message: (error as Error).message };
  }
}

export function readCatalog(raw: string) {
  try {
    return { status: "ok" as const, catalog: validateCatalog(JSON.parse(raw)) };
  } catch (error) {
    return { status: "invalid" as const, message: (error as Error).message };
  }
}
```

| Limit | Export | Applies to |
| --- | --- | --- |
| Package size | `MAX_PACKAGE_BYTES` | A single plugin package. |
| Catalog size | `MAX_CATALOG_BYTES` | The whole catalog document. |
| Setting value | `isSettingValue(definition, value)` | `string` / `number` / `boolean` / `enum` defaults. |

Pass the catalog entry as the second argument (`validatePluginPackage(value, entry)`) and the host
additionally checks that the manifest matches what the catalog advertised — this is what stops a
package from installing under a different name or version.

## Host model

`createPluginHost(options)` is the runtime: it activates plugin modules, tracks their status, keeps
sessions isolated, serializes settings writes per plugin, and tears everything down on unload.

The options object is your platform, injected:

| Option | You provide |
| --- | --- |
| `syntax`, `commands`, `keymaps` | Registry-like objects with `register`/`unregister` for the plugin's contributions. |
| `editor.getSnapshot()` / `editor.applyEdit(edit)` | Reads and writes through your document protocol. |
| `dependencies` | The pinned `@codemirror/state`, `@codemirror/view`, `@lezer/markdown`, `@lezer/common` instances. |
| `settings.get(id)` / `settings.update(id, patch)` | Persistence for plugin settings (sync or async reads). |
| `styles.mount(id, css)` | Injects a plugin's stylesheet; returns a `Disposable`. |
| `loadModule?(code)` | Executes the plugin's code and returns its `default` definition. |

Sketch of the wiring (platform-specific parts omitted):

<!-- readme-check -->
```ts
import { createDocumentState } from "@md-editor/core";
import type { CodeMirrorEditorPorts } from "@md-editor/editor";
import { createPluginHost } from "@md-editor/plugin-host";
import type { PluginEditRequest, PluginEditResult, PluginEditorSnapshot } from "@md-editor/plugin-sdk";

type HostOptions = Parameters<typeof createPluginHost>[0];

// Placeholders for the host's own objects; the sample focuses on the two adapters
// that are easy to get wrong.
declare const docState: ReturnType<typeof createDocumentState>;
declare const ports: CodeMirrorEditorPorts;
declare const syntax: HostOptions["syntax"];
declare const commands: HostOptions["commands"];
declare const keymaps: HostOptions["keymaps"];
declare const dependencies: HostOptions["dependencies"];
declare const styles: HostOptions["styles"];
declare const readSettings: HostOptions["settings"]["get"];
declare const writeSettings: HostOptions["settings"]["update"];
declare const nextOperationId: () => string;

export const host = createPluginHost({
  syntax,
  commands,
  keymaps,
  dependencies,
  editor: {
    // Return the *whole* snapshot. Dropping documentGeneration/contentRevision makes
    // every plugin edit look stale, so applyEdit always fails.
    getSnapshot: (): PluginEditorSnapshot => {
      const snapshot = docState.getSnapshot();
      const selection = ports.getSelectionSnapshot();
      return {
        markdown: snapshot.markdown,
        selection: { anchor: selection.anchor, head: selection.head },
        documentGeneration: snapshot.documentGeneration,
        contentRevision: snapshot.contentRevision,
      };
    },
    // Plugins send full Markdown plus the revisions they expect; hand that to the
    // editor's external-edit protocol and translate the result back.
    applyEdit: async (edit: PluginEditRequest): Promise<PluginEditResult> => {
      const result = ports.applyExternalEdit({
        operationId: nextOperationId(),
        markdown: edit.markdown,
        expectedGeneration: edit.expectedGeneration,
        expectedContentRevision: edit.expectedContentRevision,
        selection: edit.selection ?? "preserve-offset-clamped",
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
          // busy / rejected: the host protocol refused this edit, so it did not apply.
          return { status: "cancelled" };
      }
    },
  },
  settings: { get: readSettings, update: writeSettings },
  styles,
});
```

Hosts that never load third-party code can skip this package entirely.

## Command bindings

Turn a plugin's commands and keymaps into one table your dispatcher can use, with conflicts
reported instead of silently overwritten:

<!-- readme-check -->
```ts
import { createPluginCommandBindings } from "@md-editor/plugin-host";

const noop = () => ({ dispose() {} });

export const bindings = createPluginCommandBindings({
  // 宿主自己的注册表（插件贡献落在这里）
  commands: { register: noop },
  keymaps: { register: noop, findConflict: () => undefined },
  // 用户为某个插件命令选择的按键（commandId → chord）
  getBindings: (pluginId) => (pluginId ? {} : {}),
  validateKey: (key) => (key.trim() === "" ? "empty chord" : null),
  onChange: () => {},
});

export const statuses = bindings.getStatuses();
```

`occupiedKeys` is where you pass chords the app already owns, so a plugin cannot claim `Mod-s` by
accident.

## MDX registries

The MDX entry point maps component descriptors to a registry the editor can render as placeholders.
It records metadata only and never imports or executes component code.

<!-- readme-check -->
```ts
import { createMdxComponentRegistry } from "@md-editor/plugin-host/mdx";

const registry = createMdxComponentRegistry([
  {
    id: "blog.callout",
    component: {
      name: "Callout",
      displayName: "Callout",
      props: [],
      acceptsChildren: true,
      version: "1.0",
    },
  },
]);

console.log(registry.getByComponentName("Callout")?.id, registry.list().length);
```

`createBuiltInMdxRegistry(plugins)` pre-registers a bundled set;
`componentPluginFromDescriptor(descriptor)` adapts a single descriptor.

## GitHub catalog

Distribute plugins through a catalog served from your own origin:

<!-- readme-check -->
```ts
import {
  createPluginInstallUrl,
  createPluginPreviewUrl,
  parsePluginInstallUrl,
} from "@md-editor/plugin-host/github";

const source = {
  owner: "acme",
  repo: "inkpoint-plugins",
  releaseId: 42,
  tag: "demo-v1.0.0",
  assetId: 7,
  pluginId: "acme.demo",
  sha256: "0".repeat(64),
};

const install = createPluginInstallUrl(source);
const parsed = parsePluginInstallUrl(install);
const preview = createPluginPreviewUrl(source);

console.log(install, parsed?.pluginId, preview);
```

`getPluginCatalog(base)` fetches and validates the catalog; `downloadPlugin(source)` fetches one
package through the same validation. Both are thin `fetch` wrappers, so pass your own base URL when
you self-host.

## API map

| Entry | Contents |
| --- | --- |
| `@md-editor/plugin-host` | `createPluginHost`, `createPluginCommandBindings`, `validateCatalog`, `validatePluginPackage`, `isSettingValue`, `MAX_CATALOG_BYTES`, `MAX_PACKAGE_BYTES`, `syntaxNodePrefix`, and the host/status types. |
| `@md-editor/plugin-host/github` | `getPluginCatalog`, `downloadPlugin`, `createPluginInstallUrl`, `createPluginPreviewUrl`, `parsePluginInstallUrl`. |
| `@md-editor/plugin-host/mdx` | `createMdxComponentRegistry`, `createBuiltInMdxRegistry`, `componentPluginFromDescriptor`. |

## Related packages

- [`@md-editor/plugin-sdk`](../plugin-sdk/USAGE.md) — the contract plugins implement.
- [`@md-editor/editor`](../editor/USAGE.md) — where plugin syntax and styles land.
