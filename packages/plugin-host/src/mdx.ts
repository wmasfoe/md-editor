import type {
  MdxComponentDescriptor,
  MdxComponentPlugin,
  MdxComponentRegistry,
} from "@md-editor/plugin-sdk/mdx";

export function createMdxComponentRegistry(
  plugins: readonly MdxComponentPlugin[] = [],
): MdxComponentRegistry {
  // 这里只登记静态 metadata，不 import 或执行任何组件代码。
  // 真实 React 组件由 @md-editor/mdx-plugins 面向博客/业务侧导出。
  const entriesById = new Map<string, MdxComponentPlugin>();
  const idsByComponentName = new Map<string, string>();

  const add = (plugin: MdxComponentPlugin) => {
    if (entriesById.has(plugin.id)) {
      throw new Error(`MDX component plugin already registered: ${plugin.id}`);
    }
    if (idsByComponentName.has(plugin.component.name)) {
      throw new Error(`MDX component already registered: ${plugin.component.name}`);
    }
    entriesById.set(plugin.id, plugin);
    idsByComponentName.set(plugin.component.name, plugin.id);
  };

  plugins.forEach(add);

  return {
    register(plugin) {
      add(plugin);
    },
    registerMany(nextPlugins) {
      nextPlugins.forEach(add);
    },
    unregister(id) {
      const plugin = entriesById.get(id);
      if (!plugin) {
        return false;
      }
      entriesById.delete(id);
      idsByComponentName.delete(plugin.component.name);
      return true;
    },
    getById(id) {
      return entriesById.get(id);
    },
    getByComponentName(name) {
      const id = idsByComponentName.get(name);
      return id ? entriesById.get(id) : undefined;
    },
    list() {
      return [...entriesById.values()];
    },
    listInsertable() {
      return [...entriesById.values()].filter((plugin) => plugin.insert !== undefined);
    },
  };
}

export function createBuiltInMdxRegistry(
  plugins: readonly MdxComponentPlugin[] = [],
): MdxComponentRegistry {
  return createMdxComponentRegistry(plugins);
}

export function componentPluginFromDescriptor(
  descriptor: MdxComponentDescriptor,
): MdxComponentPlugin {
  return {
    id: `mdx.${descriptor.name}`,
    component: descriptor,
  };
}
