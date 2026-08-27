import { Facet, Prec, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import type { MarkdownRangeRecord } from "../markdown/range-types.ts";

/**
 * 链接点击交互(对齐竞品 WYSIWYG 编辑器的链接行为,自研实现):
 *
 * - 非 active 链接渲染为真 `<a href>`(label 挂 a 标签 + href + cm-md-link class);
 * - 普通点击:光标移入 label → 链接转为显示源码(reveal);
 * - Cmd/Ctrl+点击 或 Mod-Enter:把 URL 交给宿主回调打开(内部 markdown 文件/外部链接由宿主决策);
 * - modifier 按下时编辑器根挂 data-link-modifier,主题据此显示 pointer 光标;
 * - blur 清理 modifier 状态。
 *
 * 打开动作不在渲染层执行(渲染层不知道内部文件 vs 外部 URL),只回调宿主。
 * URL 必须先过协议白名单(javascript:/data:/vbscript: 等一律拒绝,fail-closed)。
 */

/** 宿主注入的链接打开回调;未注入时点击仅 reveal 源码、不打开 */
export const openLinkTargetFacet = Facet.define<
  ((url: string) => void) | null,
  ((url: string) => void) | null
>({
  combine: (values) => values.at(-1) ?? null,
});

/** 链接可安全打开的 URL 判定:http/https/mailto 协议或相对路径(内部文件链接) */
export function isSafeLinkTarget(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048) {
    return false;
  }
  // 显式协议:只放行常见安全协议
  const protocolMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (protocolMatch) {
    const protocol = protocolMatch[1].toLowerCase();
    return protocol === "http" || protocol === "https" || protocol === "mailto";
  }
  // 无协议前缀 = 相对路径(内部 markdown/资产链接)或锚点,放行
  return !trimmed.startsWith("//");
}

/** 从 record 的 destination segment 提取链接 URL(无则 null) */
export function linkDestinationFromRecord(
  record: MarkdownRangeRecord,
  doc: { sliceString(from: number, to: number): string },
): string | null {
  const destination = record.segments.find((segment) => segment.role === "destination");
  if (!destination) {
    return null;
  }
  const raw = doc.sliceString(destination.from, destination.to).trim();
  // 角括号包裹的 URL(如 <https://example.com>)去掉尖括号
  return raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
}

/**
 * 非 active 链接的 label 装饰:挂 `<a href>`(URL 安全时)+ 链接 class。
 * active(显示源码)时返回空,由调用方保持既有 reveal 行为。
 */
export function buildLinkLabelDecoration(
  record: MarkdownRangeRecord,
  url: string | null,
): Range<Decoration> | null {
  const content = record.contentRange;
  if (!content) {
    return null;
  }
  const safeUrl = url !== null && isSafeLinkTarget(url) ? url : null;
  return Decoration.mark({
    class: "cm-md-link-label cm-md-link" + (safeUrl ? " cm-md-link--openable" : ""),
    ...(safeUrl
      ? {
          tagName: "a",
          attributes: { href: safeUrl, draggable: "false" },
        }
      : {}),
    inclusive: true,
    wysiwygRecordId: record.id,
    wysiwygRole: "link-label",
  }).range(content.from, content.to);
}

/** 光标处的链接(经 selection head 所在 record) */
function linkRecordAtSelection(state: EditorState): MarkdownRangeRecord | null {
  const head = state.selection.main.head;
  const index = state.field(markdownRangeIndexField, false);
  if (!index) {
    return null;
  }
  for (const record of index.records) {
    if (record.kind === "link" && head >= record.fullRange.from && head <= record.fullRange.to) {
      return record;
    }
  }
  return null;
}

/**
 * 打开光标处的链接(Mod-Enter);未命中或 URL 不安全返回 false。
 */
export function openLinkAtCursor(view: EditorView): boolean {
  const record = linkRecordAtSelection(view.state);
  if (!record) {
    return false;
  }
  const url = linkDestinationFromRecord(record, view.state.doc);
  const open = view.state.facet(openLinkTargetFacet);
  if (!url || !isSafeLinkTarget(url) || !open) {
    return false;
  }
  open(url);
  return true;
}

/** reveal:把光标移入链接 label,触发既有 activeSyntaxIds 的源码显示 */
function revealLinkSourceAt(view: EditorView, position: number): boolean {
  const index = view.state.field(markdownRangeIndexField, false);
  if (!index) {
    return false;
  }
  const record = index.records.find(
    (candidate) =>
      candidate.kind === "link" &&
      position >= candidate.fullRange.from &&
      position <= candidate.fullRange.to,
  );
  const content = record?.contentRange;
  if (!record || !content) {
    return false;
  }
  // 光标放到 label 起点右侧(进入 reveal 状态,显示源码)
  view.focus();
  view.dispatch({
    selection: { anchor: Math.min(content.from + 1, content.to) },
    scrollIntoView: true,
  });
  return true;
}

function linkPositionFromEvent(event: MouseEvent, view: EditorView): number | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  const link = target.closest(".cm-md-link");
  if (!link || !view.contentDOM.contains(link)) {
    return null;
  }
  try {
    return view.posAtDOM(link, 0);
  } catch {
    return null;
  }
}

function syncLinkModifierCursor(
  view: EditorView,
  event: Pick<KeyboardEvent | MouseEvent, "ctrlKey" | "metaKey">,
): void {
  if (event.metaKey || event.ctrlKey) {
    view.dom.dataset.linkModifier = "true";
  } else {
    delete view.dom.dataset.linkModifier;
  }
}

/** 链接点击/指针交互扩展(挂在渲染层,打开回调由 facet 注入) */
export const linkInteractionExtension: Extension[] = [
  // Mod-Enter 打开链接需最高优先级:markdown 结构命令组(Prec.highest)注册了
  // 无修饰 "Enter",在部分平台上会把 Ctrl+Enter 一并匹配吞掉,导致打开命令不触发。
  Prec.highest(
    keymap.of([
      {
        key: "Mod-Enter",
        run: (view) => openLinkAtCursor(view),
      },
    ]),
  ),
  EditorView.baseTheme({
    // 普通悬停:默认光标(点击 = reveal 源码);modifier 按下:pointer(可打开)
    ".cm-md-link": { cursor: "default" },
    ".cm-content[data-link-modifier] .cm-md-link": { cursor: "pointer" },
  }),
  EditorView.domEventHandlers({
    blur(_event, view) {
      delete view.dom.dataset.linkModifier;
      return false;
    },
    click(event, view) {
      // 打开动作在 mousedown 完成(Codemirror 移光标前);click 只拦截防止后续默认行为
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".cm-md-link")) {
        return false;
      }
      if (!view.contentDOM.contains(target)) {
        return false;
      }
      event.preventDefault();
      return true;
    },
    keydown(event, view) {
      syncLinkModifierCursor(view, event);
      return false;
    },
    keyup(event, view) {
      syncLinkModifierCursor(view, event);
      return false;
    },
    mousedown(event, view) {
      if (event.button !== 0) {
        return false;
      }
      const position = linkPositionFromEvent(event, view);
      if (position === null) {
        return false;
      }
      const url =
        event.target instanceof Element
          ? event.target.closest(".cm-md-link")?.getAttribute("href")
          : null;
      if (event.metaKey || event.ctrlKey) {
        // modifier 点击:打开链接(URL 已在渲染时过白名单)
        const open = view.state.facet(openLinkTargetFacet);
        if (url && isSafeLinkTarget(url) && open) {
          open(url);
          event.preventDefault();
          return true;
        }
        return false;
      }
      // Shift+点击:完全交给 CM 处理(添加选区);光标移动本身会触发 reveal。
      if (event.shiftKey) {
        return false;
      }
      // 普通点击:reveal 源码(光标进 label)。
      if (!revealLinkSourceAt(view, position)) {
        return false;
      }
      event.preventDefault();
      return true;
    },
    mousemove(event, view) {
      syncLinkModifierCursor(view, event);
      return false;
    },
  }),
];
