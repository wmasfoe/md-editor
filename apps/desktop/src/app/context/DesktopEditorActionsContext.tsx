import { createContext, use } from "react";

export interface DesktopEditorActions {
  readonly dispatchCommand: (id: string) => Promise<void>;
  readonly openDocumentFromTree: (filePath: string) => Promise<void>;
  readonly openRecentFile: (path: string) => Promise<void>;
  readonly openWysiwygLink: (href: string) => Promise<void>;
  readonly runEditorUpdateAction: () => Promise<void>;
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
