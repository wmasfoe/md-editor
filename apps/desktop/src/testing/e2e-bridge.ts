import { switchEditorModeSafely, type EditorMode } from "@md-editor/editor-core";
import type {
  CodeMirrorEditorExternalEditResult,
  CodeMirrorEditorPorts,
} from "@md-editor/editor-ui";
import { inspectCodeMirrorEditorForTesting } from "@md-editor/editor-ui/CodeMirrorEditor/testing";
import type { RuntimeFileService } from "@md-editor/file-system";
import type { DesktopEditorActions } from "../app/context/DesktopEditorActionsContext";
import { runtime } from "../app/runtime/editor-runtime";
import { useDocumentUiStore } from "../app/stores/document-ui-store";
import { useToastStore } from "../app/stores/toast-store";
import { getS1CapabilityInventory } from "../app/s1-capability-inventory";
import {
  enqueueE2eSaveBehavior,
  getE2ePlatformDiagnostics,
  readE2eMarkdown,
  setE2eFolderEmpty,
  type E2eSaveBehavior,
} from "./e2e-platform";

export interface EditorE2eDiagnostics {
  readonly cmEditorCount: number;
  readonly proseMirrorCount: number;
  readonly renderer: ReturnType<typeof inspectCodeMirrorEditorForTesting> | null;
  readonly snapshot: ReturnType<typeof runtime.document.getSnapshot>;
  readonly transitionCounts: Readonly<Record<string, number>>;
  readonly platform: ReturnType<typeof getE2ePlatformDiagnostics>;
}

export interface EditorE2eBridge {
  readonly version: 2;
  readonly capabilities: ReturnType<typeof getS1CapabilityInventory>;
  getDiagnostics(): EditorE2eDiagnostics;
  openFixture(path: string): Promise<void>;
  openFolder(): Promise<void>;
  setFolderEmpty(empty: boolean): void;
  replaceDocument(markdown: string, filePath?: string | null, mode?: EditorMode): void;
  createNewDocument(): Promise<void>;
  dispatchCommand(id: string): Promise<void>;
  setMode(mode: EditorMode): Promise<void>;
  applyExternalEdit(
    markdown: string,
  ): CodeMirrorEditorExternalEditResult | { readonly status: "unavailable" };
  setCompositionActive(active: boolean): void;
  triggerParentRerender(): void;
  setAssetPreviewVisible(visible: boolean): void;
  save(forceDialog?: boolean): Promise<void>;
  enqueueSaveBehavior(behavior: E2eSaveBehavior): void;
  readPersistedMarkdown(path: string): string | null;
}

export interface EditorE2eCallbacks {
  readonly onDesktopActionsChange: (actions: DesktopEditorActions | null) => void;
  readonly onRendererPortsChange: (ports: CodeMirrorEditorPorts | null) => void;
}

declare global {
  interface Window {
    __MD_EDITOR_E2E__?: EditorE2eBridge;
  }
}

export function installEditorE2eBridge(_fileService: RuntimeFileService): EditorE2eCallbacks {
  let actions: DesktopEditorActions | null = null;
  let ports: CodeMirrorEditorPorts | null = null;
  let externalSequence = 0;
  const transitionCounts: Record<string, number> = {};

  runtime.document.subscribeTransitions((event) => {
    transitionCounts[event.transition.kind] = (transitionCounts[event.transition.kind] ?? 0) + 1;
  });

  const requireActions = (): DesktopEditorActions => {
    if (!actions) {
      throw new Error("Desktop editor actions are not mounted.");
    }
    return actions;
  };

  const bridge: EditorE2eBridge = Object.freeze({
    version: 2,
    capabilities: getS1CapabilityInventory(),
    getDiagnostics() {
      return Object.freeze({
        cmEditorCount: document.querySelectorAll(".cm-editor").length,
        proseMirrorCount: document.querySelectorAll(".ProseMirror").length,
        renderer: ports ? inspectCodeMirrorEditorForTesting(ports) : null,
        snapshot: runtime.document.getSnapshot(),
        transitionCounts: Object.freeze({ ...transitionCounts }),
        platform: getE2ePlatformDiagnostics(),
      });
    },
    async openFixture(path: string) {
      await requireActions().openDocumentFromTree(path);
    },
    async openFolder() {
      await requireActions().dispatchCommand("file.openFolder");
    },
    setFolderEmpty(empty: boolean) {
      setE2eFolderEmpty(empty);
    },
    replaceDocument(markdown: string, filePath: string | null = null, mode?: EditorMode) {
      runtime.document.replaceDocument(
        { markdown, savedMarkdown: markdown, filePath, mode },
        { kind: "command", commandId: "e2e.replaceDocument" },
      );
      useDocumentUiStore.getState().setHasActiveDocument(true);
      useDocumentUiStore.getState().setOpenedAsset(null);
    },
    async createNewDocument() {
      await requireActions().dispatchCommand("file.new");
    },
    async dispatchCommand(id: string) {
      await requireActions().dispatchCommand(id);
    },
    async setMode(mode: EditorMode) {
      if (runtime.document.getSnapshot().mode === mode) {
        return;
      }
      if (!ports) {
        throw new Error("Renderer ports are not mounted.");
      }
      const result = switchEditorModeSafely(runtime.document, mode, {
        renderer: ports.mode,
        operationId: `e2e:mode:${runtime.document.getSnapshot().stateRevision + 1}`,
      });
      if (!result.ok) {
        throw new Error(result.message);
      }
    },
    applyExternalEdit(markdown: string) {
      if (!ports) {
        return { status: "unavailable" as const };
      }
      const snapshot = runtime.document.getSnapshot();
      externalSequence += 1;
      return ports.applyExternalEdit({
        operationId: `e2e:external:${externalSequence}`,
        markdown,
        expectedGeneration: snapshot.documentGeneration,
        expectedContentRevision: snapshot.contentRevision,
        selection: "preserve-offset-clamped",
      });
    },
    setCompositionActive(active: boolean) {
      const content = document.querySelector<HTMLElement>(".cm-content");
      if (!content) {
        throw new Error("CodeMirror content is not mounted.");
      }
      content.dispatchEvent(
        new CompositionEvent(active ? "compositionstart" : "compositionend", { bubbles: true }),
      );
    },
    triggerParentRerender() {
      useToastStore.getState().showToast(`E2E rerender ${Date.now()}`);
    },
    setAssetPreviewVisible(visible: boolean) {
      const store = useDocumentUiStore.getState();
      if (visible) {
        store.openAssetPath("/fixtures/preview.png", "preview.png");
      } else {
        store.closeAssetPreview();
      }
    },
    async save(forceDialog = false) {
      await requireActions().dispatchCommand(forceDialog ? "file.saveAs" : "file.save");
    },
    enqueueSaveBehavior(behavior: E2eSaveBehavior) {
      enqueueE2eSaveBehavior(behavior);
    },
    readPersistedMarkdown(path: string) {
      return readE2eMarkdown(path);
    },
  });

  Object.defineProperty(window, "__MD_EDITOR_E2E__", {
    configurable: false,
    enumerable: false,
    value: bridge,
    writable: false,
  });

  return Object.freeze({
    onDesktopActionsChange(nextActions: DesktopEditorActions | null) {
      actions = nextActions;
    },
    onRendererPortsChange(nextPorts: CodeMirrorEditorPorts | null) {
      ports = nextPorts;
    },
  });
}
