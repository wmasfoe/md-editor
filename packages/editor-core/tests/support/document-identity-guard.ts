/**
 * 供「文档身份声明约定守卫」及其**自测**共用的纯逻辑。
 *
 * 放在 `tests/support/` 下：不参与生产构建，且被守卫自身的 `isTestLike` 规则跳过
 *（否则守卫会扫描自己）。
 *
 * 设计要点（code-reviewer 复审 MEDIUM 修复）：判定必须按**属性名**而不是标签匹配 ——
 * 简写属性调用写作 `{ markdown, savedMarkdown }`（没有 `markdown:` 这个标签），
 * 早期版本用 `markdown:` 过滤，于是**静默跳过**了简写调用，包括守卫本要防住的
 * `site/components/mdx-wipe-canvas.tsx` 回归。现在改为要求表达式内出现 `markdown` 词，
 * 并另加自测（`document-identity-convention.test.ts`）证明「简写 + 未声明」确实会被标红。
 */

export interface DocumentIdentityGuardOptions {
  /** 有意不声明的调用点：`commandId` → 依据（依据必须具体，另有用例校验） */
  readonly allowlist: Readonly<Record<string, string>>;
}

/** 取出 `<某对象>.replaceDocument(` 的每个调用表达式（按括号配对，避免截到相邻调用） */
export function replaceDocumentCalls(source: string): string[] {
  const callee = ".replaceDocument(";
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

/**
 * 返回「未声明文档身份且不在白名单内」的调用点描述；空数组 = 合规。
 *
 * 判定顺序：
 *  1. 表达式含 `replaceIntent` ⇒ 合规（宿主已显式声明身份）；
 *  2. 表达式含 `commandId` 且命中白名单 ⇒ 合规（已写明「确实换文档」的依据）；
 *  3. 其余 ⇒ 违规。
 *
 * 只审「构造了替换输入」的真实调用：表达式内必须出现 `markdown` 词
 *（简写 `markdown,` 与显式 `markdown:` 都算），借此排除注释与类型声明
 *（例如 `@see state.replaceDocument(input)`）。
 */
export function findUndeclaredReplaceCalls(
  source: string,
  options: DocumentIdentityGuardOptions,
): string[] {
  const offenders: string[] = [];
  for (const expression of replaceDocumentCalls(source)) {
    if (!/\bmarkdown\b/.test(expression)) {
      continue;
    }
    if (expression.includes("replaceIntent")) {
      continue;
    }
    const commandId = /commandId:\s*"([^"]+)"/.exec(expression)?.[1];
    if (commandId !== undefined && options.allowlist[commandId] !== undefined) {
      continue;
    }
    offenders.push(`[commandId=${commandId ?? "?"}]`);
  }
  return offenders;
}
