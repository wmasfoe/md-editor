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
  readonly importPath?: string;
  readonly props: readonly MdxPropDescriptor[];
  readonly acceptsChildren: boolean;
  readonly version: string;
}

export interface MDXComponentRegistry {
  register(descriptor: MdxComponentDescriptor): void;
  unregister(name: string): boolean;
  get(name: string): MdxComponentDescriptor | undefined;
  list(): readonly MdxComponentDescriptor[];
}

export function createMdxComponentRegistry(
  descriptors: readonly MdxComponentDescriptor[] = []
): MDXComponentRegistry {
  // v0.1 只做编译期登记：descriptor 用来描述未来可编辑组件，
  // 但这里不会执行 import，也不会运行第三方代码。
  const entries = new Map<string, MdxComponentDescriptor>();

  for (const descriptor of descriptors) {
    entries.set(descriptor.name, descriptor);
  }

  return {
    register(descriptor) {
      if (entries.has(descriptor.name)) {
        throw new Error(`MDX component already registered: ${descriptor.name}`);
      }
      entries.set(descriptor.name, descriptor);
    },
    unregister(name) {
      return entries.delete(name);
    },
    get(name) {
      return entries.get(name);
    },
    list() {
      return [...entries.values()];
    }
  };
}

export function createBuiltInMdxRegistry(): MDXComponentRegistry {
  return createMdxComponentRegistry();
}
