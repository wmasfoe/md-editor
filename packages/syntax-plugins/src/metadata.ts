/**
 * 官方语法插件元数据定义
 * 用于设置面板展示、状态管理以及插件清单归一化
 */

export type OfficialSyntaxPluginId =
  "markdown.math" | "markdown.mermaid" | "markdown.directive" | "markdown.highlight";

export interface OfficialSyntaxPluginDescriptor {
  readonly id: OfficialSyntaxPluginId;
  /** 插件用户可见名称 */
  readonly name: string;
  /** 插件分类：语法增强 | 矢量图表 | 版式布局 */
  readonly category: "syntax" | "diagram" | "layout";
  /** 详细功能描述 */
  readonly description: string;
  /** 语法示例提示，例如 $E=mc^2$ 或 ```mermaid */
  readonly syntaxHint: string;
  /** 是否为内置官方出品插件 */
  readonly isOfficial: true;
  /** 默认启用状态 */
  readonly defaultEnabled: boolean;
  /** 特性标签 */
  readonly tags: readonly string[];
}

export const OFFICIAL_SYNTAX_PLUGINS_METADATA: readonly OfficialSyntaxPluginDescriptor[] =
  Object.freeze([
    Object.freeze({
      id: "markdown.highlight",
      name: "文本高亮",
      category: "syntax",
      description:
        "支持 ==高亮== 语法标记，以醒目明亮的背景色衬托重点文本，支持 Typora 与 Obsidian 事实标准与快捷键（Mod-Shift-h）。",
      syntaxHint: "==高亮文本==",
      isOfficial: true,
      defaultEnabled: true,
      tags: Object.freeze(["高亮", "Obsidian", "Typora", "所见即所得"]),
    }),
    Object.freeze({
      id: "markdown.math",
      name: "LaTeX 数学公式",
      category: "syntax",
      description:
        "基于 KaTeX 高性能排版引擎，支持行内公式 ($..$) 与多行公式块 ($$..$$ / ```latex)，实现 Typora 风格的原位就地编辑与即时渲染。",
      syntaxHint: "$E=mc^2$ 与 $$公式块$$",
      isOfficial: true,
      defaultEnabled: true,
      tags: Object.freeze(["KaTeX", "数学排版", "所见即所得"]),
    }),
    Object.freeze({
      id: "markdown.mermaid",
      name: "Mermaid 图表",
      category: "diagram",
      description:
        "基于 Mermaid.js 渲染流程图、时序图、甘特图、类图等丰富图表，支持代码编辑与矢量 SVG 图形原位平滑切换。",
      syntaxHint: "```mermaid 图表块",
      isOfficial: true,
      defaultEnabled: true,
      tags: Object.freeze(["Mermaid.js", "矢量图表", "异步加载"]),
    }),
    Object.freeze({
      id: "markdown.directive",
      name: "容器指令 (Admonition)",
      category: "layout",
      description:
        "扩展容器块语法，将 :::info、:::tip、:::warning、:::danger 等通用指令渲染为带矢量图标与自适应主题色彩的美观提示卡片。",
      syntaxHint: ":::info 容器指令",
      isOfficial: true,
      defaultEnabled: true,
      tags: Object.freeze(["CommonMark 扩展", "提示卡片", "主题适配"]),
    }),
  ]);

export function getOfficialPluginMetadata(id: string): OfficialSyntaxPluginDescriptor | undefined {
  return OFFICIAL_SYNTAX_PLUGINS_METADATA.find((item) => item.id === id);
}
