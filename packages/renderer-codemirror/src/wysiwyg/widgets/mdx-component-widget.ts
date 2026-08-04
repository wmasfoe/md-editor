import { WidgetType, type EditorView } from "@codemirror/view";
import { selectWysiwygAtom } from "../atom-selection.ts";

export interface MdxComponentWidgetValue {
  /** 所属 record id(原子选中/数据回写) */
  readonly recordId: string;
  /** registry 匹配到的组件展示名(未注册组件为 null → 占位) */
  readonly descriptor: { readonly displayName: string } | null;
  readonly componentName: string;
  /** 解析出的字符串属性(表达式属性已在解析层丢弃) */
  readonly attributes: readonly { readonly name: string; readonly value: string }[];
  /** children 源码预览(渲染为纯文本,不执行任何内容) */
  readonly childrenSource: string;
  readonly selected: boolean;
}

/**
 * MDX 组件 Widget。渲染层禁 innerHTML:所有内容通过 createElement +
 * textContent 构建,组件只做结构化展示(描述符信息 + 属性 + children
 * 源码预览),不执行组件代码,不引入 React 运行时。
 */
function preventWidgetSelection(event: Event): void {
  event.preventDefault();
}

export class MdxComponentWidget extends WidgetType {
  readonly value: MdxComponentWidgetValue;

  constructor(value: MdxComponentWidgetValue) {
    super();
    this.value = value;
  }

  override eq(other: MdxComponentWidget): boolean {
    return (
      other.value.recordId === this.value.recordId &&
      other.value.descriptor === this.value.descriptor &&
      other.value.componentName === this.value.componentName &&
      other.value.attributes === this.value.attributes &&
      other.value.childrenSource === this.value.childrenSource &&
      other.value.selected === this.value.selected
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const { descriptor, componentName, attributes, childrenSource, selected, recordId } =
      this.value;
    const root = document.createElement("div");
    root.className = "cm-md-mdx-widget" + (selected ? " cm-md-mdx-widget--selected" : "");
    root.dataset.recordId = recordId;
    root.setAttribute("role", "group");
    root.setAttribute("tabindex", "-1");
    root.setAttribute("aria-label", `${componentName} component`);
    root.setAttribute("aria-selected", String(selected));
    // 原子选中:点击组件块选中整块(与 HTML/table widget 同语义)
    const click = (event: Event): void => {
      const mouseEvent = event as MouseEvent;
      selectWysiwygAtom(
        view,
        root.dataset.recordId ?? "",
        mouseEvent.metaKey || mouseEvent.ctrlKey,
      );
    };
    root.addEventListener("pointerdown", preventWidgetSelection);
    root.addEventListener("click", click);
    this.#cleanup = () => {
      root.removeEventListener("pointerdown", preventWidgetSelection);
      root.removeEventListener("click", click);
    };

    const header = document.createElement("div");
    header.className = "cm-md-mdx-widget__header";
    const name = document.createElement("strong");
    name.textContent = descriptor?.displayName ?? componentName;
    header.appendChild(name);
    if (!descriptor) {
      const badge = document.createElement("span");
      badge.className = "cm-md-mdx-widget__badge";
      badge.textContent = "未注册组件";
      header.appendChild(badge);
    }
    root.appendChild(header);

    if (attributes.length > 0) {
      const list = document.createElement("dl");
      list.className = "cm-md-mdx-widget__props";
      for (const attribute of attributes) {
        const term = document.createElement("dt");
        term.textContent = attribute.name;
        const value = document.createElement("dd");
        value.textContent = attribute.value;
        list.append(term, value);
      }
      root.appendChild(list);
    }

    if (childrenSource) {
      const children = document.createElement("pre");
      children.className = "cm-md-mdx-widget__children";
      // textContent:children 源码仅作预览,不解析为 HTML
      children.textContent = childrenSource;
      root.appendChild(children);
    }
    return root;
  }

  #cleanup: (() => void) | null = null;

  override destroy(): void {
    this.#cleanup?.();
    this.#cleanup = null;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}
