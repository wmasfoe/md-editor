import { MODEL_CHANGELOG_URL } from "./model-changelog";
import fallbackModelChangelog from "./model-changelog-fallback.json";

export const MODEL_CHANGELOG_REVALIDATE_SECONDS = 60 * 60;

/**
 * 远端 changelog 由模型仓库维护。优先从远端读取最新 JSON；
 * 当网络异常或离线构建时，宽容回退到本地内置的最新快照，保障 PR 链接与版本记录永不丢失。
 */
export async function getModelChangelog(): Promise<unknown | null> {
  try {
    const response = await fetch(MODEL_CHANGELOG_URL, {
      next: { revalidate: MODEL_CHANGELOG_REVALIDATE_SECONDS },
    });

    if (response.ok) {
      return await response.json();
    }
    console.error(`Failed to fetch model changelog: HTTP ${response.status}`);
  } catch (error) {
    console.error("Failed to read remote model changelog, falling back to local snapshot", error);
  }

  return fallbackModelChangelog;
}
