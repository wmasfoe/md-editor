import { useEffect } from "react";
import { SettingsPage } from "../components/SettingsDialog";
import {
  AppTitleBar,
  EditorToast,
  isMacPlatform,
  startTitleBarDrag,
  type AppToast,
} from "./AppWindowChrome";
import { AppSettingsProvider, useAppSettings } from "./settings-context";
import { useToast } from "./controller/useToast";

export function SettingsWindowApp() {
  const { toast, showToast } = useToast();
  return (
    <AppSettingsProvider showToast={showToast} surface="settings-window">
      <SettingsWindowContent toast={toast} />
    </AppSettingsProvider>
  );
}

function SettingsWindowContent({ toast }: { readonly toast: AppToast | null }) {
  const { hasLoadedSettings } = useAppSettings();
  const shouldShowOverlayTitleBar = isMacPlatform();

  useEffect(() => {
    document.title = "设置";
  }, []);

  return (
    <main className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--theme-bg)]">
      <AppTitleBar
        title="设置"
        isVisible={shouldShowOverlayTitleBar}
        hasWindowControlsInset
        titleAlign="center"
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <EditorToast toast={toast} />
        {hasLoadedSettings ? (
          <SettingsPage surface="settings-window" onStartWindowDrag={startTitleBarDrag} />
        ) : null}
      </div>
    </main>
  );
}
