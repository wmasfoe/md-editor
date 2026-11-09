import { createContext, use } from "react";
import type { MdxComponentPlugin } from "@md-editor/plugin-sdk/mdx";

export interface DesktopEditorActions {
  readonly dispatchCommand: (id: string) => Promise<void>;
  readonly openDocumentFromTree: (filePath: string) => Promise<void>;
  readonly openRecentFile: (path: string) => Promise<void>;
  readonly openWysiwygLink: (href: string) => Promise<void>;
  readonly runEditorUpdateAction: () => Promise<void>;
  readonly insertMdxComponent: (plugin: MdxComponentPlugin) => void;
  readonly insertTable: (cols: number, rows: number) => void;
  readonly refreshFolderForDocumentPath: (documentPath: string) => Promise<void>;
  readonly openAbout: () => Promise<void>;
}

export const DesktopEditorActionsContext = createContext<DesktopEditorActions | null>(null);

export function useDesktopEditorActions(): DesktopEditorActions {
  const ctx = use(DesktopEditorActionsContext);
  if (!ctx)
    throw new Error(
      "useDesktopEditorActions must be used inside DesktopEditorActionsContext.Provider",
    );
  return ctx;
}

/**
 * 可选版本：不在 Provider 内时返回 null 而不是抛错。
 *
 * 独立设置窗口没有编辑器动作（打开文档属于主窗口语义），
 * 需要动作的 UI 应据此隐藏或走跨窗口通道，而不是让整个窗口崩溃。
 */
export function useOptionalDesktopEditorActions(): DesktopEditorActions | null {
  return use(DesktopEditorActionsContext);
}
