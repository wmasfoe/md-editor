import { describe, expect, it, vi } from "vitest";
import type { PluginContext, PluginDefinition, PluginPackage } from "@md-editor/plugin-sdk";
import {
  createPluginHost,
  syntaxNodePrefix,
  validateCatalog,
  validatePluginPackage,
} from "../src/index.ts";

const pkg: PluginPackage = {
  manifest: {
    id: "test.plugin",
    name: "Test",
    version: "1.0.0",
    description: "Test plugin",
    apiVersion: 1,
  },
  code: "export default {}",
  examples: [],
  settings: { enabled: { type: "boolean", label: "Enabled", default: true } },
};
function setup(activate: PluginDefinition["activate"]) {
  const dispose = vi.fn();
  const register = vi.fn(() => ({ dispose }));
  const applyEdit = vi.fn(async () => ({ status: "applied" as const }));
  const host = createPluginHost({
    syntax: { register },
    commands: { register },
    keymaps: { register },
    editor: {
      getSnapshot: () => ({
        markdown: "",
        selection: { anchor: 0, head: 0 },
        documentGeneration: 1,
        contentRevision: 1,
      }),
      applyEdit,
    },
    dependencies: {} as PluginContext["dependencies"],
    settings: { get: () => ({}), update: async () => {} },
    styles: { mount: () => ({ dispose }) },
    loadModule: async () => ({ default: { activate } }),
  });
  return { host, register, dispose, applyEdit };
}

describe("plugin host", () => {
  it("cleans up asynchronous activation after disable and guards retained context", async () => {
    let context!: PluginContext;
    let finish!: (value: () => void) => void;
    const returnedCleanup = vi.fn();
    const { host, dispose, applyEdit } = setup((ctx) => {
      context = ctx;
      ctx.commands.register({ id: "test.plugin.command", title: "Command", run() {} });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const loading = host.enable(pkg);
    await vi.waitFor(() => expect(finish).toBeDefined());
    host.disable(pkg.manifest.id);
    finish(returnedCleanup);
    await loading;
    expect(dispose).toHaveBeenCalledOnce();
    expect(returnedCleanup).toHaveBeenCalledOnce();
    expect(context.signal.aborted).toBe(true);
    expect(
      await context.editor.applyEdit({
        markdown: "x",
        expectedGeneration: 1,
        expectedContentRevision: 1,
      }),
    ).toEqual({ status: "cancelled" });
    expect(applyEdit).not.toHaveBeenCalled();
    expect(() =>
      context.commands.register({ id: "test.plugin.other", title: "Other", run() {} }),
    ).toThrow("Plugin is disabled");
    expect(host.getStatuses()[0]?.status).toBe("disabled");
  });
  it("rejects conflicts and cleans registrations when activation fails", async () => {
    const { host, dispose } = setup((ctx) => {
      ctx.commands.register({ id: "test.plugin.same", title: "One", run() {} });
      ctx.commands.register({ id: "test.plugin.same", title: "Two", run() {} });
    });
    await expect(host.enable(pkg)).rejects.toThrow("Conflicting");
    expect(dispose).toHaveBeenCalledOnce();
    expect(host.getStatuses()[0]?.status).toBe("error");
  });
  it("continues cleanup after a disposable throws", async () => {
    const cleanup = vi.fn();
    const { host } = setup((ctx) => {
      ctx.commands.register({ id: "test.plugin.command", title: "Command", run() {} });
      return () => {
        cleanup();
        throw new Error("cleanup");
      };
    });
    await host.enable(pkg);
    expect(() => host.disable(pkg.manifest.id)).not.toThrow();
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it("derives distinct node prefixes for IDs that previously collided", () => {
    expect(syntaxNodePrefix("author.weekly")).toBe("AuthorWeekly_");
    expect(syntaxNodePrefix("my-org.tool")).toBe("My_OrgTool_");
    // `a.b` and `a-b` used to both map to `AB`.
    expect(syntaxNodePrefix("a.b")).not.toBe(syntaxNodePrefix("a-b"));
    // `owner.plugin`'s prefix used to also be a prefix of `owner.pluginx`'s.
    expect(syntaxNodePrefix("owner.pluginx").startsWith(syntaxNodePrefix("owner.plugin"))).toBe(
      false,
    );
  });
  it("rejects a node that borrows a neighbouring plugin's namespace", async () => {
    const { host } = setup((ctx) => {
      ctx.syntax.register({
        id: "test.plugin.syntax",
        name: "Syntax",
        // Valid for `test.pluginx`, so it must not be accepted for `test.plugin`.
        nodePolicy: { nodeName: "TestPluginx_Node", kind: "raw-fallback", isBlock: false },
      });
    });
    await expect(host.enable(pkg)).rejects.toThrow(
      "Syntax nodes must be namespaced by TestPlugin_",
    );
  });
  it("accepts nodes under the plugin's own prefix", async () => {
    const { host, register } = setup((ctx) => {
      ctx.syntax.register({
        id: "test.plugin.syntax",
        name: "Syntax",
        nodePolicy: { nodeName: "TestPlugin_Node", kind: "raw-fallback", isBlock: false },
      });
    });
    await host.enable(pkg);
    expect(register).toHaveBeenCalled();
  });
  it("rejects unnamespaced nodes in nested syntax configuration", async () => {
    const { host } = setup((ctx) => {
      ctx.syntax.register({
        id: "test.plugin.syntax",
        name: "Syntax",
        markdownExtension: [{ defineNodes: ["Unrelated"] }] as never,
      });
    });
    await expect(host.enable(pkg)).rejects.toThrow("Syntax nodes must be namespaced");
  });
  it("serializes concurrent setting patches and retains reserved keys", async () => {
    let context!: PluginContext;
    const { host } = setup((ctx) => {
      context = ctx;
    });
    const settings = JSON.parse(
      '{"__proto__":{"type":"string","label":"Special","default":"original"},"enabled":{"type":"boolean","label":"Enabled","default":true}}',
    );
    await host.enable({ ...pkg, settings });
    await Promise.all([
      context.settings.update({ enabled: false }),
      context.settings.update(JSON.parse('{"__proto__":"updated"}')),
    ]);
    expect(context.settings.get()).toEqual({ enabled: false, ["__proto__"]: "updated" });
  });
  it("synchronizes external settings without persisting and resets missing values", async () => {
    let context!: PluginContext;
    const { host } = setup((ctx) => {
      context = ctx;
    });
    await host.enable(pkg);
    await host.updateSettings(pkg.manifest.id, { enabled: false });
    await host.synchronizeSettings(pkg.manifest.id, { unknown: "ignored" });
    expect(context.settings.get()).toEqual({ enabled: true });
  });
  it("waits for an old persistence operation before re-enabling", async () => {
    let context!: PluginContext;
    let complete!: () => void;
    let persisted = { enabled: true };
    const host = createPluginHost({
      syntax: { register: () => ({ dispose() {} }) },
      commands: { register: () => ({ dispose() {} }) },
      keymaps: { register: () => ({ dispose() {} }) },
      editor: {
        getSnapshot: () => ({
          markdown: "",
          selection: { anchor: 0, head: 0 },
          documentGeneration: 1,
          contentRevision: 1,
        }),
        applyEdit: async () => ({ status: "applied" }),
      },
      dependencies: {} as PluginContext["dependencies"],
      settings: {
        get: () => persisted,
        update: async (_id, values) => {
          await new Promise<void>((resolve) => {
            complete = resolve;
          });
          persisted = values as typeof persisted;
        },
      },
      styles: { mount: () => ({ dispose() {} }) },
      loadModule: async () => ({
        default: {
          activate(ctx) {
            context = ctx;
          },
        },
      }),
    });
    await host.enable(pkg);
    const update = context.settings.update({ enabled: false });
    await vi.waitFor(() => expect(complete).toBeDefined());
    host.disable(pkg.manifest.id);
    const enabling = host.enable(pkg);
    complete();
    await expect(update).rejects.toThrow("Plugin is disabled");
    await enabling;
    expect(context.settings.get().enabled).toBe(false);
  });
  it("validates settings and package metadata", () => {
    const entry = { ...pkg.manifest, asset: "plugin.json" };
    expect(validateCatalog({ schemaVersion: 1, plugins: [entry] }).plugins).toHaveLength(1);
    expect(() => validateCatalog({ schemaVersion: 1, plugins: [entry, entry] })).toThrow(
      "Invalid or duplicate catalog entry",
    );
    expect(() =>
      validatePluginPackage({
        ...pkg,
        settings: { enabled: { type: "boolean", label: "Enabled", default: "yes" } },
      }),
    ).toThrow("Invalid plugin setting default");
    expect(() => validatePluginPackage(pkg, { ...entry, version: "2" })).toThrow(
      "Plugin manifest does not match catalog",
    );
  });
});
