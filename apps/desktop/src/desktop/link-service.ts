import { invoke, isTauri } from "@tauri-apps/api/core";

export type LinkedFileKind = "markdown" | "asset" | "file";

export interface LinkedFileTarget {
  readonly path: string;
  readonly kind: LinkedFileKind;
}

export async function inspectLinkedFileTarget(
  documentPath: string,
  href: string
): Promise<LinkedFileTarget> {
  assertDesktopRuntime();
  return invoke<LinkedFileTarget>("inspect_linked_file", { documentPath, href });
}

export async function openExternalTarget(target: string): Promise<void> {
  if (!isTauri()) {
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }

  await invoke("open_external_target", { target });
}

function assertDesktopRuntime() {
  if (!isTauri()) {
    throw new Error("Link file operations are available in the Tauri desktop app.");
  }
}
