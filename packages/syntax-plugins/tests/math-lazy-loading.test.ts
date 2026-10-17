import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * KaTeX 惰性加载契约（防「启动即加载」回归）。
 *
 * 背景：`math-loader.ts` 曾在模块作用域无条件调用 `loadKatex()`，导致任何从
 * `@md-editor/syntax-plugins` 根入口导入的应用（web / desktop / utools）在打开文档时
 * 就加载约 261 kB（gzip 77 kB）的 KaTeX chunk + 样式，哪怕文档里没有公式。
 * 修复后由公式 widget 与 `renderMathHtml` 兜底分支按需触发。
 */

const loaderSource = readFileSync(new URL("../src/math/math-loader.ts", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/math/katex-styles.ts", import.meta.url), "utf8");

describe("KaTeX lazy loading contract (@md-editor/syntax-plugins)", () => {
  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  });

  it("does not load KaTeX at module scope even in a browser-like environment", async () => {
    vi.resetModules();
    // 模拟浏览器条件：旧实现在此条件下会立即预加载
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
    Object.defineProperty(globalThis, "document", { value: {}, configurable: true });

    const loader = await import("../src/math/math-loader.ts");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(loader.getLoadedKatex()).toBeNull();
  });

  it("loads KaTeX only on demand and renders real KaTeX markup afterwards", async () => {
    vi.resetModules();
    const loader = await import("../src/math/math-loader.ts");

    expect(loader.getLoadedKatex()).toBeNull();

    const pending = loader.renderMathHtml("x^2 + y^2 = z^2", false);
    expect(pending.html).toContain("cm-md-math-loading");

    await loader.loadKatex();
    expect(loader.getLoadedKatex()).not.toBeNull();

    const rendered = loader.renderMathHtml("x^2 + y^2 = z^2", false);
    expect(rendered.error).toBeUndefined();
    expect(rendered.html).toContain("katex");
  });

  it("keeps the stylesheet owned by this package as a lazy import", () => {
    // 全平台已移除全局 @import katex.min.css（含 mobile 阅读器与官网），
    // 因此这里必须保留包内惰性样式装载，否则公式会失去排版样式。
    expect(loaderSource).toContain('import("./katex-styles.ts")');
    expect(stylesSource).toContain('import "katex/dist/katex.min.css"');
  });

  it("exposes an idempotent explicit stylesheet trigger for static-render hosts", async () => {
    vi.resetModules();
    const loader = await import("../src/math/math-loader.ts");

    // 静态渲染宿主（如移动端阅读器）依赖此显式入口；重复调用必须安全且返回同一 promise。
    const first = loader.ensureKatexStylesheet();
    const second = loader.ensureKatexStylesheet();

    expect(second).toBe(first);
    await expect(first).resolves.toBeDefined();
    // 仅索取样式不应顺带把运行时拉起来
    expect(loader.getLoadedKatex()).toBeNull();
  });

  it("keeps the module free of module-scope loading side effects", () => {
    expect(loaderSource).not.toMatch(/^void loadKatex\(\)/mu);
    // 旧实现在模块作用域用浏览器守卫触发预加载；该守卫不得再出现在顶层
    expect(loaderSource).not.toMatch(/^if \(typeof window/u);
  });
});
