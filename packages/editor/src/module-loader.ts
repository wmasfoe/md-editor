/**
 * @file module-loader.ts
 * @description 可选重依赖的懒加载门闸（同步渲染路径专用）。
 *
 * 编辑器有三处同步渲染路径依赖较重的第三方包（HTML 消毒、MDX 解析、粘贴转换）。
 * 它们不能 `await`，所以这里只回答两件事：现在能用吗 / 能用了通知我。
 *
 * 设计要点：
 * - **预加载**：渲染器创建时统一 `preloadOptionalModules()`，通常在用户产生交互前已就绪；
 * - **同步就绪判定**：未就绪时调用方走各自的既有降级路径（HTML 块 → 占位 widget；
 *   MDX 块 → parserCoverage=partial），就绪后由订阅者触发一次重算；
 * - **每模块只加载一次**；失败不永久缓存（允许下次重试）。
 */

interface ModuleEntry {
  value?: unknown;
}

const ready = new Map<string, ModuleEntry>();
const listeners = new Set<() => void>();
const pending = new Map<string, Promise<void>>();

/** 订阅"任意可选模块就绪"事件；返回取消订阅函数。 */
export function onOptionalModuleReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 记录"这一点因为模块未就绪而降级过"。
 *
 * 就绪后只有出现过降级才需要重算；否则会凭空多派一个事务，
 * 干扰正在进行的编辑（实测会打断图形代码块的编辑链路）。
 */
let degradedWhileLoading = false;

export function noteOptionalModuleDegraded(): void {
  degradedWhileLoading = true;
}

/** 取走降级标记（取走即清零，避免重复重算）。 */
export function consumeOptionalModuleDegraded(): boolean {
  const degraded = degradedWhileLoading;
  degradedWhileLoading = false;
  return degraded;
}

/** 已就绪则返回模块，否则返回 `undefined`（调用方据此降级）。 */
export function getOptionalModule<T>(key: string): T | undefined {
  return ready.get(key)?.value as T | undefined;
}

/** 启动一个可选模块的加载（幂等）；返回加载完成 Promise。 */
export function preloadOptionalModule(
  key: string,
  importer: () => Promise<unknown>,
): Promise<void> {
  const existing = pending.get(key);
  if (existing) return existing;
  if (ready.has(key)) return Promise.resolve();

  const task = importer()
    .then((value) => {
      ready.set(key, { value });
      for (const listener of listeners) listener();
    })
    .catch(() => {
      // 失败不永久缓存：下次调用重试（离线/瞬时错误常见）。
      pending.delete(key);
    });
  pending.set(key, task);
  return task;
}

/** 预加载全部门槛模块。渲染器创建时调用一次。 */
export async function preloadOptionalModules(): Promise<void> {
  await Promise.all([
    // CJS 包经 ESM interop 后真实值挂在 `default` 上（没有则回退命名空间本身）。
    preloadOptionalModule("sanitize-html", async () => {
      const mod = await import("sanitize-html");
      return (mod as { default?: unknown }).default ?? mod;
    }),
    preloadOptionalModule("mdx-parser", async () => {
      const [fromMarkdownMod, mdxJsxMod, mdxJsxMicromarkMod, mdxMdMod] = await Promise.all([
        import("mdast-util-from-markdown"),
        import("mdast-util-mdx-jsx"),
        import("micromark-extension-mdx-jsx"),
        import("micromark-extension-mdx-md"),
      ]);
      return {
        fromMarkdown: fromMarkdownMod.fromMarkdown,
        mdxJsxFromMarkdown: mdxJsxMod.mdxJsxFromMarkdown,
        mdxJsxMicromark: mdxJsxMicromarkMod.mdxJsx,
        mdxMd: mdxMdMod.mdxMd,
      };
    }),
    preloadOptionalModule("turndown", async () => {
      const turndownMod = await import("turndown");
      // @ts-expect-error -- turndown-plugin-gfm does not ship official TypeScript definitions on npm
      const gfmMod = await import("turndown-plugin-gfm");
      const TurndownCtor = (turndownMod as { default?: unknown }).default ?? turndownMod;
      return { TurndownService: TurndownCtor, gfm: gfmMod.gfm };
    }),
  ]);
}

/** 测试用：重置加载状态。 */
export function resetOptionalModuleCache(): void {
  degradedWhileLoading = false;
  ready.clear();
  pending.clear();
  listeners.clear();
}
