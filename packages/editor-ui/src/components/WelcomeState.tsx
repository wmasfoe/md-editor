import type { RecentFile } from "@md-editor/editor-core";

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
  onOpenRecent
}: WelcomeStateProps) {
  return (
    <section className="welcome-state" aria-labelledby="welcome-title">
      <div className="welcome-state__mark" aria-hidden="true">
        M
      </div>
      <div className="welcome-state__heading">
        <p>本地优先的 Markdown 写作工具</p>
        <h1 id="welcome-title">从一篇文档开始</h1>
      </div>
      <div className="welcome-state__actions">
        <button type="button" className="welcome-state__primary" onClick={onNewDocument}>
          新建文档
        </button>
        <button type="button" onClick={onOpenDocument}>
          打开文件
        </button>
        <button type="button" onClick={onOpenFolder}>
          打开文件夹
        </button>
      </div>
      {recentFiles.length > 0 ? (
        <div className="welcome-state__recent">
          <h2>最近文件</h2>
          <ul>
            {recentFiles.slice(0, 5).map((file) => (
              <li key={file.path}>
                <button type="button" onClick={() => onOpenRecent(file.path)} title={file.path}>
                  <span>{file.name}</span>
                  <small>{file.path}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="welcome-state__hint">你打开的文件只保存在本机。</p>
      )}
    </section>
  );
}
