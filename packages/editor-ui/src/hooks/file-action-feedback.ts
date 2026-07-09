export type FileActionFeedback = "blocking" | "quiet";

export interface RunFileActionOptions {
  readonly feedback?: FileActionFeedback;
}

export type RunFileAction = (
  label: string,
  action: () => Promise<void> | void,
  options?: RunFileActionOptions
) => Promise<void>;

export function shouldShowFileActionOverlay(options?: RunFileActionOptions): boolean {
  return options?.feedback !== "quiet";
}
