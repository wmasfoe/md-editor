/**
 * @file lib.mjs
 * @description 渲染差分测试的核心比较逻辑（纯函数，便于单测）。
 *
 * 为什么不用现成 DOM 解析器：仓库不新增依赖（AGENTS.md 规则 2/4），而这里只需要
 * 「标签序列 + 属性集合 + 文本内容」的可比较投影，不需要完整 DOM。
 *
 * 两种比较模式：
 * - `byte`：逐字节一致。适用于输出完全由我们控制的语法（标题 ID、callout、
 *   `==highlight==`、代码高亮结构、KaTeX 公式、整体骨架）。
 * - `semantic`：规范化投影一致。适用于**实现不同但语义应等价**的语法——
 *   典型是 CJK 强调边界（comrak 的 cjk_friendly_emphasis 与 marked-cjk-friendly
 *   是两套独立实现，不 fork comrak 就无法保证字节一致）。
 *   注意 semantic **不放宽标签结构**：若一侧产出 `<strong>` 另一侧 `<em>`，仍判失败。
 *   同时会裁剪文本节点两端空白——间距类回归由 `byte` 模式的 fixture 守护。
 */

/** HTML 空元素（无需闭合标签）。 */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * 把 HTML 投影为可比较的 token 序列。
 *
 * token 形态：
 * - `{ kind: "open", tag, attrs }`：attrs 是已排序的 `[名, 值]` 对数组
 * - `{ kind: "close", tag }`
 * - `{ kind: "text", value }`：空白已折叠
 * - `{ kind: "comment", value }`
 *
 * @param {string} html
 * @returns {{ kind: string, tag?: string, attrs?: [string, string][], value?: string }[]}
 */
export function projectHtml(html) {
  const tokens = [];
  let index = 0;

  while (index < html.length) {
    const lt = html.indexOf("<", index);

    if (lt === -1) {
      pushText(tokens, html.slice(index));
      break;
    }
    if (lt > index) {
      pushText(tokens, html.slice(index, lt));
    }

    // 注释
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      const stop = end === -1 ? html.length : end + 3;
      tokens.push({ kind: "comment", value: html.slice(lt, stop) });
      index = stop;
      continue;
    }

    const gt = findTagEnd(html, lt);
    if (gt === -1) {
      // 未闭合的 `<`：按文本处理，保持确定性
      pushText(tokens, html.slice(lt));
      break;
    }

    const raw = html.slice(lt, gt + 1);
    const inner = raw.slice(1, -1);

    if (inner.startsWith("/")) {
      const tag = inner.slice(1).trim().toLowerCase();
      tokens.push({ kind: "close", tag });
    } else {
      const { tag, attrs, selfClosing } = parseOpenTag(inner);
      tokens.push({ kind: "open", tag, attrs });
      if (selfClosing && !VOID_ELEMENTS.has(tag)) {
        tokens.push({ kind: "close", tag });
      }
    }
    index = gt + 1;
  }

  return tokens;
}

/**
 * 找到标签结束的 `>`，跳过引号内的 `>`。
 *
 * @param {string} html
 * @param {number} start
 * @returns {number} 索引，未找到返回 -1
 */
function findTagEnd(html, start) {
  let quote = "";
  for (let i = start + 1; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i;
  }
  return -1;
}

/**
 * 解析开始标签内容（不含外层尖括号）。
 *
 * @param {string} inner
 * @returns {{ tag: string, attrs: [string, string][], selfClosing: boolean }}
 */
function parseOpenTag(inner) {
  const selfClosing = inner.endsWith("/");
  const body = selfClosing ? inner.slice(0, -1) : inner;

  const nameMatch = /^[a-zA-Z][^\s/>]*/u.exec(body);
  const tag = (nameMatch?.[0] ?? "").toLowerCase();
  const rest = body.slice(nameMatch?.[0]?.length ?? 0);

  const attrs = [];
  const attrPattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu;
  let match;
  while ((match = attrPattern.exec(rest)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs.push([name, value]);
  }

  // 属性顺序在 HTML 里无语义，排序后比较
  attrs.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));

  return { tag, attrs, selfClosing };
}

/**
 * 追加文本 token。
 *
 * 语义投影对文本节点做「折叠空白 + 裁剪两端 + 丢弃空节点」。
 * 理由：语义比较关心的是**标签结构与词句内容**（例如 CJK 强调是否被识别成
 * `<strong>`、嵌套是否一致），而不是 token 之间的间距。间距类回归由 `byte`
 * 模式的 fixture 守护（它们逐字节比较，空间差异逃不掉）。
 *
 * @param {{ kind: string, value?: string }[]} tokens
 * @param {string} raw
 */
function pushText(tokens, raw) {
  const collapsed = raw.replace(/\s+/gu, " ").trim();
  if (collapsed.length === 0) return;

  const last = tokens.at(-1);
  if (last?.kind === "text") {
    last.value = `${last.value ?? ""} ${collapsed}`.replace(/\s+/gu, " ").trim();
    return;
  }
  tokens.push({ kind: "text", value: collapsed });
}

/**
 * 把投影序列还原为稳定字符串，便于给出可读差异。
 *
 * @param {readonly { kind: string, tag?: string, attrs?: [string, string][], value?: string }[]} tokens
 * @returns {string}
 */
export function serializeTokens(tokens) {
  return tokens
    .map((token) => {
      if (token.kind === "text") return `text(${JSON.stringify(token.value)})`;
      if (token.kind === "comment") return `comment(${token.value})`;
      if (token.kind === "close") return `/${token.tag}`;
      const attrs = (token.attrs ?? []).map(([name, value]) => `${name}="${value}"`).join(" ");
      return attrs ? `${token.tag} ${attrs}` : token.tag;
    })
    .join("\n");
}

/**
 * 定位两个字符串的首个差异位置。
 *
 * @param {string} left
 * @param {string} right
 * @returns {{ index: number, left: string, right: string }}
 */
export function firstDifference(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;

  const context = 90;
  const from = Math.max(0, index - context);
  return {
    index,
    left: left.slice(from, index + context),
    right: right.slice(from, index + context),
  };
}

/**
 * 按指定模式比较两份渲染结果。
 *
 * @param {string} expected 参照侧（JS 实现）输出
 * @param {string} actual 待验证侧（Rust 实现）输出
 * @param {"byte"|"semantic"} mode
 * @returns {{ ok: boolean, mode: string, message?: string }}
 */
export function compareRenderedHtml(expected, actual, mode) {
  if (expected === actual) {
    return { ok: true, mode };
  }

  if (mode === "byte") {
    const diff = firstDifference(expected, actual);
    return {
      ok: false,
      mode,
      message:
        `字节级不一致（首处差异在第 ${diff.index} 字符）：\n` +
        `  参照: …${diff.left}…\n` +
        `  实际: …${diff.right}…`,
    };
  }

  if (mode === "semantic") {
    const expectedProjection = serializeTokens(projectHtml(expected));
    const actualProjection = serializeTokens(projectHtml(actual));
    if (expectedProjection === actualProjection) {
      return { ok: true, mode };
    }
    const diff = firstDifference(expectedProjection, actualProjection);
    return {
      ok: false,
      mode,
      message:
        `语义投影不一致（首处差异在第 ${diff.index} 字符）：\n` +
        `  参照: …${diff.left}…\n` +
        `  实际: …${diff.right}…`,
    };
  }

  return { ok: false, mode, message: `未知比较模式：${String(mode)}` };
}
