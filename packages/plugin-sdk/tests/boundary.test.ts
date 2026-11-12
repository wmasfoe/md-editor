import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 允许出现在 SDK `peerDependencies` 里的包前缀。
 *
 * SDK 不直接依赖宿主实现。根入口声明引用这些同伴类型，因此必须将
 * 它们声明为必需 peer，确保严格 TypeScript 消费者能够解析声明。
 *
 * - `@codemirror/*`、`@lezer/*`：语法插件契约的类型来源（`EditorState`、`Decoration`、
 *   `MarkdownConfig`、`SyntaxNode` 等）。
 * - `micromark-extension-cjk-friendly-util`：CJK 友好的定界符 flanking 分类器。
 *   语法插件（如 `==高亮==`）在 **Lezer 解析期** 运行，`InlineContext` 不暴露
 *   `EditorState`，无法通过 facet 端口注入，只能直接调用这些纯函数。把实现放在
 *   SDK 是为了让插件不必反向 import 宿主渲染器（那会造成"插件依赖插件宿主"的倒置）。
 */
const ALLOWED_PEER_PREFIXES = [
  /^@codemirror\//u,
  /^@lezer\//u,
  /^micromark-extension-cjk-friendly-util$/u,
];

describe("public SDK dependency boundary", () => {
  it("keeps app, host and editor implementations out of the author package", () => {
    const directory = new URL("../src/", import.meta.url);
    const source = readdirSync(directory)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(new URL(name, directory), "utf8"))
      .join("\n");
    expect(source).not.toMatch(
      /@md-editor\/(?:plugin-host|core|editor|syntax-plugins|mdx-plugins)|@tauri-apps|from ["']react/,
    );
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    // SDK 只通过 peer 依赖共享宿主的 CodeMirror 和 Lezer 实例。
    expect(manifest.dependencies ?? {}).toEqual({});
    const peers = Object.keys(manifest.peerDependencies ?? {});
    expect(peers.every((name) => ALLOWED_PEER_PREFIXES.some((re) => re.test(name)))).toBe(true);
    // 根入口的声明会传递引用这些类型，严格消费者必须能够解析它们。
    for (const name of peers) {
      expect(manifest.peerDependenciesMeta?.[name]?.optional).not.toBe(true);
    }
  });
});
