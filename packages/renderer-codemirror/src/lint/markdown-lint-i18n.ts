/**
 * @file markdown-lint-i18n.ts
 * @description MarkdownLint 规则与上下文信息的本地化（中文友好提示字典）。
 * 针对上游 markdownlint 硬编码英文规则描述的现状，提供常用 MD001~MD058 规则的标准中文对照与参数翻译。
 */

export interface LocalizedRuleInfo {
  readonly alias: string;
  readonly description: string;
}

/**
 * 常用 markdownlint 规则中文对照词典
 */
export const MARKDOWNLINT_ZH_RULES: Record<string, LocalizedRuleInfo> = {
  MD001: {
    alias: "标题层级递增",
    description: "标题层级必须逐级递增（不可跳跃层级，例如从 H1 直接跳到 H3）",
  },
  MD002: {
    alias: "首个标题为H1",
    description: "文档中的第一个标题必须是一级标题（H1）",
  },
  MD003: {
    alias: "标题风格统一",
    description: "文档内标题风格应保持一致（如统一采用 ATX `#` 风格）",
  },
  MD004: {
    alias: "无序列表符号统一",
    description: "无序列表符号在同一作用域内应保持统一（统一使用 `-`、`*` 或 `+`）",
  },
  MD005: {
    alias: "列表缩进对齐",
    description: "同级列表项前缀缩进必须严格对齐",
  },
  MD006: {
    alias: "顶层列表顶格",
    description: "最外层无序列表项必须从行首起始，不可缩进",
  },
  MD007: {
    alias: "子列表缩进空格",
    description: "子级无序列表缩进空格数量不符合预期",
  },
  MD009: {
    alias: "行尾多余空格",
    description: "行尾不应存在多余的空格",
  },
  MD010: {
    alias: "硬制表符缩进",
    description: "请使用空格进行缩进，避免混用硬制表符（Tab）",
  },
  MD011: {
    alias: "反向链接语法",
    description: "链接语法写反，标准格式为 [链接文本](链接地址)",
  },
  MD012: {
    alias: "连续多个空行",
    description: "段落之间存在多个多余的连续空白行",
  },
  MD013: {
    alias: "单行字符超长",
    description: "当前行字符长度超过配置上限",
  },
  MD014: {
    alias: "终端命令前缀符号",
    description: "已显示输出结果的代码块中，命令无需添加 $ 前缀",
  },
  MD018: {
    alias: "标题缺少空格",
    description: "标题井号 `#` 与标题正文之间必须保留一个空格",
  },
  MD019: {
    alias: "标题多个空格",
    description: "标题井号 `#` 与标题正文之间只能保留一个空格，不可包含多个空格",
  },
  MD020: {
    alias: "闭合标题缺少空格",
    description: "闭合式标题（Closed ATX）正文与前缀井号之间缺少空格",
  },
  MD021: {
    alias: "闭合标题多个空格",
    description: "闭合式标题（Closed ATX）正文与前后井号之间存在多余空格",
  },
  MD022: {
    alias: "标题四周空行",
    description: "标题上方与下方必须各保留一行空行与正文隔开",
  },
  MD023: {
    alias: "标题必须顶格起始",
    description: "标题必须从行首顶格起始，前面不可包含空格缩进",
  },
  MD024: {
    alias: "重复的标题内容",
    description: "文档中存在多个相同内容的标题，易造成目录或锚点跳转歧义",
  },
  MD025: {
    alias: "单一一级主标题",
    description: "一个标准文档通常只应包含一个一级主标题（H1）",
  },
  MD026: {
    alias: "标题末尾多余标点",
    description: "标题末尾不应包含多余的标点符号（如句号、逗号、冒号）",
  },
  MD027: {
    alias: "引用块多个空格",
    description: "引用块符号 `>` 后面只应保留一个空格",
  },
  MD028: {
    alias: "引用块空行阻断",
    description: "引用块内部不应用纯空白行隔断",
  },
  MD029: {
    alias: "有序列表序号前缀",
    description: "有序列表项的前缀序号必须递增或保持一致格式",
  },
  MD030: {
    alias: "列表标记空格数量",
    description: "列表符号（`-` 或 `1.`）与文本之间的空格数量不符合预期",
  },
  MD031: {
    alias: "代码块四周空行",
    description: "围栏代码块（```）上方与下方必须各保留一行空行",
  },
  MD032: {
    alias: "列表四周空行",
    description: "列表块上方与下方必须保留空行与普通段落隔开",
  },
  MD033: {
    alias: "内联HTML标签",
    description: "使用了不允许的内联 HTML 标签",
  },
  MD034: {
    alias: "裸露裸写URL",
    description: "检测到未用尖括号 `<https://...>` 或超链接语法 `[文本](URL)` 包裹的裸露 URL",
  },
  MD035: {
    alias: "分割线风格统一",
    description: "水平分割线符号（如 `---` 或 `***`）应在全篇保持统一",
  },
  MD036: {
    alias: "加粗/斜体滥充标题",
    description: "请使用标准标题语法（`#`），不要使用单行加粗或斜体充当假标题",
  },
  MD037: {
    alias: "加粗/斜体内侧多余空格",
    description: "加粗/斜体标记符号与文字内侧不应有多余空格",
  },
  MD038: {
    alias: "行内代码内侧多余空格",
    description: "行内代码反引号与代码文本内侧不应有多余空格",
  },
  MD039: {
    alias: "链接文本内侧多余空格",
    description: "链接中括号 `[ ... ]` 内侧不应有多余空格",
  },
  MD040: {
    alias: "代码块未指定语言",
    description: "代码块（```）必须在起始处明确指定语言标识符（如 ```ts、```json）",
  },
  MD041: {
    alias: "首行必须是标题",
    description: "文档的第一行应当是一级标题",
  },
  MD042: {
    alias: "空链接",
    description: "链接的目标地址不能为空（如 `[]( )` 或 `[文字]()`）",
  },
  MD043: {
    alias: "必须遵循预设结构",
    description: "文档结构不符合配置中预设的必选标题大纲结构",
  },
  MD044: {
    alias: "专有名词大小写",
    description: "专有名词的大小写拼写不符合词典规范",
  },
  MD045: {
    alias: "图片缺少替代文本",
    description: "图片必须填写描述性替代文本（alt text），以保证无障碍可访问性",
  },
  MD046: {
    alias: "代码块风格统一",
    description: "代码块风格（缩进式 vs 围栏式 ```）应在全篇保持统一",
  },
  MD047: {
    alias: "文件末尾保留换行",
    description: "文件末尾应保留一个单独的换行符",
  },
  MD048: {
    alias: "代码围栏符号统一",
    description: "代码块围栏符号（``` 与 ~~~）应在全篇保持统一",
  },
  MD049: {
    alias: "斜体强调符号统一",
    description: "斜体强调符号（`*` 与 `_`）应在全篇保持统一",
  },
  MD050: {
    alias: "加粗强调符号统一",
    description: "加粗强调符号（`**` 与 `__`）应在全篇保持统一",
  },
  MD051: {
    alias: "内部锚点无效",
    description: "文档内的锚点跳转链接（#hash）在当前文档中未找到对应标题",
  },
  MD052: {
    alias: "参考链接未定义",
    description: "引用的参考式链接或图片标签在文档中未找到对应定义",
  },
  MD053: {
    alias: "参考链接定义未使用",
    description: "文档中定义的参考式链接在正文中从未被引用",
  },
  MD054: {
    alias: "链接与图片风格统一",
    description: "内联式与参考式链接风格应在全篇保持一致",
  },
  MD055: {
    alias: "表格竖线风格统一",
    description: "表格外侧竖线（表格边框）格式应保持一致",
  },
  MD056: {
    alias: "表格每行列数一致",
    description: "表格每行的数据单元格数量与表头不一致",
  },
  MD058: {
    alias: "表格四周空行",
    description: "表格上方与下方必须各保留一行空行隔开",
  },
};

/**
 * 获取当前宿主环境的语言代码
 */
export function getActiveLintLocale(): "zh" | "zh-Hant" | "ja" | "en" {
  if (typeof document === "undefined") return "zh";
  const lang = document.documentElement.lang;
  if (lang === "en" || lang.startsWith("en-")) return "en";
  if (lang === "ja" || lang.startsWith("ja-")) return "ja";
  if (lang === "zh-TW" || lang === "zh-HK" || lang === "zh-Hant") return "zh-Hant";
  if (lang.startsWith("zh")) return "zh";
  return "zh";
}

export interface MarkdownLintFixInfo {
  readonly lineNumber?: number;
  readonly editColumn?: number;
  readonly deleteCount?: number;
  readonly insertText?: string;
}

/**
 * 根据 fixInfo 纯结构化状态字段生成地道的中文建议（完全不依赖正则表达式）
 */
export function describeFixInfoInChinese(fixInfo: MarkdownLintFixInfo): string {
  if (fixInfo.deleteCount === -1) {
    return "建议：删除此多余空行";
  }
  const deleteCount = fixInfo.deleteCount ?? 0;
  const insertText = fixInfo.insertText ?? "";

  if (insertText === " " && deleteCount === 0) {
    return "建议：在此处补充一个空格";
  }
  if (insertText === "\n" && deleteCount === 0) {
    return "建议：在此处补充一行空行隔开";
  }
  if (deleteCount > 0 && !insertText) {
    return `建议：删除多余的 ${deleteCount} 个字符`;
  }
  if (deleteCount > 0 && insertText) {
    return `建议：替换为 "${insertText}"`;
  }
  if (insertText) {
    return `建议：在此处插入 "${insertText}"`;
  }
  return "建议：自动格式化修复";
}

/**
 * 将 markdownlint 生成的英文上下文详情（如 "Expected: h2; Actual: h3"）本地化为中文
 */
export function localizeMarkdownLintDetail(detail?: string): string | undefined {
  if (!detail) return undefined;
  return detail
    .replace(/^Expected:\s*([^;]+);\s*Actual:\s*(.+)$/i, "期望: $1，实际: $2")
    .replace(/^Expected:\s*(.+)$/i, "期望: $1")
    .replace(/^Actual:\s*(.+)$/i, "实际: $1")
    .replace(/Expected:\s*(\d+);\s*Actual:\s*(\d+)/gi, "期望: $1，实际: $2")
    .replace(
      /Expected:\s*(\d+);\s*Actual:\s*(\d+);\s*Below/gi,
      "期望空行: $1，实际: $2（下方缺少）",
    )
    .replace(
      /Expected:\s*(\d+);\s*Actual:\s*(\d+);\s*Above/gi,
      "期望空行: $1，实际: $2（上方缺少）",
    );
}
