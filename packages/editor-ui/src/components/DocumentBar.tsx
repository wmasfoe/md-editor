import type { EditorMode } from "@md-editor/editor-core";
import {
  CodeBracketIcon,
  Cog6ToothIcon,
  PencilSquareIcon
} from "@heroicons/react/24/outline";

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
    ? "flex w-full min-w-0 items-center justify-between gap-1.5"
    : "flex w-full min-w-0 items-center justify-end gap-1.5";

  return (
    <header
      className="flex min-h-[42px] shrink-0 items-center border-t border-[var(--theme-border)] bg-[var(--theme-chrome-soft)] px-2 py-1.5 text-[var(--theme-control-text)]"
      aria-label="编辑视图控制"
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
          aria-label="打开设置"
          title="设置"
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
      className={iconButtonClassName}
      aria-pressed={isSourceMode}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {isSourceMode ? <CodeBracketIcon aria-hidden="true" /> : <PencilSquareIcon aria-hidden="true" />}
    </button>
  );
}

const iconButtonClassName =
  "grid size-[30px] shrink-0 place-items-center rounded-[5px] border-0 bg-transparent text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--theme-primary)] [&_svg]:size-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.25] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]";
