/**
 * 会话测试用的记录型 fake 浮层与 fake 键盘端口。
 *
 * 为什么放在 `support/`：`scripts/structure/check.mjs:35` 的 `MIRROR_EXEMPT_DIRS` 豁免该目录，
 * 它不属于 `src/**` 的镜像测试面；同时它只在测试中被引用，不会进入产物。
 *
 * 设计原则：fake **只记录**语义动作（不模拟 DOM 细节），与会话逻辑共用同一套端口契约 ⇒
 * 断言的是"会话做了什么"，而不是"mock 被调用了"这种自证。
 */
import type {
  MediaViewerKeyEvent,
  MediaViewerKeyboardPort,
  MediaViewerOverlayPort,
} from "../../../src/media-viewer/session.ts";
import type {
  ContentSize,
  ViewerTransform,
  ViewportSize,
} from "../../../src/media-viewer/zoom-pan.ts";

export interface RecordingOverlay extends MediaViewerOverlayPort {
  readonly transforms: ViewerTransform[];
  readonly draggingFlags: boolean[];
  readonly focusCalls: number;
  readonly destroyed: number;
  viewport: ViewportSize;
  content: ContentSize;
}

/** 记录型浮层：可调视口/内容尺寸，记录内容注入、变换与生命周期动作。 */
export function createRecordingOverlay(init?: {
  readonly viewport?: ViewportSize;
  readonly content?: ContentSize;
}): RecordingOverlay {
  const transforms: ViewerTransform[] = [];
  const draggingFlags: boolean[] = [];
  let focusCalls = 0;
  let destroyed = 0;
  let viewport: ViewportSize = init?.viewport ?? { width: 1000, height: 500 };
  let content: ContentSize = init?.content ?? { width: 400, height: 400 };
  return {
    transforms,
    draggingFlags,
    get focusCalls() {
      return focusCalls;
    },
    get destroyed() {
      return destroyed;
    },
    get viewport() {
      return viewport;
    },
    set viewport(next: ViewportSize) {
      viewport = next;
    },
    get content() {
      return content;
    },
    set content(next: ContentSize) {
      content = next;
    },
    setTransform: (transform) => {
      transforms.push(transform);
    },
    setDragging: (dragging) => {
      draggingFlags.push(dragging);
    },
    measureViewport: () => viewport,
    measureContent: () => content,
    focus: () => {
      focusCalls += 1;
    },
    destroy: () => {
      destroyed += 1;
    },
  };
}

export interface RecordingKeyboard extends MediaViewerKeyboardPort {
  readonly listeners: readonly ((event: MediaViewerKeyEvent) => unknown)[];
  dispatch(event: MediaViewerKeyEvent): readonly boolean[];
}

/** 记录型键盘端口：跟踪注册/注销成对性，并可派发事件观察消费结果。 */
export function createRecordingKeyboard(): RecordingKeyboard {
  const listeners: ((event: MediaViewerKeyEvent) => unknown)[] = [];
  return {
    listeners,
    add: (listener) => {
      listeners.push(listener);
    },
    remove: () => {
      listeners.length = 0;
    },
    dispatch: (event) => listeners.map((listener) => listener(event) === true),
  };
}

/** 构造键盘事件（默认无修饰键）。 */
export function keyEvent(
  key: string,
  modifiers?: { readonly metaKey?: boolean; readonly ctrlKey?: boolean },
): MediaViewerKeyEvent & { readonly prevented: { value: boolean } } {
  const prevented = { value: false };
  return {
    key,
    metaKey: modifiers?.metaKey ?? false,
    ctrlKey: modifiers?.ctrlKey ?? false,
    altKey: false,
    preventDefault: () => {
      prevented.value = true;
    },
    prevented,
  };
}
