/**
 * @fileoverview 更新日志的行内格式 token 化
 *
 * 官网与桌面端共用同一套行内语义，只识别：
 * `` `行内代码` ``、`**粗体**`、`[文本](https://…)`。
 *
 * 刻意产出 token 而不是 HTML：
 * - 桌面端 `tauri.conf.json` 的 CSP 为 `null`，任何 HTML 字符串都会放大注入面；
 * - 官网与桌面各自用自己的样式渲染，结构语义保持唯一。
 */

/** 行内 token：纯文本、行内代码、粗体、安全外链。 */
export type InlineToken =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "bold"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

/**
 * 行内标记匹配。
 *
 * 顺序即优先级：行内代码 > 粗体 > 链接。
 * URL 只接受 `https://`，`javascript:` / `data:` / 相对路径一律留在纯文本里。
 * 刻意不使用后行断言（lookbehind）：WKWebView 在较旧 macOS 上会在模块解析阶段直接失败。
 * 代价是 `**` 紧跟单反引号这类畸形标记可能被当作粗体；CHANGELOG 由本仓库维护，不构成实际风险。
 */
const INLINE_PATTERN =
  /`([^`\n]+)`(?!`)|\*\*([^*]+)\*\*(?!\*)|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/gu;

/**
 * 把一段更新日志文本切分为行内 token。
 * 未匹配任何标记时返回单个 text token；空串返回空数组。
 */
export function tokenizeInlineMarkdown(text: string): InlineToken[] {
  if (!text) {
    return [];
  }

  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // 去掉 lookbehind 后仍用 lastIndex 推进，保证跨 token 的匹配不会重叠。
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }

    const code = match[1];
    const bold = match[2];
    const linkText = match[3];
    const linkHref = match[4];

    if (code !== undefined) {
      tokens.push({ kind: "code", text: code });
    } else if (bold !== undefined) {
      tokens.push({ kind: "bold", text: bold });
    } else if (linkText !== undefined && linkHref !== undefined) {
      tokens.push({ kind: "link", text: linkText, href: linkHref });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ kind: "text", text: text.slice(lastIndex) });
  }

  return tokens;
}
