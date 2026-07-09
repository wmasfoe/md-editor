/**
 * 如果鼠标事件是带修饰键（Cmd/Ctrl）的主键点击，且目标在根元素内的链接上，
 * 返回该链接的 href；否则返回 null。
 */
export function findModifiedPrimaryClickLinkHref(event: MouseEvent, root: HTMLElement): string | null {
  if (!(event.metaKey || event.ctrlKey) || event.button !== 0) {
    return null;
  }

  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest<HTMLAnchorElement>("a[href]") ?? null;
  if (!anchor || !root.contains(anchor)) {
    return null;
  }

  const href = anchor.getAttribute("href")?.trim();
  return href || null;
}
