interface SaveFolderRefreshInput {
  readonly previousPath: string | null;
  readonly savedPath: string;
}

export function shouldRefreshFolderAfterSave({
  previousPath,
  savedPath
}: SaveFolderRefreshInput): boolean {
  return previousPath !== savedPath;
}
