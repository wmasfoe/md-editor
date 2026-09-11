/**
 * @fileoverview MDX Callout 提示框组件 AST 解析与序列化协议
 *
 * 规范 <Callout type="..." title="...">...</Callout> 标签在 editor-core 内的保真解析。
 */

import type { CalloutNode, RawFragment } from "./content.ts";

/**
 * 提示框语气类型
 */
export type CalloutTone = "info" | "warning" | "success" | "danger";

/**
 * Callout 组件扩展适配器接口
 */
export interface CalloutExtensionAdapter {
  readonly name: string;
  readonly canRepresentCalloutNode: boolean;
  readonly canSerializeCalloutNode: boolean;
}

/**
 * Callout 扩展探测烟测结果
 */
export type CalloutExtensionSmokeResult =
  | {
      readonly status: "passed";
      readonly adapterName: string;
    }
  | {
      readonly status: "blocked";
      readonly blocker: string;
    };

/**
 * 从保真切片中解析 Callout 结构化节点
 *
 * @param fragment 来源切片
 * @returns 结构化节点，非 Callout 时返回 undefined
 */
export function parseCalloutFragment(fragment: RawFragment): CalloutNode | undefined {
  if (fragment.kind !== "registeredMdxComponent") {
    return undefined;
  }

  const match = fragment.rawSource.match(
    /^\s*<Callout(?<props>[^>]*)>(?<children>[^]*)<\/Callout>\s*$/,
  );
  const selfClosingMatch = fragment.rawSource.match(/^\s*<Callout(?<props>[^>]*)\/>\s*$/);
  const propsSource = match?.groups?.props ?? selfClosingMatch?.groups?.props;

  if (propsSource === undefined) {
    return undefined;
  }

  return {
    type: "callout",
    name: "Callout",
    props: parseCalloutProps(propsSource),
    childrenMarkdown: match?.groups?.children ?? "",
    rawFragmentId: fragment.id,
    dirty: false,
  };
}

/**
 * 标记 Callout 节点已被用户编辑变动
 */
export function markCalloutDirty(
  node: CalloutNode,
  updates: Partial<Pick<CalloutNode, "props" | "childrenMarkdown">>,
): CalloutNode {
  return {
    ...node,
    ...updates,
    dirty: true,
  };
}

/**
 * 将 Callout 节点序列化为 MDX JSX 标签文本
 */
export function serializeCalloutNode(node: CalloutNode, rawFragment?: RawFragment): string {
  if (!node.dirty && rawFragment !== undefined) {
    return rawFragment.rawSource;
  }

  const props = serializeCalloutProps(node.props);

  if (node.childrenMarkdown.length === 0) {
    return `<Callout${props} />`;
  }

  return `<Callout${props}>${node.childrenMarkdown}</Callout>`;
}

/**
 * 烟测验证 Callout 扩展适配器的兼容性
 */
export function smokeCalloutExtension(
  adapter?: CalloutExtensionAdapter,
): CalloutExtensionSmokeResult {
  if (adapter === undefined) {
    return {
      status: "blocked",
      blocker:
        "No CM6 MDX component adapter is installed in this M0 harness; real Callout rendering and serialization smoke remains a beta gap.",
    };
  }

  if (!adapter.canRepresentCalloutNode || !adapter.canSerializeCalloutNode) {
    return {
      status: "blocked",
      blocker: `${adapter.name} cannot represent and serialize the Callout node contract.`,
    };
  }

  return { status: "passed", adapterName: adapter.name };
}

function parseCalloutProps(propsSource: string): Readonly<Record<string, string>> {
  const props: Record<string, string> = {};
  const propPattern = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/g;

  for (const match of propsSource.matchAll(propPattern)) {
    const name = match[1];
    const value = match[2];

    if (name !== undefined && value !== undefined) {
      props[name] = value;
    }
  }

  return Object.freeze(props);
}

function serializeCalloutProps(props: Readonly<Record<string, string>>): string {
  const serialized = Object.entries(props)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");

  return serialized.length === 0 ? "" : ` ${serialized}`;
}
