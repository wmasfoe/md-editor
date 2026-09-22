import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 受保护注解惯例的**结构性护栏**（轮1 architect concern-4 提出、轮2 WATCH① 收窄补全）。
 *
 * 断言面（v2，按轮2 architect 盲区清单逐条闭合）：
 * 1. **范围**：扫描整个 `src/`（不再只有 `src/wysiwyg/**`）—— renderer.ts 的
 *    reconcile/external-edit dispatch（其 :818/:881 均已带注解）从此在 CI 覆盖内；
 * 2. **字面量规则**：`dispatch({ ..., changes: ... })` 必须携带
 *    `authorizeWysiwygProtectedChange`，否则列出 file:line 失败；
 * 3. **间接形式**：`dispatch(<identifier>)`（StateCommand/事务变量透传）无法静态见
 *    changes —— 只允许出现在两个**枚举的透传枢纽**（INDIRECT_OK）里，语义理由：
 *    - `markdown-commands.ts`：结构命令经 `authorizeWysiwygStructuredCommand` 授权
 *      （保护层 `isWysiwygStructuredCommandAuthorized` 放行），列表缩进作用于非受保护 marker；
 *    - `renderer.ts`：控制器/facade 事务重派发（effects/listener 流），其**自身的字面量
 *      变更点**仍受规则 2 约束。
 *    枚举外的新间接 dispatch 会被点名 —— 惯例不再「可绕道」。
 *
 * 显式豁免（全文件跳扫，语义理由非偷懒）：
 * - `change-authorization.ts` / `change-protection.ts`：机制本体；
 * - 打字/智能输入类（plain-text-input / smart-pairs / smart-paste）：变更落在
 *   非受保护正文区，由 protection 的 range-coverage 规则天然放行（无需授权）；
 * - `markdown-formatting.ts`：格式化经 StateCommand 透传作用于正文跑；原子保持
 *   「仅源码模式可编辑」的既有拒绝语义 —— 不授权是设计而非遗漏（字面量点同样透传）。
 * - `testing.ts`：state 替身的 `replaceAsUser` **模拟用户打字**（`input.type`）——
 *   必须与真实输入同保护语义（受保护原子照常拒绝、正文按 range-coverage 放行）；
 *   授权反而会破坏 change-protection 测试的保真度（轮2 WATCH① 收口时定性）。
 *
 * 提取用**括号配平**（而非固定窗口）：选区-only 的 dispatch 紧邻下一个含 changes 的
 * dispatch 时，窗口法会假阳（首跑实证 code-block-commands:322 / image-widget:110）。
 */

const SRC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../src");

/** 整文件跳扫（语义豁免，见文件头） */
const ALLOWLIST = new Set([
  "change-authorization.ts",
  "change-protection.ts",
  "plain-text-input.ts",
  "smart-pairs.ts",
  "smart-paste.ts",
  "markdown-formatting.ts",
  "testing.ts",
]);

/** 允许 `dispatch(<identifier>)` 间接形式的**枚举透传枢纽**（其余文件出现即违规） */
const INDIRECT_OK = new Set(["markdown-commands.ts", "renderer.ts"]);

/** 从 `dispatch(` 起做括号配平，取该次调用的真实参数体（消除跨调用假阳） */
function dispatchArgument(source: string, start: number): string {
  const open = source.indexOf("(", start);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

function scan(directory: string): string[] {
  const violations: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      violations.push(...scan(full));
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      continue;
    }
    if (ALLOWLIST.has(entry.name)) {
      continue;
    }
    const source = readFileSync(full, "utf-8");
    let index = source.indexOf("dispatch(");
    while (index !== -1) {
      const argument = dispatchArgument(source, index);
      const line = source.slice(0, index).split("\n").length;
      // 剥掉包裹的外层括号：`dispatch({…})` 与 `dispatch(view.state.update({…}))` 形态都能归一
      const inner = argument.replace(/^\(/, "").replace(/\)$/, "").trimStart();
      const hasChanges = /\bchanges\s*:/.test(inner);
      const authorized = inner.includes("authorizeWysiwygProtectedChange");
      const isBareIdentifier = /^[A-Za-z_$][\w$.]*$/.test(inner);
      if (hasChanges && !authorized) {
        violations.push(`${entry.name}:${line}`);
      } else if (!hasChanges && isBareIdentifier && !INDIRECT_OK.has(entry.name)) {
        // 裸标识符（`view.dispatch(transaction)`）无法静态见 changes → 只允许枚举枢纽
        violations.push(`${entry.name}:${line} (indirect dispatch outside INDIRECT_OK)`);
      }
      index = source.indexOf("dispatch(", index + 1);
    }
  }
  return violations;
}

describe("受保护注解惯例的结构性护栏（v2：全 src + 间接形式枚举）", () => {
  it("字面量含 changes 的 dispatch 必须授权；枚举外的间接 dispatch 必须点名", () => {
    // 失败输出直接列出违规 file:line；豁免与规则见文件头（单参 expect 避开 valid-expect）。
    expect(scan(SRC_DIR)).toEqual([]);
  });
});
