import { createContext, use } from "react";
import type { MdxComponentPlugin } from "@md-editor/mdx-component-registry";

export interface DesktopEditorActions {
  readonly dispatchCommand: (id: string) => Promise<void>;
  readonly openDocumentFromTree: (filePath: string) => Promise<void>;
  readonly openRecentFile: (path: string) => Promise<void>;
  readonly openWysiwygLink: (href: string) => Promise<void>;
  readonly runEditorUpdateAction: () => Promise<void>;
  readonly insertMdxComponent: (plugin: MdxComponentPlugin) => void;
  readonly insertTable: (cols: number, rows: number) => void;
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
