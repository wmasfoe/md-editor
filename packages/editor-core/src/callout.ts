import type { CalloutNode, RawFragment } from "./content.ts";

export type CalloutTone = "info" | "warning" | "success" | "danger";

export interface CalloutExtensionAdapter {
  readonly name: string;
  readonly canRepresentCalloutNode: boolean;
  readonly canSerializeCalloutNode: boolean;
}

export type CalloutExtensionSmokeResult =
  | {
      readonly status: "passed";
      readonly adapterName: string;
    }
  | {
      readonly status: "blocked";
      readonly blocker: string;
    };

export function parseCalloutFragment(fragment: RawFragment): CalloutNode | undefined {
  if (fragment.kind !== "registeredMdxComponent") {
    return undefined;
  }

  const match = fragment.rawSource.match(
    /^\s*<Callout(?<props>[^>]*)>(?<children>[^]*)<\/Callout>\s*$/,
  );
  const selfClosingMatch = fragment.rawSource.match(
    /^\s*<Callout(?<props>[^>]*)\/>\s*$/,
  );
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

export function smokeCalloutExtension(
  adapter?: CalloutExtensionAdapter,
): CalloutExtensionSmokeResult {
  if (adapter === undefined) {
    return {
      status: "blocked",
      blocker:
        "No editor extension adapter is installed in this M0 harness; real Milkdown/ProseMirror Callout extension smoke must run after editor package APIs are available.",
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

  return props;
}

function serializeCalloutProps(props: Readonly<Record<string, string>>): string {
  const entries = Object.entries(props);

  if (entries.length === 0) {
    return "";
  }

  return ` ${entries
    .map(([name, value]) => `${name}="${value.replace(/"/g, "&quot;")}"`)
    .join(" ")}`;
}
