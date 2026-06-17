import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import {
  createMarkdownImageSrcResolver
} from "@md-editor/markdown-fidelity";

export function resolvePreviewImageSrc(filePath: string | null, src: string): string {
  return createMarkdownImageSrcResolver(filePath, {
    convertFileSrc,
    hasTauriRuntime: isTauri()
  })(src);
}

export function toAssetUrl(path: string): string {
  return isTauri() ? convertFileSrc(path) : path;
}
