export const GLOBAL_LOADING_TITLE = "处理中…";

export function getLoadingDescription(label: string | null): string | undefined {
  if (!label) {
    return undefined;
  }

  return label.startsWith("正在") ? `${label.slice(2)}…` : label;
}
