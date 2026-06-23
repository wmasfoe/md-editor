export type MdxPropType = "string" | "number" | "boolean" | "enum" | "markdown";

export interface MdxPropDescriptor {
  readonly name: string;
  readonly type: MdxPropType;
  readonly required?: boolean;
  readonly values?: readonly string[];
}

export interface MdxComponentDescriptor {
  readonly name: string;
  readonly displayName: string;
  readonly importName?: string;
  readonly packageName?: string;
  readonly props: readonly MdxPropDescriptor[];
  readonly acceptsChildren: boolean;
  readonly version: string;
}

export interface MdxInsertDefinition {
  readonly label: string;
  readonly description?: string;
  readonly keywords: readonly string[];
  readonly group?: string;
  createSnippet(): string;
}

export interface MdxComponentPlugin {
  readonly id: string;
  readonly component: MdxComponentDescriptor;
  readonly insert?: MdxInsertDefinition;
}

export interface MdxComponentRegistry {
  register(plugin: MdxComponentPlugin): void;
  registerMany(plugins: readonly MdxComponentPlugin[]): void;
  unregister(id: string): boolean;
  getById(id: string): MdxComponentPlugin | undefined;
  getByComponentName(name: string): MdxComponentPlugin | undefined;
  list(): readonly MdxComponentPlugin[];
  listInsertable(): readonly MdxComponentPlugin[];
}

export type MDXComponentRegistry = MdxComponentRegistry;

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
