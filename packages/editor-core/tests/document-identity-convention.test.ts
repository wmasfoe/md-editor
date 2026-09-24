import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 结构护栏（architect delta 复审 R4）：**任何非测试代码调用 `replaceDocument` 都必须
 * 显式声明文档身份**（`replaceIntent`），或位于白名单内并写明理由。
 *
 * 为什么需要它：未声明 ⇒ 渲染层按 fail-safe `"different"` 把视口归零。若该调用其实属于
 * 「同一篇文档的内容变更 / 重装载」，就会把正在阅读的用户**弹回顶部**。
 * 这正是 code-reviewer 复审 MEDIUM-1 发现的问题：第五个宿主
 * `site/components/mdx-wipe-canvas.tsx` 在移除渲染层推断后漏声明 —— 而它位于 `site/`，
 * 既不在 `apps/**` 也不在 `packages/**`，两次人工审计都漏了。本护栏把该约束前移到**编写路径**，
 * 新增宿主忘记声明时立即变红，而不是等下一次人工评审。
 *
 * 白名单 = **有意不声明**的调用点（真·新建 / 重置 / 划词新建等「确实换文档」的场景）；
 * 键为调用点的 `commandId`（比行号稳定），每条都必须写明依据，并由第二个用例强制依据非空。
 */
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const INTENTIONALLY_UNDECLARED: Record<string, string> = {
  "file.new": "新建空白文档（filePath: null）⇒ 确实换文档，fail-safe 的 different 就是正确语义",
  "file.newDraft": "web 新建草稿（filePath: null）⇒ 换文档",
  "web.reset": "web 重置到示例内容 ⇒ 换文档",
  "utools.selectionEdit": "划词进入 = 以选中文本开新文档（filePath: null）⇒ 换文档",
  "utools.selectTreeFile":
    "该调用点前有 `if (path === 当前路径) return;` 守卫 ⇒ 可达分支必为换文档",
  "file-tree.delete": "当前文档被删除 ⇒ 换成空白文档（归零是预期 UX）",
  "sample.switch": "site 切换示例样例 = 换一篇文档（新样例从顶部开始是预期 UX）",
  "ai.showcase.phase1": "site AI 演示进入阶段一 = 换一套脚本内容（阶段切换从顶部开始是预期 UX）",
  "ai.showcase.phase2.standalone": "同上（阶段二独立内容）⇒ 换文档",
};

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".omx",
  ".pi",
  "test-results",
  "playwright-report",
  "target",
  "coverage",
]);

/** 测试/夹具/桥面代码不受本约定约束（它们直接构造快照或模拟宿主） */
function isTestLike(path: string): boolean {
  return (
    path.includes("/e2e/") ||
    path.includes("/tests/") ||
    path.includes("/testing/") ||
    /\.(test|spec)\.tsx?$/.test(path)
  );
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out);
    } else if (/\.tsx?$/.test(path) && !isTestLike(path)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * 取出 `callee` 的每个调用表达式（按括号配对，避免截到相邻调用）。
 *
 * 只认 `<某对象>.replaceDocument(`（真实调用点）；裸调用（如 `replaceDocument(document)`
 * 这种对本地回调的**委托**）与方法定义/类型声明不计入 —— 前者由被委托方声明。
 */
function callExpressions(source: string, callee: string): string[] {
  const out: string[] = [];
  let index = source.indexOf(callee);
  while (index !== -1) {
    let depth = 0;
    let cursor = index + callee.length - 1;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === "(") {
        depth += 1;
      } else if (source[cursor] === ")") {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
    }
    out.push(source.slice(index, cursor + 1));
    index = source.indexOf(callee, cursor + 1);
  }
  return out;
}

describe("文档身份声明约定（源码级结构护栏）", () => {
  it("每个非测试 replaceDocument 调用都必须声明 replaceIntent，或在白名单内", () => {
    const offenders: string[] = [];
    for (const dir of ["apps", "packages", "site", "infra"]) {
      for (const file of sourceFiles(join(REPO_ROOT, dir))) {
        const source = readFileSync(file, "utf-8");
        if (!source.includes(".replaceDocument(")) {
          continue;
        }
        const relative = file.slice(REPO_ROOT.length);
        for (const expression of callExpressions(source, ".replaceDocument(")) {
          // 只审「构造了替换输入」的真实调用（注释/类型声明不会包含 markdown:）
          if (!expression.includes("markdown:")) {
            continue;
          }
          if (expression.includes("replaceIntent")) {
            continue;
          }
          const commandId = /commandId:\s*"([^"]+)"/.exec(expression)?.[1];
          if (commandId !== undefined && INTENTIONALLY_UNDECLARED[commandId] !== undefined) {
            continue;
          }
          offenders.push(`${relative} [commandId=${commandId ?? "?"}]`);
        }
      }
    }
    // 失败时 offenders 数组自身即诊断信息（逐条含文件路径与 commandId）
    expect(offenders).toEqual([]);
  });

  it("白名单必须逐条写明依据（防止无声扩张）", () => {
    const tooShort = Object.entries(INTENTIONALLY_UNDECLARED)
      .filter(([, reason]) => reason.length <= 15)
      .map(([commandId]) => commandId);
    // 依据必须具体：过短的理由视为「无声扩白名单」（失败信息即命令 id）
    expect(tooShort).toEqual([]);
  });
});
