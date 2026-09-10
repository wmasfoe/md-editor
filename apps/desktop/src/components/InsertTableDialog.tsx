import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useTranslation } from "@md-editor/i18n";
import { dialogButtonClassName, primaryDialogButtonClassName } from "@md-editor/editor-ui";

export interface InsertTableDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (cols: number, rows: number) => void;
}

export function InsertTableDialog({ open, onClose, onConfirm }: InsertTableDialogProps) {
  const { t } = useTranslation();
  const [cols, setCols] = useState("3");
  const [rows, setRows] = useState("4");
  const colsInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setCols("3");
      setRows("4");
      const frame = requestAnimationFrame(() => {
        colsInputRef.current?.focus();
        colsInputRef.current?.select();
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open]);

  const handleSubmit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      const parsedCols = parseInt(cols, 10);
      const parsedRows = parseInt(rows, 10);
      const safeCols = Number.isFinite(parsedCols) ? Math.max(1, Math.min(100, parsedCols)) : 3;
      const safeRows = Number.isFinite(parsedRows) ? Math.max(1, Math.min(100, parsedRows)) : 4;
      onConfirm(safeCols, safeRows);
      onClose();
    },
    [cols, rows, onConfirm, onClose],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="fixed inset-0 z-[70]">
      <DialogBackdrop className="fixed inset-0 bg-[rgba(20,27,35,0.35)] backdrop-blur-[2px] transition-opacity" />
      <div className="fixed inset-0 grid place-items-center p-4">
        <DialogPanel className="w-[min(380px,calc(100vw-2rem))] rounded-[12px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] p-5 shadow-[var(--theme-shadow)]">
          <DialogTitle className="m-0 mb-5 text-center text-[15px] font-[650] leading-[1.4] text-[var(--theme-title)]">
            {t("insertTable.title", { defaultValue: "插入表格" })}
          </DialogTitle>

          <form onSubmit={handleSubmit}>
            <div className="flex items-center justify-center gap-6 py-1">
              <label className="flex items-center gap-2 text-[13px] font-medium text-[var(--theme-text)]">
                <span>{t("insertTable.columns", { defaultValue: "列" })}</span>
                <input
                  ref={colsInputRef}
                  type="number"
                  min={1}
                  max={100}
                  value={cols}
                  onChange={(e) => setCols(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="h-[34px] w-[88px] rounded-[6px] border border-[var(--theme-border)] bg-[var(--theme-input-bg,var(--theme-surface))] px-2 text-center text-[14px] text-[var(--theme-title)] transition-colors focus:border-[var(--theme-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
                />
              </label>

              <label className="flex items-center gap-2 text-[13px] font-medium text-[var(--theme-text)]">
                <span>{t("insertTable.rows", { defaultValue: "行" })}</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={rows}
                  onChange={(e) => setRows(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="h-[34px] w-[88px] rounded-[6px] border border-[var(--theme-border)] bg-[var(--theme-input-bg,var(--theme-surface))] px-2 text-center text-[14px] text-[var(--theme-title)] transition-colors focus:border-[var(--theme-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
                />
              </label>
            </div>

            <div className="my-4 border-b border-[var(--theme-border)]" />

            <div className="flex justify-end gap-2.5">
              <button type="button" className={dialogButtonClassName} onClick={onClose}>
                {t("common.cancel", { defaultValue: "取消" })}
              </button>
              <button type="submit" className={primaryDialogButtonClassName}>
                {t("common.confirm", { defaultValue: "确定" })}
              </button>
            </div>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
