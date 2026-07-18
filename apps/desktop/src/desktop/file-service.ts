import {
  createRuntimeFileService,
  type FileSaveSchedulerOptions,
  type NativeSaveRuntimeRegistration,
  type RuntimeFileService,
} from "@md-editor/file-system";
import { createDesktopFileAdapter, createDesktopNativeSaveAdapter } from "./file-adapter";

export function createDesktopRuntimeFileService(
  registration: NativeSaveRuntimeRegistration,
  options?: FileSaveSchedulerOptions,
): RuntimeFileService {
  return createRuntimeFileService(
    createDesktopFileAdapter(),
    createDesktopNativeSaveAdapter(),
    registration,
    options,
  );
}
