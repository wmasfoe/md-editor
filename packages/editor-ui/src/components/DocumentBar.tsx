import type { EditorMode } from "@md-editor/editor-core";

export interface DocumentBarProps {
  readonly hasActiveDocument: boolean;
  readonly mode: EditorMode;
  readonly onChangeMode: (mode: EditorMode) => void;
  readonly onOpenSettings: () => void;
}

export function DocumentBar({
  hasActiveDocument,
  mode,
  onChangeMode,
  onOpenSettings
}: DocumentBarProps) {
  const controlsClassName = hasActiveDocument
    ? "document-bar__controls"
    : "document-bar__controls document-bar__controls--settings-only";

  return (
    <header className="document-bar" aria-label="编辑视图控制">
      <div className={controlsClassName}>
        {hasActiveDocument ? (
          <ModeToggleButton
            mode={mode}
            onClick={() => onChangeMode(mode === "source" ? "wysiwyg" : "source")}
          />
        ) : null}
        <button
          type="button"
          className="document-bar__icon-button"
          aria-label="打开设置"
          title="设置"
          onClick={onOpenSettings}
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}

function ModeToggleButton({
  mode,
  onClick
}: {
  readonly mode: EditorMode;
  readonly onClick: () => void;
}) {
  const isSourceMode = mode === "source";
  const label = isSourceMode ? "切换到所见即所得" : "切换到源码";

  return (
    <button
      type="button"
      className="document-bar__icon-button"
      aria-pressed={isSourceMode}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {isSourceMode ? <SourceIcon /> : <WysiwygIcon />}
    </button>
  );
}

function WysiwygIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3.3h10v9.4H3z" />
      <path d="M5 5.5h6M5 8h6M5 10.5h3.5" />
    </svg>
  );
}

function SourceIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.2 4.5 3 8l3.2 3.5M9.8 4.5 13 8l-3.2 3.5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.15" />
      <path d="M8 2.1c.42 0 .82.04 1.2.13l.38 1.35c.28.11.54.26.78.45l1.35-.36c.52.58.91 1.25 1.13 2l-.98.99c.03.15.04.31.04.47s-.01.32-.04.47l.98.99a5.07 5.07 0 0 1-1.13 2l-1.35-.36c-.24.19-.5.34-.78.45l-.38 1.35a5.5 5.5 0 0 1-2.4 0l-.38-1.35a3.8 3.8 0 0 1-.78-.45l-1.35.36a5.07 5.07 0 0 1-1.13-2l.98-.99A2.7 2.7 0 0 1 4.1 8c0-.16.01-.32.04-.47l-.98-.99c.22-.75.61-1.42 1.13-2l1.35.36c.24-.19.5-.34.78-.45l.38-1.35c.38-.09.78-.13 1.2-.13Z" />
    </svg>
  );
}
