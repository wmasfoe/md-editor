import { createRecentFilesStore } from "@md-editor/editor-core";
import { createTauriRecentFilesBackend } from "../../desktop/recent-files-tauri-backend";

export const recentFilesStore = createRecentFilesStore(undefined, createTauriRecentFilesBackend());
