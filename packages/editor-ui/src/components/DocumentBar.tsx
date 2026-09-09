import type { EditorMode } from "@md-editor/editor-core";
import { useTranslation } from "@md-editor/i18n";
import { CodeBracketIcon, Cog6ToothIcon, PencilSquareIcon } from "@heroicons/react/24/outline";

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
  onOpenSettings,
}: DocumentBarProps) {
  const { t } = useTranslation();
  const controlsClassName = hasActiveDocument
    ? "flex w-full min-w-0 items-center justify-between gap-1.5"
    : "flex w-full min-w-0 items-center justify-end gap-1.5";

  return (
    <header
      className="flex min-h-[38px] shrink-0 items-center border-t border-[var(--theme-border)] bg-[var(--theme-chrome)] px-2.5 py-1 text-[var(--theme-control-text)]"
      aria-label={t("editor.documentBar.viewControlsAria")}
    >
      <div className={controlsClassName}>
        {hasActiveDocument ? (
          <ModeToggleButton
            mode={mode}
            onClick={() => onChangeMode(mode === "source" ? "wysiwyg" : "source")}
          />
        ) : null}
        <button
          type="button"
          className={iconButtonClassName}
          aria-label={t("editor.documentBar.openSettings")}
          title={t("editor.documentBar.openSettings")}
          onClick={onOpenSettings}
        >
          <Cog6ToothIcon aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function ModeToggleButton({
  mode,
  onClick,
}: {
  readonly mode: EditorMode;
  readonly onClick: () => void;
}) {
  const { t } = useTranslation();
  const isSourceMode = mode === "source";
  const label = isSourceMode
    ? t("editor.documentBar.switchToWysiwyg")
    : t("editor.documentBar.switchToSource");

  return (
    <button
      type="button"
      className={iconButtonClassName}
      aria-pressed={isSourceMode}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {isSourceMode ? (
        <CodeBracketIcon aria-hidden="true" />
      ) : (
        <PencilSquareIcon aria-hidden="true" />
      )}
    </button>
  );
}

const iconButtonClassName =
  "grid size-[28px] shrink-0 place-items-center rounded-[5px] border-0 bg-transparent text-[var(--theme-control-text)] transition-all duration-120 ease-out hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.3] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]";
