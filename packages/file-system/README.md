# @md-editor/file-system

File access for the desktop app, the web playground and the uTools plugin. The app code talks to one interface, and each host supplies its own implementation (Tauri commands, an in-memory file system, or the uTools API).

## What is in it

| Area | Exports | Purpose |
| :--- | :--- | :--- |
| Files and folders | `FileServiceAdapter`, `createFileService`, `createRuntimeFileService` | Open a file or a folder, read a file, create, rename and delete tree items |
| Ordered saving | `createFileSaveScheduler`, `FileSaveJob`, `FileSaveOutcome` | Queue saves so they reach the disk in order, even when saves overlap |
| Images | `planImagePasteTarget`, `nextAssetFileName`, `appendImageMarkdown`, `resolveAssetsDirectoryForDocument` | Decide where a pasted or dropped image is stored and build its Markdown link |
| Recent files | `createRecentFilesStore` | Recently opened files |
| File tree state | `readCollapsedPaths`, `writeCollapsedPaths`, `collectAncestorDirectoryPaths` | Which folders are collapsed, per workspace root |
| Draft recovery | `session/` (`session-store`) | Keeps unsaved edits so they can be restored after a quit or crash |
| History | `history/` (`history-store`) | Local snapshots of a document |
| Link checks | `link/` (`link-validator`) | Checks relative file links and heading anchors |

## Ordered saves

`createFileSaveScheduler` takes a native adapter, a runtime registration and options. Every job carries a document generation and a checkpoint sequence, so a stale save cannot overwrite a newer one.

```typescript
import { createFileSaveScheduler } from "@md-editor/file-system";

const scheduler = createFileSaveScheduler(
  { saveMarkdownJob: (job) => invokeNativeSave(job) }, // atomic write on the native side
  registration, // { epoch, id, sequenceSeed } issued by the host
  { timeoutMs: 15_000 },
);

const outcome = await scheduler.enqueueSaveJob({
  jobId: "save-42",
  checkpointSequence: 42,
  documentGeneration: 3,
  markdownLf: "# Notes\n",
  destination: { kind: "current-path", path: "/notes/today.md" },
});

if (outcome.status === "succeeded") {
  console.log("saved to", outcome.filePath);
}
```

`status` is one of `succeeded`, `failed`, `cancelled`, `indeterminate` (the write may or may not have reached the disk) and `superseded-before-commit` (a newer save replaced this one). Check it before using the result.

## Development

```bash
pnpm test
pnpm typecheck
```
