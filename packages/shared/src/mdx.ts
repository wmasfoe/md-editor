/**
 * @file mdx.ts
 * @description MDX 组件契约的共享词表（描述符、插件、注册表接口）。
 *
 * 这些类型被三方共同引用：`core`（文档运行时持有注册表）、`plugin-host`（注册表实现）、
 * `plugin-sdk`（插件作者面）。放在 `shared` 的原因是 **core 必须保持无头**：
 * 它不能为了一个类型反向依赖插件 SDK（那会把 CodeMirror/Lezer 的 peer 拖进"只装 core"的消费者）。
 */

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
