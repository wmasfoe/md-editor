import { MODEL_CHANGELOG_URL } from "./model-changelog";

/** 与 GitHub raw 的 Cache-Control (300 秒) 对齐，保证模型仓库发版或改动后 5 分钟内自动刷新 */
export const MODEL_CHANGELOG_REVALIDATE_SECONDS = 5 * 60;

/**
 * 远端 changelog 由模型仓库（md-editor-models）单一事实源维护。
 * 每次请求按 ISR 缓存策略从 GitHub raw 动态拉取最新 JSON；
 * 模型仓库只要合入 PR 或修改 changelog.json，站点无需重新发版，缓存到期后自动同步最新内容。
 */
export async function getModelChangelog(): Promise<unknown | null> {
  try {
    const response = await fetch(MODEL_CHANGELOG_URL, {
      next: { revalidate: MODEL_CHANGELOG_REVALIDATE_SECONDS },
    });

    if (!response.ok) {
      console.error(`Failed to fetch model changelog: HTTP ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to read model changelog", error);
    return null;
  }
}
