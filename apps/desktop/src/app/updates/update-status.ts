import type { UpdateStatus } from "../settings/app-settings";

export function isUpdateReadyToApply(status: UpdateStatus): boolean {
  return status.state === "downloaded" || status.state === "installed";
}

export function isUpdateActionBusy(status: UpdateStatus): boolean {
  return (
    status.state === "downloading" || status.state === "installing" || status.state === "checking"
  );
}

export function shouldShowEditorUpdateAction(status: UpdateStatus): boolean {
  return (
    status.installKind === "app" &&
    (status.state === "available" ||
      status.state === "downloading" ||
      status.state === "downloaded" ||
      status.state === "installing" ||
      status.state === "installed")
  );
}
