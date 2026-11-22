/**
 * @file heading-slug.ts
 * @description 标题锚点的**唯一**规范实现（GitHub / GFM 语义）。
 *
 * 收敛前仓库里有四套算法，其中三套语义互不一致：
 * - `markdown-fidelity` 的私有 `slugify`（大纲用）只保留 `a-z0-9` 与汉字，
 *   俄文/韩文/日文假名会被整体丢弃，产出空 id 或 `-2` 这种塌陷 id；
 * - `markdown-fidelity.headingAnchorSlug`（文档内 `#锚点` 跳转用）Unicode 感知但不去重；
 * - `compiler.generateHeadingSlug`（导出 HTML 的 `id`）把字面 `_` 也删了，
 *   `snake_case` 变成 `snakecase`，与文档内链接不一致。
 *
 * 本模块是它们的共同祖先：`markdown-fidelity` 与 `compiler` 都委托到这里。
 * 规则按 GitHub 行为：
 * - 锚点基于**渲染后的可见文本**（剥掉行内语法与 HTML 标签）；
 * - 小写折叠；丢弃 Unicode 标点与符号；空白折叠为 `-`；**保留** `-` 与 `_`；
 * - 重复标题依次加 `-1`、`-2`（第一个不加后缀）；
 * - 可见文本为空时兜底为 `section`，避免空 id。
 */

/** 剥掉行内 Markdown 与 HTML 标签，得到"渲染后可见文本"。 */
export function headingSlugSource(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/gu, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/gu, "$1")
    .replace(/<[^>]*>/gu, "")
    .replace(/\*\*|~~|__/gu, "")
    .replace(/[*`]/gu, "");
}

/**
 * 单个标题的锚点（**不做**去重）。
 *
 * 注意 `_` 单下划线**不**剥除：`snake_case` 必须保持原样，否则文档内
 * `#snake_case` 链接与导出 HTML 的 `id` 会分叉。
 */
export function slugifyHeading(source: string): string {
  return headingSlugSource(source)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export const EMPTY_HEADING_SLUG = "section";

/**
 * 创建文档级分配器：同一文档内重复标题按 GitHub 语义加 `-1`、`-2`。
 *
 * 必须是**有状态**的：去重是文档级属性，单个标题函数无法表达。
 * 调用方（大纲提取、HTML 导出）各自为每份文档创建一个实例，顺序即文档顺序。
 *
 * 去重依据是**最终 ID**，不是原始 slug。只按原始 slug 计数会撞车：
 * `A` / `A` / `A-1` 曾产出 `a` / `a-1` / `a-1` —— 第三个标题与第二个同名，
 * `#a-1` 只能跳到其中一个。这里把已分配出去的 ID 全部登记，逐个尝试
 * `base`、`base-1`、`base-2`… 直到拿到未占用的那个。
 */
export function createHeadingSlugAllocator(
  fallback: string = EMPTY_HEADING_SLUG,
): (source: string) => string {
  /** 已分配出去的最终 ID（含空标题的兜底值）。 */
  const used = new Set<string>();
  return (source: string) => {
    const base = slugifyHeading(source) || fallback;
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    // 从 1 开始递增，跳过已被别的标题显式占用的后缀。
    let suffix = 1;
    while (used.has(`${base}-${suffix}`)) {
      suffix += 1;
    }
    const id = `${base}-${suffix}`;
    used.add(id);
    return id;
  };
}
