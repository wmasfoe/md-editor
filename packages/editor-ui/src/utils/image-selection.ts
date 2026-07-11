import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { NodeSelection, Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

export const imageSelectionPluginKey = new PluginKey("md-editor-image-selection");
const nativeSelectionGuardDurationMs = 1500;
const proseMirrorSeparatorClassName = "ProseMirror-separator";
const markdownSourceImagePreviewAttribute = "data-md-source-image-preview";

interface NativeImageSelectionGuard {
  arm(): void;
  disarm(): void;
  destroy(): void;
}

const nativeSelectionGuards = new WeakMap<EditorView, NativeImageSelectionGuard>();
const imagesWithSilentFailureHandling = new WeakSet<HTMLImageElement>();

export const imageSelectionPlugin = $prose(
  () =>
    new Plugin({
      key: imageSelectionPluginKey,
      props: {
        handleDOMEvents: {
          mousedown(view, event) {
            return handleImagePointerEvent(view, event);
          },
          dragstart(_, event) {
            if (findImageElement(event.target)) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        },
        handleKeyDown(view, event) {
          if (!(event.key === "Backspace" || event.key === "Delete")) {
            return false;
          }

          const selection = view.state.selection;
          if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") {
            return false;
          }

          event.preventDefault();
          view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
          return true;
        },
      },
      view(view) {
        prepareImageDom(view);
        const nativeSelectionGuard = bindNativeImageSelectionGuard(view);
        nativeSelectionGuards.set(view, nativeSelectionGuard);
        return {
          update(nextView) {
            prepareImageDom(nextView);
            const selection = nextView.state.selection;
            if (selection instanceof NodeSelection && selection.node.type.name === "image") {
              markSelectedImageDom(nextView, selection.from);
            } else {
              nativeSelectionGuard.disarm();
              clearStaleSelectedImageDom(nextView);
            }
          },
          destroy() {
            nativeSelectionGuard.destroy();
            nativeSelectionGuards.delete(view);
            clearStaleSelectedImageDom(view);
          },
        };
      },
    }),
);

export function selectImageNode(view: EditorView, position: number): void {
  clearNativeSelection(view);
  view.dispatch(
    view.state.tr.setSelection(NodeSelection.create(view.state.doc, position)).scrollIntoView(),
  );
  view.focus();
  markSelectedImageDom(view, position);
}

export function findImageNodePositionForDom(
  doc: ProseMirrorNode,
  nodeDOM: (position: number) => Node | null,
  target: Node,
): number | null {
  let foundPosition: number | null = null;

  doc.descendants((node, position) => {
    if (node.type.name !== "image") {
      return;
    }

    const dom = nodeDOM(position);
    if (dom && containsDomNode(dom, target)) {
      foundPosition = position;
      return false;
    }
  });

  return foundPosition;
}

function containsDomNode(parent: Node, target: Node): boolean {
  return parent === target || (typeof parent.contains === "function" && parent.contains(target));
}

function handleImagePointerEvent(view: EditorView, event: MouseEvent): boolean {
  const image = findImageElement(event.target);
  if (!image) {
    return false;
  }

  const position = findImageNodePositionForDom(view.state.doc, (pos) => view.nodeDOM(pos), image);
  if (position === null) {
    return false;
  }

  // Desktop WebKit can expose Live Text/OCR interactions on images. Claim the
  // initial pointer event before a native image selection can be created.
  event.preventDefault();
  event.stopPropagation();
  nativeSelectionGuards.get(view)?.arm();
  selectImageNode(view, position);
  return true;
}

function clearNativeSelection(view: EditorView): void {
  const root = view.root;
  const selection = root instanceof Document ? root.getSelection() : window.getSelection();
  selection?.removeAllRanges();
}

export function isImageNodeSelection(selection: unknown): boolean {
  return selection instanceof NodeSelection && selection.node.type.name === "image";
}

export function shouldClearNativeImageSelection(
  guardArmed: boolean,
  selection: unknown,
  hasNativeSelection: boolean,
): boolean {
  return guardArmed && isImageNodeSelection(selection) && hasNativeSelection;
}

function bindNativeImageSelectionGuard(view: EditorView): NativeImageSelectionGuard {
  const root = view.root;
  const ownerDocument = root instanceof Document ? root : view.dom.ownerDocument;
  const ownerWindow = ownerDocument.defaultView ?? window;
  let armed = false;
  let disarmTimer: number | undefined;

  const disarm = () => {
    armed = false;
    if (disarmTimer !== undefined) {
      ownerWindow.clearTimeout(disarmTimer);
      disarmTimer = undefined;
    }
  };
  const arm = () => {
    disarm();
    armed = true;
    disarmTimer = ownerWindow.setTimeout(disarm, nativeSelectionGuardDurationMs);
  };
  const handleSelectionChange = () => {
    if (
      shouldClearNativeImageSelection(armed, view.state.selection, hasNativeSelectionInside(view))
    ) {
      clearNativeSelection(view);
    }
  };
  const handleMouseDown = (event: MouseEvent) => {
    if (!findImageElement(event.target)) {
      disarm();
    }
  };

  // Capture new user input before the browser can create a legitimate range.
  ownerDocument.addEventListener("mousedown", handleMouseDown, true);
  ownerDocument.addEventListener("keydown", disarm, true);
  ownerDocument.addEventListener("selectionchange", handleSelectionChange);

  return {
    arm,
    disarm,
    destroy() {
      disarm();
      ownerDocument.removeEventListener("mousedown", handleMouseDown, true);
      ownerDocument.removeEventListener("keydown", disarm, true);
      ownerDocument.removeEventListener("selectionchange", handleSelectionChange);
    },
  };
}

function hasNativeSelectionInside(view: EditorView): boolean {
  const root = view.root;
  const selection = root instanceof Document ? root.getSelection() : window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }

  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  return Boolean((anchor && view.dom.contains(anchor)) || (focus && view.dom.contains(focus)));
}

function prepareImageDom(view: EditorView): void {
  view.dom.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    if (isProseMirrorSeparatorImage(image)) {
      clearEditorImageDomState(image);
      return;
    }
    if (isMarkdownSourceImagePreviewElement(image)) {
      image.draggable = false;
      image.setAttribute("contenteditable", "false");
      image.removeAttribute("data-md-editor-image");
      image.classList.remove("md-editor-selected-image");
      return;
    }

    image.draggable = false;
    image.setAttribute("contenteditable", "false");
    image.dataset.mdEditorImage = "true";
    bindSilentImageFailureHandling(image);
  });
}

function findImageElement(target: EventTarget | null): HTMLImageElement | null {
  const image =
    target instanceof Element
      ? target.closest<HTMLImageElement>(
          "img:not(.ProseMirror-separator):not([data-md-source-image-preview])",
        )
      : null;
  return image && !isProseMirrorSeparatorImage(image) && !isMarkdownSourceImagePreviewElement(image)
    ? image
    : null;
}

export function hasProseMirrorSeparatorImageClass(className: string): boolean {
  return className.split(/\s+/u).includes(proseMirrorSeparatorClassName);
}

function isProseMirrorSeparatorImage(image: HTMLImageElement): boolean {
  return hasProseMirrorSeparatorImageClass(image.className);
}

export function isMarkdownSourceImagePreviewElement(
  image: Pick<HTMLImageElement, "hasAttribute">,
): boolean {
  return image.hasAttribute(markdownSourceImagePreviewAttribute);
}

function bindSilentImageFailureHandling(image: HTMLImageElement): void {
  if (imagesWithSilentFailureHandling.has(image)) {
    return;
  }

  imagesWithSilentFailureHandling.add(image);
  image.addEventListener("load", () => {
    image.hidden = false;
  });
  image.addEventListener("error", () => {
    image.hidden = true;
  });
  if (image.complete && image.naturalWidth === 0 && image.getAttribute("src")) {
    image.hidden = true;
  }
}

function clearEditorImageDomState(image: HTMLImageElement): void {
  image.removeAttribute("contenteditable");
  image.removeAttribute("data-md-editor-image");
  image.removeAttribute("draggable");
  image.classList.remove("md-editor-selected-image");
}

function markSelectedImageDom(view: EditorView, position: number): void {
  clearStaleSelectedImageDom(view);
  const node = view.nodeDOM(position);
  if (node instanceof HTMLElement) {
    node.classList.add("md-editor-selected-image");
  }
}

function clearStaleSelectedImageDom(view: EditorView): void {
  view.dom
    .querySelectorAll(".md-editor-selected-image")
    .forEach((node) => node.classList.remove("md-editor-selected-image"));
}
