import type { MermaidWysiwygEditor } from "@visimer/core";
import type { MermaidCanvasView } from "@visimer/dom";

/**
 * Per-node connection handles.
 *
 * Selecting a flowchart node reveals one dot on each edge midpoint. Dragging a
 * dot onto another node creates a connection, which removes the need for a
 * modal "pick source and target" form or a toolbar mode the user has to enter
 * and leave.
 *
 * The geometry lives here rather than in the pinned upstream package because
 * the host already owns the canvas container, the selection model and the
 * semantic `connect` operation. Keeping it local avoids another vendored patch
 * for behaviour that is presentation-only.
 */

/** Handle sides in visual order (used for keyboard/Tab order too). */
const HANDLE_SIDES = ["top", "right", "bottom", "left"] as const;
type HandleSide = (typeof HANDLE_SIDES)[number];

/** Below this pointer travel a press is treated as a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;

export interface ConnectHandleOptions {
  /** Canvas view that owns the rendered SVG and its pan/zoom transform. */
  readonly view: MermaidCanvasView;
  readonly editor: MermaidWysiwygEditor;
  /** The `.mw-canvas` element; handles are positioned against its padding box. */
  readonly container: HTMLElement;
}

export interface ConnectHandleController {
  destroy(): void;
  /** Recompute handle positions from the current selection and SVG layout. */
  refresh(): void;
}

interface DragState {
  readonly source: string;
  readonly pointerId: number;
  readonly origin: { readonly x: number; readonly y: number };
  moved: boolean;
}

/** Node id of the single selected flowchart node, or null when the handles must hide. */
function selectedNodeId(editor: MermaidWysiwygEditor): string | null {
  if (editor.selection.length !== 1) return null;
  const [only] = editor.selection;
  return only?.startsWith("node:") ? only.slice(5) : null;
}

export function installConnectHandles(options: ConnectHandleOptions): ConnectHandleController {
  const { view, editor, container } = options;
  const doc = container.ownerDocument;

  const layer = doc.createElement("div");
  layer.className = "mw-connect-handles";
  // Ghost line shares the handle layer so both stay clipped to the canvas.
  const ghost = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  ghost.classList.add("mw-connect-ghost");
  ghost.setAttribute("aria-hidden", "true");
  const ghostLine = doc.createElementNS("http://www.w3.org/2000/svg", "line");
  ghost.append(ghostLine);
  layer.append(ghost);
  container.append(layer);

  let drag: DragState | null = null;
  let frame = 0;
  let destroyed = false;

  /** Container-relative position of a client point (accounts for scroll and pan). */
  const toCanvasPoint = (clientX: number, clientY: number) => {
    const box = container.getBoundingClientRect();
    return {
      x: clientX - box.left + container.scrollLeft,
      y: clientY - box.top + container.scrollTop,
    };
  };

  const nodeElement = (nodeId: string): Element | null =>
    container.querySelector(`[data-mw-entity="${CSS.escape(`node:${nodeId}`)}"]`);

  const isReadOnly = (): boolean => container.classList.contains("mw-readonly");

  let snapHighlighted: Element | null = null;

  /** Marks the node the ghost line is currently snapped to. */
  const setSnapHighlight = (element: Element | null): void => {
    if (snapHighlighted === element) return;
    snapHighlighted?.classList.remove("mw-connect-snap-target");
    snapHighlighted = element;
    snapHighlighted?.classList.add("mw-connect-snap-target");
  };

  const hideGhost = (): void => {
    ghostLine.removeAttribute("x1");
    ghostLine.removeAttribute("y1");
    ghostLine.removeAttribute("x2");
    ghostLine.removeAttribute("y2");
    ghost.classList.remove("mw-connect-ghost--active", "mw-connect-ghost--snapped");
    setSnapHighlight(null);
  };

  /**
   * Resolve the node the pointer would connect to, plus the point on that node's
   * border the ghost line should terminate at.
   *
   * Snapping to the border rather than the centre keeps the preview visually
   * attached to the shape and tells the user the drop will land on that node.
   */
  const snapTarget = (
    clientX: number,
    clientY: number,
    source: string,
  ): { readonly x: number; readonly y: number; readonly element: Element } | null => {
    const targetId = nodeAtPoint(clientX, clientY);
    if (!targetId || targetId === source) return null;
    const element = nodeElement(targetId);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return null;
    // Clamp the pointer to the node's box, then pull it onto the nearest edge so
    // the preview line stops at the shape instead of piercing it.
    const localX = Math.min(Math.max(clientX, box.left), box.left + box.width);
    const localY = Math.min(Math.max(clientY, box.top), box.top + box.height);
    const distances = [
      { edge: "left", value: Math.abs(localX - box.left), x: box.left, y: localY },
      {
        edge: "right",
        value: Math.abs(localX - (box.left + box.width)),
        x: box.left + box.width,
        y: localY,
      },
      { edge: "top", value: Math.abs(localY - box.top), x: localX, y: box.top },
      {
        edge: "bottom",
        value: Math.abs(localY - (box.top + box.height)),
        x: localX,
        y: box.top + box.height,
      },
    ];
    distances.sort((left, right) => left.value - right.value);
    const nearest = distances[0]!;
    const point = toCanvasPoint(nearest.x, nearest.y);
    return { x: point.x, y: point.y, element };
  };

  /** Node id under a client point, ignoring the handle layer itself. */
  const nodeAtPoint = (clientX: number, clientY: number): string | null => {
    // Not every DOM implementation provides hit testing (jsdom, some embedded
    // WebViews). Treat "cannot hit test" as "no target" so the gesture cancels
    // instead of throwing mid-drag.
    if (typeof doc.elementFromPoint !== "function") return null;
    const hit = doc.elementFromPoint(clientX, clientY);
    const entity = hit?.closest?.("[data-mw-entity]")?.getAttribute("data-mw-entity");
    return entity?.startsWith("node:") ? entity.slice(5) : null;
  };

  const clearHandles = (): void => {
    for (const handle of layer.querySelectorAll(".mw-connect-handle")) handle.remove();
  };

  const placeHandles = (nodeId: string, element: Element): void => {
    const nodeBox = element.getBoundingClientRect();
    if (nodeBox.width === 0 && nodeBox.height === 0) return;
    const origin = toCanvasPoint(nodeBox.left, nodeBox.top);
    const anchors: Record<HandleSide, { x: number; y: number }> = {
      top: { x: origin.x + nodeBox.width / 2, y: origin.y },
      right: { x: origin.x + nodeBox.width, y: origin.y + nodeBox.height / 2 },
      bottom: { x: origin.x + nodeBox.width / 2, y: origin.y + nodeBox.height },
      left: { x: origin.x, y: origin.y + nodeBox.height / 2 },
    };
    for (const side of HANDLE_SIDES) {
      const handle = doc.createElement("button");
      handle.type = "button";
      handle.className = `mw-connect-handle mw-connect-handle--${side}`;
      handle.dataset.side = side;
      handle.dataset.source = nodeId;
      // The canvas is a host-owned dialog surface, so these stay keyboard reachable.
      handle.setAttribute("aria-label", `从节点 ${nodeId} 拖出连线`);
      handle.title = "拖到另一个节点以连接";
      const { x, y } = anchors[side];
      handle.style.left = `${x}px`;
      handle.style.top = `${y}px`;
      layer.append(handle);
    }
  };

  const refresh = (): void => {
    if (destroyed) return;
    // A drag owns the ghost line and the current handle positions. Observers fire
    // during the gesture (pan/zoom transform, resize, selection repaint), so an
    // unconditional repaint here would wipe the ghost mid-drag.
    if (drag) return;
    clearHandles();
    hideGhost();
    if (isReadOnly()) return;
    const nodeId = selectedNodeId(editor);
    if (!nodeId) return;
    const element = nodeElement(nodeId);
    if (!element) return;
    placeHandles(nodeId, element);
  };

  /** Coalesce bursts (scroll, pan/zoom, resize) into one layout pass. */
  const scheduleRefresh = (): void => {
    if (destroyed || frame) return;
    const schedule =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (fn: FrameRequestCallback) => setTimeout(fn, 16) as unknown as number;
    frame = schedule(() => {
      frame = 0;
      refresh();
    });
  };

  const finishDrag = (): void => {
    drag = null;
    layer.classList.remove("mw-connect-handles--dragging");
    hideGhost();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = toCanvasPoint(event.clientX, event.clientY);
    if (
      !drag.moved &&
      Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) < DRAG_THRESHOLD_PX
    )
      return;
    drag.moved = true;
    layer.classList.add("mw-connect-handles--dragging");
    ghost.classList.add("mw-connect-ghost--active");
    ghostLine.setAttribute("x1", String(drag.origin.x));
    ghostLine.setAttribute("y1", String(drag.origin.y));
    // Snap the preview onto the node under the pointer so the user sees exactly
    // which node the edge will attach to before releasing.
    const snap = snapTarget(event.clientX, event.clientY, drag.source);
    if (snap) {
      ghostLine.setAttribute("x2", String(snap.x));
      ghostLine.setAttribute("y2", String(snap.y));
      ghost.classList.add("mw-connect-ghost--snapped");
      setSnapHighlight(snap.element);
    } else {
      ghostLine.setAttribute("x2", String(point.x));
      ghostLine.setAttribute("y2", String(point.y));
      ghost.classList.remove("mw-connect-ghost--snapped");
      setSnapHighlight(null);
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { source, moved } = drag;
    finishDrag();
    if (!moved) {
      // A press without travel is just a click on the dot: keep the selection.
      refresh();
      return;
    }
    const target = nodeAtPoint(event.clientX, event.clientY);
    if (!target || target === source) {
      // Dropping on empty canvas cancels the gesture and restores the handles.
      refresh();
      return;
    }
    editor.dispatch({ type: "connect", source, target });
    refresh();
  };

  const onPointerCancel = (): void => {
    if (!drag) return;
    finishDrag();
    refresh();
  };

  const onLayerPointerDown = (event: PointerEvent): void => {
    const handle = (event.target as Element | null)?.closest?.<HTMLElement>(".mw-connect-handle");
    if (!handle) return;
    const source = handle.dataset.source;
    if (!source || isReadOnly()) return;
    // Keep the press off the SVG so the upstream canvas does not treat it as a
    // node press, and keep the existing selection (the drag starts from it).
    event.preventDefault();
    event.stopPropagation();
    const box = handle.getBoundingClientRect();
    drag = {
      source,
      pointerId: event.pointerId,
      origin: toCanvasPoint(box.left + box.width / 2, box.top + box.height / 2),
      moved: false,
    };
    handle.setPointerCapture?.(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !drag) return;
    event.preventDefault();
    event.stopPropagation();
    finishDrag();
    refresh();
  };

  const onScrollOrResize = (): void => scheduleRefresh();

  // A pan/zoom writes a transform on the SVG (or a group inside it), so handle
  // positions have to follow it the same way the entity popover does.
  let transformObserver: MutationObserver | null = null;
  const MutationObserverConstructor = doc.defaultView?.MutationObserver;
  if (MutationObserverConstructor) {
    transformObserver = new MutationObserverConstructor(() => scheduleRefresh());
    transformObserver.observe(container, {
      attributes: true,
      attributeFilter: ["style", "transform"],
      subtree: true,
    });
  }
  const ResizeObserverConstructor = doc.defaultView?.ResizeObserver;
  const resizeObserver = ResizeObserverConstructor
    ? new ResizeObserverConstructor(() => scheduleRefresh())
    : null;
  resizeObserver?.observe(container);

  const offSelection = editor.on("selectionChange", () => refresh());
  const offChange = editor.on("change", () => scheduleRefresh());
  const offRender = view.on("render", () => scheduleRefresh());

  layer.addEventListener("pointerdown", onLayerPointerDown);
  // Move/up listen on the document so the gesture survives leaving the canvas.
  doc.addEventListener("pointermove", onPointerMove, true);
  doc.addEventListener("pointerup", onPointerUp, true);
  doc.addEventListener("pointercancel", onPointerCancel, true);
  container.addEventListener("scroll", onScrollOrResize, { passive: true });
  container.addEventListener("keydown", onKeyDown, true);
  doc.defaultView?.addEventListener("resize", onScrollOrResize);

  refresh();

  return {
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame) {
        const cancel =
          typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
        cancel(frame as never);
        frame = 0;
      }
      offSelection();
      offChange();
      offRender();
      transformObserver?.disconnect();
      resizeObserver?.disconnect();
      layer.removeEventListener("pointerdown", onLayerPointerDown);
      doc.removeEventListener("pointermove", onPointerMove, true);
      doc.removeEventListener("pointerup", onPointerUp, true);
      doc.removeEventListener("pointercancel", onPointerCancel, true);
      container.removeEventListener("scroll", onScrollOrResize);
      container.removeEventListener("keydown", onKeyDown, true);
      doc.defaultView?.removeEventListener("resize", onScrollOrResize);
      layer.remove();
    },
  };
}
