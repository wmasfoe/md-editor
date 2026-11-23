/**
 * @file readme-examples.mjs
 * @description README 示例编译门禁（R-1）。
 *
 * 只编译**显式标记**的代码块：在围栏前一行写 `<!-- readme-check -->`。
 * 原因：README 里大量片段是示意性的（片段级 JSX、省略上下文的调用），
 * 强制全量编译会制造噪声豁免；标记制确保"最常被复制的那几段"真的能编译。
 *
 * 解析目标为 workspace **源码**入口（与本地开发一致，而非 dist）。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const PUBLIC_PACKAGES = [
  "core",
  "editor",
  "plugin-sdk",
  "plugin-host",
  "markdown-fidelity",
  "shared",
];

const MARKER = "<!-- readme-check -->";

/**
 * 需要扫描的 README 集合：公开子包 + 仓库根 README（中英）。
 *
 * 根 README 曾被漏掉，导致"自定义 MDX 组件通过 `@md-editor/plugin-sdk/mdx` 注册"
 * 在子入口删除后仍留在首页（R-2 就是为了堵这类"文档教已删 API"）。
 */
export const README_TARGETS = [
  ...PUBLIC_PACKAGES.map((pkg) => join("packages", pkg, "README.md")),
  // 子包的实战指南与 README 同等对待：标记过的示例必须能编译，
  // 引用的子入口必须真实存在 —— 否则"文档教已删 API"会从 README 漏到 USAGE。
  ...PUBLIC_PACKAGES.map((pkg) => join("packages", pkg, "USAGE.md")),
  "README.md",
  "README_ZH.md",
];

/** 抽出被标记的代码块。返回 `[{ readme, index, lang, code }]`。 */
export function extractCheckedBlocks(readmePath, source = readFileSync(readmePath, "utf8")) {
  const lines = source.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== MARKER) continue;
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim() === "") cursor += 1;
    const fence = /^```(ts|tsx|typescript)\s*$/u.exec(lines[cursor] ?? "");
    if (!fence) continue;
    const lang = fence[1];
    const code = [];
    cursor += 1;
    while (cursor < lines.length && !lines[cursor].startsWith("```")) {
      code.push(lines[cursor]);
      cursor += 1;
    }
    blocks.push({ readme: readmePath, index, lang, code: code.join("\n") });
  }
  return blocks;
}

/**
 * 第三方包的类型入口（按需解析，不硬编码路径）。
 *
 * 示例代码会被写到系统临时目录，`node_modules` 不在其祖先链上，所以除了
 * workspace 源码别名，还要显式给出第三方包的查找路径 —— 否则
 * `import { lint } from "markdownlint/sync"` 这类**文档推荐写法**会被
 * "找不到模块"误判为错误，逼得我们把示例标记去掉（正是这次踩到的坑）。
 *
 * pnpm 下第三方包不是根级软链，真实路径在 `.pnpm/<pkg>@<ver>/node_modules/...`，
 * 因此用 `require.resolve` 从**实际安装它的 workspace 包**解析，而不是拼路径。
 */
function resolveThirdParty(packageId, fromDir) {
  try {
    const entry = createRequire(join(REPO_ROOT, fromDir, "package.json")).resolve(packageId);
    return entry;
  } catch {
    return null;
  }
}

const PATHS = {
  "@md-editor/core": ["packages/core/src/index.ts"],
  "@md-editor/editor": ["packages/editor/src/index.ts"],
  "@md-editor/editor/internals": ["packages/editor/src/internals.ts"],
  "@md-editor/editor/react": ["packages/editor/src/react/index.ts"],
  "@md-editor/editor/testing": ["packages/editor/src/testing.ts"],
  "@md-editor/plugin-sdk": ["packages/plugin-sdk/src/index.ts"],
  "@md-editor/plugin-sdk/syntax": ["packages/plugin-sdk/src/syntax.ts"],
  "@md-editor/shared/mdx": ["packages/shared/src/mdx.ts"],
  "@md-editor/plugin-sdk/callout": ["packages/plugin-sdk/src/callout-data.ts"],
  "@md-editor/plugin-host": ["packages/plugin-host/src/index.ts"],
  "@md-editor/plugin-host/github": ["packages/plugin-host/src/github.ts"],
  "@md-editor/plugin-host/mdx": ["packages/plugin-host/src/mdx.ts"],
  "@md-editor/markdown-fidelity": ["packages/markdown-fidelity/src/index.ts"],
  "@md-editor/shared": ["packages/shared/src/index.ts"],
};

/**
 * README 示例里出现的第三方包 → 类型入口映射。
 *
 * 只登记"文档里推荐宿主直接用"的包。新增时在这里加一行，
 * 对应 README 片段才有编译保障。
 */
function thirdPartyPaths() {
  const paths = {};
  // markdownlint 由 app-ui 安装（编辑器只声明可选 peer）。
  // 指向 `.d.mts` 类型声明而不是 `.mjs` 实现：临时目录下 TS 的 Bundler 解析
  // 不会为 paths 目标反查同名声明文件。
  const markdownlint = resolveThirdParty("markdownlint/sync", "packages/app-ui");
  const declaration = markdownlint?.replace(/\.mjs$/u, ".d.mts");
  if (declaration) {
    paths["markdownlint/sync"] = [declaration];
  }
  return paths;
}

/** 编译全部被标记的示例；返回 tsc 输出（成功时为空串）。 */
export function checkReadmeExamples() {
  const dir = mkdtempSync(join(tmpdir(), "inkpoint-readme-"));
  try {
    const files = [];
    for (const relative of README_TARGETS) {
      const readme = join(REPO_ROOT, relative);
      const label = relative.replaceAll("/", "-").replace(/\.md$/u, "");
      for (const block of extractCheckedBlocks(readme)) {
        const name = `${label}-${block.index}.${block.lang === "tsx" ? "tsx" : "ts"}`;
        writeFileSync(join(dir, name), `${block.code}\n`);
        files.push(name);
      }
    }
    if (files.length === 0) return "";
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2022", "ES2023.Array", "DOM", "DOM.Iterable"],
            module: "ESNext",
            moduleResolution: "Bundler",
            allowImportingTsExtensions: true,
            jsx: "react-jsx",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            typeRoots: [join(REPO_ROOT, "node_modules/@types")],
            baseUrl: REPO_ROOT,
            paths: {
              ...PATHS,
              ...thirdPartyPaths(),
            },
          },
          include: files,
        },
        null,
        2,
      ),
    );
    try {
      execFileSync(
        process.execPath,
        [join(REPO_ROOT, "node_modules/typescript/bin/tsc"), "-p", dir],
        {
          cwd: dir,
          encoding: "utf8",
          stdio: "pipe",
        },
      );
      return "";
    } catch (error) {
      return `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * R-2：README 里出现的 `@md-editor/<pkg>` 子入口必须真实存在于该包的 exports。
 *
 * 反向检查（文档 → 包清单），专门拦"文档指向已删除的子入口"。
 * @returns 违规描述列表（空数组表示通过）。
 */
export function findStaleSubpathReferences() {
  const offenders = [];
  const manifests = new Map();
  const manifestOf = (pkg) => {
    if (!manifests.has(pkg)) {
      const path = join(REPO_ROOT, "packages", pkg, "package.json");
      manifests.set(pkg, JSON.parse(readFileSync(path, "utf8")));
    }
    return manifests.get(pkg);
  };

  for (const relative of README_TARGETS) {
    const path = join(REPO_ROOT, relative);
    let source;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(/@md-editor\/([a-z-]+)(\/[a-z-]+)?/gu)) {
      const [, pkg, subpath] = match;
      if (!PUBLIC_PACKAGES.includes(pkg)) continue;
      let manifest;
      try {
        manifest = manifestOf(pkg);
      } catch {
        continue;
      }
      const keys = Object.keys(manifest.exports ?? {});
      if (subpath && !keys.includes(`.${subpath}`)) {
        offenders.push(
          `${relative}: @md-editor/${pkg}${subpath}（该包 exports 只有 ${keys.join(", ")}）`,
        );
      }
    }
  }
  return offenders;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const output = checkReadmeExamples();
  if (output) {
    console.error(output);
    process.exit(1);
  }
  console.log("README 标记示例全部通过 typecheck");
}
