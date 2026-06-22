import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";

export type ConfirmationChoice = "confirm" | "secondary" | "cancel";

export interface ConfirmationState {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly secondaryLabel?: string;
  readonly destructive?: boolean;
}

export interface ConfirmActionDialogProps {
  readonly confirmation: ConfirmationState | null;
  readonly onResolve: (choice: ConfirmationChoice) => void;
}

export function ConfirmActionDialog({ confirmation, onResolve }: ConfirmActionDialogProps) {
  const confirmButtonClass = confirmation?.destructive
    ? `${primaryDialogButtonClassName} border-[var(--theme-danger-text)] bg-[var(--theme-danger-text)]`
    : primaryDialogButtonClassName;

  return (
    <Dialog open={confirmation !== null} onClose={() => onResolve("cancel")} className="relative z-[60]">
      <DialogBackdrop className="fixed inset-0 bg-[rgba(20,27,35,0.2)]" />
      <div className="fixed inset-0 grid place-items-center p-6">
        <DialogPanel className="w-[min(420px,100%)] rounded-[10px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] p-5 shadow-[var(--theme-shadow)]">
          <DialogTitle className="m-0 text-base font-[650] leading-[1.4] text-[var(--theme-title)]">
            {confirmation?.title}
          </DialogTitle>
          <Description className="mb-5 mt-2 text-[13px] leading-[1.55] text-[var(--theme-muted)]">
            {confirmation?.description}
          </Description>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={dialogButtonClassName}
              onClick={() => onResolve("cancel")}
              autoFocus={confirmation?.destructive === true}
            >
              取消
            </button>
            {confirmation?.secondaryLabel ? (
              <button
                type="button"
                className={dialogButtonClassName}
                onClick={() => onResolve("secondary")}
              >
                {confirmation.secondaryLabel}
              </button>
            ) : null}
            <button
              type="button"
              className={confirmButtonClass}
              onClick={() => onResolve("confirm")}
              autoFocus={confirmation?.destructive !== true}
            >
              {confirmation?.confirmLabel}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export const dialogButtonClassName =
  "h-[30px] min-w-[68px] rounded-[5px] border border-[var(--theme-border-strong)] bg-[var(--theme-surface)] px-2.5 text-[13px] text-[var(--theme-control-text)] hover:bg-[var(--theme-control-hover)] hover:text-[var(--theme-title)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-primary)] disabled:opacity-55";

export const primaryDialogButtonClassName =
  `${dialogButtonClassName} border-[var(--theme-primary)] bg-[var(--theme-primary)] text-white hover:bg-[color-mix(in_srgb,var(--theme-primary)_88%,black)] hover:text-white`;
