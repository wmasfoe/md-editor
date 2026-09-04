import { MODEL_CHANGELOG_URL } from "./model-changelog";

export const MODEL_CHANGELOG_REVALIDATE_SECONDS = 60 * 60;

/**
 * 远端 changelog 由模型仓库维护。这里不做业务规则校验，只负责读取 JSON；
 * 页面组件会按字段是否可渲染做宽容降级。
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
