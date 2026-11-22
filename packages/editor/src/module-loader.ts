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
const listeners = new Set<(key: OptionalModuleKey) => void>();
const pending = new Map<string, Promise<void>>();

/** 三个门槛模块的稳定 key（订阅方据此决定刷新哪些投影）。 */
export const OPTIONAL_MODULE_KEYS = {
  sanitizeHtml: "sanitize-html",
  mdxParser: "mdx-parser",
  turndown: "turndown",
} as const;

/**
 * 模块 key。
 *
 * `(string & {})` 保留已知 key 的自动补全，同时允许任意字符串 —— 加载器本身
 * 是与模块无关的门闸，测试与未来的可选模块不需要改这里。
 */
export type OptionalModuleKey =
  (typeof OPTIONAL_MODULE_KEYS)[keyof typeof OPTIONAL_MODULE_KEYS] | (string & {});

/**
 * 订阅"某个可选模块就绪"事件；返回取消订阅函数。
 *
 * 通知**携带模块名**：三类模块影响的是不同投影（消毒器 → HTML 块预览、
 * MDX 解析器 → 解析索引、Turndown → 仅下次粘贴），不带模块名就只能一律全量
 * 重算，连"只供下次粘贴使用"的 Turndown 就绪也会触发整份 range index 重建。
 */
export function onOptionalModuleReady(listener: (key: OptionalModuleKey) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 已就绪则返回模块，否则返回 `undefined`（调用方据此降级）。 */
export function getOptionalModule<T>(key: string): T | undefined {
  return ready.get(key)?.value as T | undefined;
}

/** 启动一个可选模块的加载（幂等）；返回加载完成 Promise。 */
export function preloadOptionalModule(
  key: OptionalModuleKey,
  importer: () => Promise<unknown>,
): Promise<void> {
  const existing = pending.get(key);
  if (existing) return existing;
  if (ready.has(key)) return Promise.resolve();

  const task = importer()
    .then((value) => {
      ready.set(key, { value });
      notifyReady(key);
    })
    .catch(() => {
      // 失败不永久缓存：下次调用重试（离线/瞬时错误常见）。
      pending.delete(key);
    });
  pending.set(key, task);
  return task;
}

/**
 * 逐个通知订阅者。
 *
 * **单个监听器抛错不得影响其余订阅者**：多实例宿主里一个视图刷新失败，
 * 不应该让其它编辑器永远收不到"已就绪"（它们会永久停在降级态）。
 * 也刻意不把异常往上抛给 `preloadOptionalModule` 的 `.catch` —— 那会把
 * "某视图刷新失败"误记成"模块导入失败"，进而清掉 pending 导致重复导入。
 */
function notifyReady(key: OptionalModuleKey): void {
  for (const listener of listeners) {
    try {
      listener(key);
    } catch (error) {
      // 视图侧刷新失败不该阻断其它视图；记录后继续。
      if (typeof console !== "undefined") {
        console.error(`[md-editor] optional module listener failed for "${key}"`, error);
      }
    }
  }
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
  ready.clear();
  pending.clear();
  listeners.clear();
}
