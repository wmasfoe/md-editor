import type { ReactNode } from "react";

export type CalloutTone = "info" | "warning" | "success" | "danger";

export interface CalloutProps {
  readonly type?: CalloutTone;
  readonly title?: string;
  readonly children?: ReactNode;
}

const toneLabels: Readonly<Record<CalloutTone, string>> = {
  info: "Info",
  warning: "Warning",
  success: "Success",
  danger: "Danger",
};

export function Callout({ type = "info", title, children }: CalloutProps) {
  return (
    <aside data-md-editor-callout={type}>
      <strong>{title ?? toneLabels[type]}</strong>
      {children ? <div>{children}</div> : null}
    </aside>
  );
}
