import { renderMathHtml, renderMermaidSvg } from "@md-editor/syntax-plugins";

/**
 * 将容器指令语法 (::: tip [标题] ... :::) 转换为 GFM Alert 格式，
 * 使静态渲染引擎能够复用官方的矢量图标和 callout 卡片排版。
 */
export function preprocessDirectives(markdown: string): string {
  return markdown.replace(
    /^:::\s*([a-zA-Z0-9_-]+)(?:[ \t]+([^\r\n]+))?\r?\n([\s\S]*?)\r?\n:::[ \t]*$/gm,
    (_, rawType, rawTitle, body) => {
      const type = rawType.toUpperCase();
      const title = (rawTitle || "").trim();
      const header = title ? `> [!${type}] ${title}` : `> [!${type}]`;
      const quotedBody = body
        .split("\n")
        .map((line: string) => `> ${line}`)
        .join("\n");
      return `${header}\n${quotedBody}`;
    },
  );
}

/**
 * 在 Markdown 中提取公式并替换为占位符，防止特殊字符被 marked 破坏
 */
export function preprocessAndRenderMath(markdown: string): {
  markdown: string;
  mathTokens: Map<string, string>;
} {
  const mathTokens = new Map<string, string>();
  let tokenCounter = 0;

  // 1. 先保护行内与块级代码，防止代码中的 $ 符号被误当成公式
  const codeReplacements = new Map<string, string>();
  let codeCounter = 0;

  let protectedMarkdown = markdown.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
    const key = `@@PROTECTED_CODE_${codeCounter++}@@`;
    codeReplacements.set(key, match);
    return key;
  });

  // 2. 提取块级公式: $$...$$
  protectedMarkdown = protectedMarkdown.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    const key = `@@MATH_BLOCK_${tokenCounter++}@@`;
    const { html } = renderMathHtml(expr.trim(), true);
    mathTokens.set(key, `<div class="cm-md-math-block my-3">${html}</div>`);
    return key;
  });

  // 3. 提取行内公式: $...$
  protectedMarkdown = protectedMarkdown.replace(/\$([^$\n]+?)\$/g, (_, expr) => {
    const key = `@@MATH_INLINE_${tokenCounter++}@@`;
    const { html } = renderMathHtml(expr.trim(), false);
    mathTokens.set(key, `<span class="cm-md-math-inline">${html}</span>`);
    return key;
  });

  // 4. 还原受保护的代码块
  for (const [key, val] of codeReplacements) {
    protectedMarkdown = protectedMarkdown.replace(key, () => val);
  }

  return { markdown: protectedMarkdown, mathTokens };
}

/**
 * 将 mathTokens 注入到生成后的 HTML 中
 */
export function postprocessMathHtml(html: string, mathTokens: Map<string, string>): string {
  let result = html;
  for (const [key, mathHtml] of mathTokens) {
    result = result.replace(key, () => mathHtml);
  }
  return result;
}

/**
 * 提取 Markdown 文本中的标题并生成大纲目录数据
 */
export interface OutlineItem {
  level: number;
  text: string;
  id: string;
}

export function extractOutline(markdown: string): OutlineItem[] {
  const lines = markdown.split("\n");
  const outline: OutlineItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const slug = text
        .toLowerCase()
        .replace(/[`*_~[\]()]/g, "")
        .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
        .replace(/^-|-$/g, "");
      const id = slug || `heading-${i}`;
      outline.push({ level, text, id });
    }
  }

  return outline;
}

/**
 * 异步为已渲染的 HTML DOM 容器中的 Mermaid 代码块替换为真实矢量 SVG
 */
export async function hydrateMermaid(container: HTMLElement, isDark: boolean): Promise<void> {
  const codeBlocks = container.querySelectorAll(
    "pre code.language-mermaid, pre code[class*='language-mermaid'], pre code[class*='mermaid']",
  );
  for (const codeEl of Array.from(codeBlocks)) {
    const preEl = codeEl.parentElement;
    if (!preEl || preEl.getAttribute("data-mermaid-hydrated")) continue;
    preEl.setAttribute("data-mermaid-hydrated", "true");

    const rawCode = (codeEl.textContent || "").trim();
    if (!rawCode) continue;

    try {
      const { svg, error } = await renderMermaidSvg(rawCode, isDark);
      if (svg && !error) {
        // 安全保护：若在异步加载期间页面已触发重绘使得该 pre 节点脱离了容器，则安全跳过（兼容 node mock 测试环境）
        if (
          preEl.isConnected === false &&
          typeof container.contains === "function" &&
          !container.contains(preEl)
        ) {
          continue;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "cm-md-mermaid-container my-4";
        wrapper.setAttribute("data-mermaid-code", rawCode);
        wrapper.innerHTML = svg;
        preEl.replaceWith(wrapper);
      } else if (error) {
        console.warn("[hydrateMermaid] render error:", error);
      }
    } catch (err) {
      console.warn("[hydrateMermaid] execution failed:", err);
    }
  }

  // 主题切换时重新渲染已有 Mermaid 容器
  const renderedContainers = container.querySelectorAll(
    "div.cm-md-mermaid-container[data-mermaid-code]",
  );
  for (const wrapper of Array.from(renderedContainers)) {
    const rawCode = wrapper.getAttribute("data-mermaid-code");
    if (!rawCode) continue;
    try {
      const { svg, error } = await renderMermaidSvg(rawCode, isDark);
      if (svg && !error) {
        wrapper.innerHTML = svg;
      }
    } catch {
      // 忽略重新渲染错误
    }
  }
}
