import type { EditorMode } from "@md-editor/editor-core";

export interface DocumentBarProps {
  readonly filePath: string | null;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly hasActiveDocument: boolean;
  readonly mode: EditorMode;
  readonly isSidebarVisible: boolean;
  readonly onToggleSidebar: () => void;
  readonly onChangeMode: (mode: EditorMode) => void;
  readonly onSave: () => void;
}

export function DocumentBar({
  filePath,
  isDirty,
  isSaving,
  hasActiveDocument,
  mode,
  isSidebarVisible,
  onToggleSidebar,
  onChangeMode,
  onSave
}: DocumentBarProps) {
  const fileName = filePath?.split(/[\\/]/).pop() || "未命名文档";
  const saveLabel = isSaving ? "保存中" : isDirty ? "未保存" : "已保存";

  return (
    <header className="document-bar" aria-label="文档状态和视图控制">
      <button
        type="button"
        className="document-bar__icon-button"
        aria-label={isSidebarVisible ? "隐藏侧栏" : "显示侧栏"}
        aria-pressed={isSidebarVisible}
        title={isSidebarVisible ? "隐藏侧栏" : "显示侧栏"}
        onClick={onToggleSidebar}
      >
        <SidebarIcon />
      </button>
      {hasActiveDocument ? (
        <>
          <div className="document-bar__identity" title={filePath ?? fileName}>
            <strong>{fileName}</strong>
            <button
              type="button"
              className={isDirty ? "save-state save-state--dirty" : "save-state"}
              disabled={!isDirty || isSaving}
              onClick={onSave}
              aria-label={isDirty ? "未保存，点击保存" : saveLabel}
              aria-live="polite"
            >
              <span aria-hidden="true" className="save-state__dot" />
              {saveLabel}
            </button>
          </div>
          <div className="mode-switch" role="group" aria-label="编辑模式">
            <ModeButton active={mode === "wysiwyg"} onClick={() => onChangeMode("wysiwyg")}>
              所见即所得
            </ModeButton>
            <ModeButton active={mode === "source"} onClick={() => onChangeMode("source")}>
              源码
            </ModeButton>
          </div>
        </>
      ) : (
        <strong className="document-bar__welcome-title">Markdown Editor</strong>
      )}
    </header>
  );
}

function ModeButton({
  active,
  children,
  onClick
}: {
  readonly active: boolean;
  readonly children: React.ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "mode-switch__button mode-switch__button--active" : "mode-switch__button"}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SidebarIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M6 3v10" />
    </svg>
  );
}
