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
