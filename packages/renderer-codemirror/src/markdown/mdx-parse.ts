import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxJsxFromMarkdown } from "mdast-util-mdx-jsx";
import { mdxJsx as mdxJsxMicromark } from "micromark-extension-mdx-jsx";
import { mdxMd } from "micromark-extension-mdx-md";

/**
 * MDX JSX 元素(源码范围 + 属性 + children 边界)。
 * 解析来自 micromark 无 acorn 模式:JSX 标签纯文法解析,不执行/解析
 * JavaScript 表达式。含表达式、事件属性、import/export 的输入会整体
 * 降级为普通文本(见 G005 攻击向量 A1-A6),非法嵌套抛错被捕获返回空。
 */
export interface MdxJsxAttribute {
  readonly name: string;
  readonly value: string;
}

export interface MdxJsxElement {
  /** 组件名(不含命名空间/泛型部分;无 acorn 模式只出现纯标识符) */
  readonly name: string;
  /** 整段 JSX 源码范围(含开/闭标签与 children) */
  readonly from: number;
  readonly to: number;
  readonly selfClosing: boolean;
  readonly attributes: readonly MdxJsxAttribute[];
  /** children 源码范围(开标签之后、闭标签之前);无 children 时为 -1 */
  readonly childrenFrom: number;
  readonly childrenTo: number;
  /** 嵌套子元素(递归,按源码顺序) */
  readonly children: readonly MdxJsxElement[];
  /** 恒为 undefined:无 acorn 模式不产生 estree,字段仅用于断言 */
  readonly estree?: unknown;
}

interface MdxAstNode {
  type?: string;
  name?: string;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
  attributes?: readonly {
    type?: string;
    name?: string;
    value?: unknown;
  }[];
  children?: readonly MdxAstNode[];
  data?: { estree?: unknown };
  value?: string;
}

/**
 * MDX 组件名判定:只接受大写开头的标识符。
 * 小写标签(<script>/<div>)是 HTML 元素,走 M4 HTML 路径,
 * 不进入组件白名单,避免 `<script>` 等被当作组件求值。
 */
const COMPONENT_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

/** children 文本是否整体是 JSX 表达式(形如 {…},无 acorn 模式下降级为字面文本) */
function isWholeExpressionText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= 2 && trimmed.startsWith("{") && trimmed.endsWith("}");
}

/** 源码中的 JSX 组件元素列表(深度优先,块级 + 行内)。解析失败返回空数组。 */
export function parseMdxJsxElements(source: string): readonly MdxJsxElement[] {
  let root: MdxAstNode;
  try {
    root = fromMarkdown(source, {
      extensions: [mdxJsxMicromark(), mdxMd()],
      mdastExtensions: [mdxJsxFromMarkdown()],
    }) as MdxAstNode;
  } catch {
    // 非法嵌套/未闭合标签:保持源码,不产生组件节点(fail-closed)
    return [];
  }
  const elements: MdxJsxElement[] = [];
  collect(root, elements);
  return elements;
}

function collect(node: MdxAstNode, out: MdxJsxElement[]): void {
  if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
    const element = toElement(node);
    if (element) {
      out.push(element);
    }
  }
  for (const child of node.children ?? []) {
    collect(child, out);
  }
}

function toElement(node: MdxAstNode): MdxJsxElement | null {
  const name = node.name;
  const from = node.position?.start?.offset;
  const to = node.position?.end?.offset;
  // 仅大写开头的组件名进入白名单求值;小写标签(script/div 等)走 HTML 路径
  if (!name || !COMPONENT_NAME_PATTERN.test(name) || from === undefined || to === undefined) {
    return null;
  }
  const attributes: MdxJsxAttribute[] = [];
  for (const attribute of node.attributes ?? []) {
    if (attribute.type !== "mdxJsxAttribute" || typeof attribute.name !== "string") {
      continue;
    }
    // 无 acorn 模式下字符串字面量是唯一可确定的值。表达式属性(值为
    // mdxJsxAttributeValueExpression 对象)无法求值——按 fail-closed 丢弃元素。
    if (typeof attribute.value !== "string") {
      return null;
    }
    attributes.push({ name: attribute.name, value: attribute.value });
  }
  const children = (node.children ?? []).filter(
    (child) =>
      child.position?.start?.offset !== undefined && child.position?.end?.offset !== undefined,
  );
  // children 整体是表达式(<Callout>{expr}</Callout>)→ 无 acorn 下降级为
  // 字面文本,渲染无意义,按 fail-closed 丢弃元素保持源码。
  if (children.some((child) => child.type === "text" && isWholeExpressionText(child.value ?? ""))) {
    return null;
  }
  const childrenFrom = children[0]?.position?.start?.offset ?? -1;
  const lastChild = children[children.length - 1];
  const childrenTo = lastChild?.position?.end?.offset ?? -1;
  const childElements: MdxJsxElement[] = [];
  for (const child of children) {
    collect(child, childElements);
  }
  return {
    name,
    from,
    to,
    selfClosing: children.length === 0,
    attributes,
    childrenFrom,
    childrenTo,
    children: childElements,
  };
}
