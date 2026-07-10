import type { RecentFile } from "@md-editor/editor-core";
import { dialogButtonClassName, primaryDialogButtonClassName } from "./ConfirmActionDialog";

export interface WelcomeStateProps {
  readonly recentFiles: readonly RecentFile[];
  readonly onNewDocument: () => void;
  readonly onOpenDocument: () => void;
  readonly onOpenFolder: () => void;
  readonly onOpenRecent: (path: string) => void;
}

export function WelcomeState({
  recentFiles,
  onNewDocument,
  onOpenDocument,
  onOpenFolder,
  onOpenRecent,
}: WelcomeStateProps) {
  return (
    <section
      className="m-auto w-[min(620px,calc(100%_-_48px))] px-0 pb-[72px] pt-12"
      aria-labelledby="welcome-title"
    >
      <div
        className="grid size-10 place-items-center rounded-[10px] border border-[var(--theme-border-strong)] font-mono font-bold text-[var(--theme-primary)]"
        aria-hidden="true"
      >
        M
      </div>
      <div className="mb-[26px] mt-[22px]">
        <p className="mb-1 mt-0 text-[13px] text-[var(--theme-muted)]">
          本地优先的 Markdown 写作工具
        </p>
        <h1
          id="welcome-title"
          className="m-0 text-[28px] leading-[1.3] tracking-normal text-[var(--theme-title)]"
        >
          从一篇文档开始
        </h1>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryActionClassName} onClick={onNewDocument}>
          新建文档
        </button>
        <button type="button" className={secondaryActionClassName} onClick={onOpenDocument}>
          打开文件
        </button>
        <button type="button" className={secondaryActionClassName} onClick={onOpenFolder}>
          打开文件夹
        </button>
      </div>
      {recentFiles.length > 0 ? (
        <div className="mt-[34px]">
          <h2 className="mb-2 mt-0 text-xs font-semibold uppercase tracking-[0.04em] text-[var(--theme-muted)]">
            最近文件
          </h2>
          <ul className="m-0 list-none p-0">
            {recentFiles.slice(0, 5).map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className="grid w-full grid-cols-[minmax(100px,180px)_minmax(0,1fr)] gap-4 rounded-[5px] border-0 bg-transparent px-2 py-[7px] text-left hover:bg-[var(--theme-control-hover)]"
                  onClick={() => onOpenRecent(file.path)}
                  title={file.path}
                >
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-[var(--theme-title)]">
                    {file.name}
                  </span>
                  <small className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--theme-control-subtle)]">
                    {file.path}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-[30px] text-xs text-[var(--theme-control-subtle)]">
          你打开的文件只保存在本机。
        </p>
      )}
    </section>
  );
}

const secondaryActionClassName = `${dialogButtonClassName} min-h-8 px-3 py-[5px]`;

const primaryActionClassName = `${primaryDialogButtonClassName} min-h-8 px-3 py-[5px]`;
