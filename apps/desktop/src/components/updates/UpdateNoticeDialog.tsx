/**
 * @fileoverview 「本次更新内容」对话框
 *
 * 第一段提醒：检测到新版本后只弹一次，展示本次更新日志，并让用户选择
 * 立即更新 / 稍后 / 跳过此版本。下载完成后的提醒属于第二段（标题栏 + toast），
 * 不再使用模态打断用户。
 */

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { dialogButtonClassName, primaryDialogButtonClassName } from "@md-editor/editor-ui";
import { useTranslation } from "@md-editor/i18n";
import type { ChangelogEntry } from "@md-editor/changelog";
import type { UpdateNoticeChoice } from "../../app/updates/presentation";
import { UpdateReleaseNotes } from "./UpdateReleaseNotes";

export interface UpdateNoticeDialogProps {
  /** 待提示的版本号；为 null 时对话框关闭 */
  readonly version: string | null;
  readonly entry: ChangelogEntry | null;
  readonly onResolve: (choice: UpdateNoticeChoice) => void;
}

export function UpdateNoticeDialog({ version, entry, onResolve }: UpdateNoticeDialogProps) {
  const { t } = useTranslation();
  const isOpen = version !== null;

  return (
    <Dialog open={isOpen} onClose={() => onResolve("later")} className="relative z-[60]">
      <DialogBackdrop className="fixed inset-0 bg-[rgba(20,27,35,0.24)]" />
      <div className="fixed inset-0 grid place-items-center p-6">
        <DialogPanel className="w-[min(460px,100%)] rounded-[10px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] p-5 shadow-[var(--theme-shadow)]">
          <DialogTitle className="m-0 text-base font-[650] leading-[1.4] text-[var(--theme-title)]">
            {t("settings.updates.noticeTitle", { version: version ?? "" })}
          </DialogTitle>
          <div className="mb-5 mt-3 max-h-[320px] overflow-y-auto pr-1">
            <UpdateReleaseNotes
              entry={entry}
              fallbackVersion={version ?? ""}
              notesTitle={t("settings.updates.notesTitle")}
              noNotesLabel={t("settings.updates.noNotes")}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={dialogButtonClassName}
              onClick={() => onResolve("skip")}
            >
              {t("settings.updates.actions.skipVersion")}
            </button>
            <button
              type="button"
              className={dialogButtonClassName}
              onClick={() => onResolve("later")}
            >
              {t("settings.updates.actions.later")}
            </button>
            <button
              type="button"
              className={primaryDialogButtonClassName}
              onClick={() => onResolve("update")}
              autoFocus
            >
              {t("settings.updates.actions.updateNow")}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
