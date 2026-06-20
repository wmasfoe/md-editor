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
    ? "dialog-button dialog-button--primary dialog-button--destructive"
    : "dialog-button dialog-button--primary";

  return (
    <Dialog open={confirmation !== null} onClose={() => onResolve("cancel")} className="confirm-dialog">
      <DialogBackdrop className="confirm-dialog__backdrop" />
      <div className="confirm-dialog__positioner">
        <DialogPanel className="confirm-dialog__panel">
          <DialogTitle className="confirm-dialog__title">{confirmation?.title}</DialogTitle>
          <Description className="confirm-dialog__description">
            {confirmation?.description}
          </Description>
          <div className="confirm-dialog__actions">
            <button
              type="button"
              className="dialog-button"
              onClick={() => onResolve("cancel")}
              autoFocus={confirmation?.destructive === true}
            >
              取消
            </button>
            {confirmation?.secondaryLabel ? (
              <button
                type="button"
                className="dialog-button"
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
