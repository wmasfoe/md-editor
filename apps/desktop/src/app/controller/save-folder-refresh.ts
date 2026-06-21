interface SaveFolderRefreshInput {
  readonly previousPath: string | null;
  readonly savedPath: string;
  readonly openedRootPath: string | null;
}

export function shouldRefreshFolderAfterSave({
  previousPath,
  savedPath,
  openedRootPath
}: SaveFolderRefreshInput): boolean {
  return previousPath !== savedPath || openedRootPath === null;
}
