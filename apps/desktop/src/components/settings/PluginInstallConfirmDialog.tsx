import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { dialogButtonClassName, primaryDialogButtonClassName } from "@md-editor/editor-ui";
import { useTranslation } from "@md-editor/i18n";
import type { PluginVersion } from "../../app/plugins/storage";

export interface PluginInstallConfirmDialogProps {
  /** 待确认安装的版本；为空表示对话框关闭。 */
  readonly version: PluginVersion | null;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/**
 * 首次安装外部插件前的信任确认。
 *
 * 安装后插件会立即启用并在主窗口执行代码（应用 CSP 为空，插件可触达 Tauri IPC），
 * 因此必须让用户在执行前看到代码来源、版本和摘要，而不是点一下按钮就直接运行。
 * 摘要只证明下载内容与记录一致，这里不把它表述成安全认证。
 */
export function PluginInstallConfirmDialog({
  version,
  busy,
  onCancel,
  onConfirm,
}: PluginInstallConfirmDialogProps) {
  const { t } = useTranslation();
  const manifest = version?.package.manifest;
  const source = version?.source;
  const rows: ReadonlyArray<readonly [string, string]> =
    manifest && source
      ? [
          [t("pluginPreview.confirmPlugin"), `${manifest.name} (${manifest.id})`],
          [t("pluginPreview.confirmVersion"), manifest.version],
          [t("pluginPreview.confirmSource"), `${source.owner}/${source.repo}`],
          [t("pluginPreview.confirmRelease"), source.tag],
          [t("pluginPreview.confirmDigest"), source.sha256],
        ]
      : [];
  return (
    <Dialog
      open={version !== null}
      onClose={busy ? () => {} : onCancel}
      className="fixed inset-0 z-[80]"
    >
      <DialogBackdrop className="fixed inset-0 bg-[rgba(20,27,35,0.35)] backdrop-blur-[2px]" />
      <div className="fixed inset-0 grid place-items-center p-4">
        <DialogPanel className="w-[min(480px,calc(100vw-2rem))] rounded-[12px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] p-5 shadow-[var(--theme-shadow)]">
          <DialogTitle className="m-0 mb-3 text-[15px] font-[650] leading-[1.4] text-[var(--theme-title)]">
            {t("pluginPreview.confirmInstallTitle")}
          </DialogTitle>
          <p className="mb-3 text-[13px] leading-[1.5] text-[var(--theme-text)]">
            {t("pluginPreview.confirmInstallBody")}
          </p>
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-[var(--theme-muted)]">{label}</dt>
                <dd className="m-0 break-all font-mono text-[var(--theme-text)]">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              className={dialogButtonClassName}
              disabled={busy}
              onClick={onCancel}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={primaryDialogButtonClassName}
              disabled={busy}
              onClick={onConfirm}
            >
              {t("pluginPreview.confirmInstall")}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
