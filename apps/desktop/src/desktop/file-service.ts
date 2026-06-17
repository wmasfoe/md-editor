import { createFileService } from "@md-editor/file-system";
import { createDesktopFileAdapter } from "./file-adapter";

// FileService is framework-agnostic; this module binds it to the Tauri adapter
// once so React code does not import invoke-level details.
export const fileService = createFileService(createDesktopFileAdapter());
