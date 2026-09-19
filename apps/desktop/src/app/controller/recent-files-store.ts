import { createRecentFilesStore } from "@md-editor/file-system";
import { createTauriRecentFilesBackend } from "../../desktop/recent-files-tauri-backend";

export const recentFilesStore = createRecentFilesStore(undefined, createTauriRecentFilesBackend());
