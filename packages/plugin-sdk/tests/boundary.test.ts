import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 允许出现在 SDK `peerDependencies` 里的包前缀。
 *
 * 白名单语义是"**可选**的运行期同伴"：全部在 `peerDependenciesMeta` 中标为 `optional`，
 * 因此不安装它们时 SDK 仍然可用——只是对应能力不可用。SDK 自身**零 `dependencies`**，
 * 这条不变量才是边界测试真正要守的东西。
 *
 * - `@codemirror/*`、`@lezer/*`：语法插件契约的类型来源（`EditorState`、`Decoration`、
 *   `MarkdownConfig`、`SyntaxNode` 等）。只写命令/模板类插件不需要它们。
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
      /@md-editor\/(?:plugin-host|editor-core|renderer-codemirror|syntax-plugins|mdx-plugins)|@tauri-apps|from ["']react/,
    );
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    // SDK 自身不得有硬依赖：所有运行期同伴都必须是 optional peer，
    // 这样"只写命令/模板类插件"的作者不需要安装任何额外包。
    expect(manifest.dependencies ?? {}).toEqual({});
    const peers = Object.keys(manifest.peerDependencies ?? {});
    expect(peers.every((name) => ALLOWED_PEER_PREFIXES.some((re) => re.test(name)))).toBe(true);
    // 每一个 peer 都必须显式标为 optional，否则安装 SDK 会强制拉取。
    for (const name of peers) {
      expect(manifest.peerDependenciesMeta?.[name]?.optional).toBe(true);
    }
  });
});
