import { describe, expect, it } from "vitest";
import { validateMarkdownRelativeLinks } from "../src/link/index.ts";

describe("LinkValidator (本地相对链接与图片检查探针)", () => {
  it("resolves resources relative to a document in the POSIX root", async () => {
    const paths: string[] = [];
    const diagnostics = await validateMarkdownRelativeLinks("![Image](assets/A.png)", {
      documentPath: "/document.md",
      fileExists: async (path) => {
        paths.push(path);
        return true;
      },
    });
    expect(paths).toEqual(["/assets/A.png"]);
    expect(diagnostics).toEqual([]);
  });

  it("跳过外部链接和同文档纯锚点", async () => {
    const markdown = `
[Google](https://google.com)
[Docs](http://docs.dev)
[Email](mailto:test@example.com)
[Local Section](#my-heading)
`;
    const diagnostics = await validateMarkdownRelativeLinks(markdown, {
      documentPath: "/workspace/doc.md",
      fileExists: async () => false,
    });

    expect(diagnostics).toHaveLength(0);
  });

  it("能识别不存在的本地相对图片与文件，并正确计算 offset", async () => {
    const markdown = `Here is an image: ![Avatar](./assets/avatar.png) and a [Guide](../docs/guide.md).`;

    const existing = new Set(["/workspace/assets/avatar.png"]);

    const diagnostics = await validateMarkdownRelativeLinks(markdown, {
      documentPath: "/workspace/doc.md",
      fileExists: async (path) => existing.has(path),
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].kind).toBe("missing");
    expect(diagnostics[0].rawTarget).toBe("../docs/guide.md");
    expect(diagnostics[0].resolvedPath).toBe("/docs/guide.md");
    expect(markdown.slice(diagnostics[0].from, diagnostics[0].to)).toBe("../docs/guide.md");
  });

  it("处理 URL 编码与中文字符路径", async () => {
    const markdown = `[设计文档](./设计%20文档.md)`;
    const existing = new Set(["/workspace/设计 文档.md"]);

    const diagnostics = await validateMarkdownRelativeLinks(markdown, {
      documentPath: "/workspace/doc.md",
      fileExists: async (path) => existing.has(path),
    });

    expect(diagnostics).toHaveLength(0);
  });

  it("Fail-open: 文件探针遇到 I/O 权限异常时标记 access-error 而非 missing", async () => {
    const markdown = `[Secret](./secret.md)`;

    const diagnostics = await validateMarkdownRelativeLinks(markdown, {
      documentPath: "/workspace/doc.md",
      fileExists: async () => {
        throw new Error("EACCES: permission denied");
      },
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].kind).toBe("access-error");
  });

  it("支持跨文档锚点有效性检查", async () => {
    const markdown = `[Guide](./guide.md#api-reference) and [Bad](./guide.md#not-found)`;

    const files = new Map([
      ["/workspace/guide.md", "# Guide\n\n## API Reference\n\nDetails here."],
    ]);

    const diagnostics = await validateMarkdownRelativeLinks(markdown, {
      documentPath: "/workspace/doc.md",
      fileExists: async (path) => files.has(path),
      readFile: async (path) => files.get(path) ?? null,
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].kind).toBe("anchor-missing");
    expect(diagnostics[0].anchor).toBe("not-found");
  });

  it("批量探针按目标文件去重并只读一次锚点内容", async () => {
    const calls: string[][] = [];
    const markdown =
      "[one](./guide.md#api-reference) [two](./guide.md#missing) [plain](./guide.md)";
    const diagnostics = await validateMarkdownRelativeLinks(markdown, {
      documentPath: "/workspace/文档.md",
      probeTargets: async (targets) => {
        calls.push(targets.map(({ path, includeHeadings }) => `${path}:${includeHeadings}`));
        return { "/workspace/guide.md": { exists: true, headingLines: "## API Reference" } };
      },
    });
    expect(calls).toEqual([["/workspace/guide.md:true"]]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].anchor).toBe("missing");
  });

  it("批量探针将原生读取权限错误保留为 access-error", async () => {
    const diagnostics = await validateMarkdownRelativeLinks("[Guide](./guide.md#intro)", {
      documentPath: "/workspace/doc.md",
      probeTargets: async () => ({
        "/workspace/guide.md": { exists: true, headingLines: null, accessError: true },
      }),
    });
    expect(diagnostics.map(({ kind }) => kind)).toEqual(["access-error"]);
  });

  it("批量探针保留 Windows 路径分隔符与编码字符", async () => {
    let probed: readonly string[] = [];
    const markdown = "[文档](./设计%20文档.md#api)";
    const diagnostics = await validateMarkdownRelativeLinks(markdown, {
      documentPath: "C:\\workspace\\note.md",
      probeTargets: async (targets) => {
        probed = targets.map(({ path, includeHeadings }) => `${path}:${includeHeadings}`);
        return { "C:/workspace/设计 文档.md": { exists: true, headingLines: "# API" } };
      },
    });
    expect(probed).toEqual(["C:/workspace/设计 文档.md:true"]);
    expect(diagnostics).toEqual([]);
  });
});
