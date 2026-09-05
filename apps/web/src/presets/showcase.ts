/**
 * Inkpoint Web 体验版默认预置展示文档
 * 集中展示所见即所得富文本、MDX 官方 Callout、代码高亮、表格、任务清单与数学排版。
 */
export const DEFAULT_SHOWCASE_MARKDOWN = `# 欢迎体验 Inkpoint 编辑器 ✨

Inkpoint 是一款轻量、优雅且功能完备的 Markdown 与 MDX 编辑器。在纯浏览器环境中，你即可享受丝滑的所见即所得编辑体验！

:::tip 体验提示
点击顶部的 **「所见即所得」** 与 **「源码模式」** 胶囊按钮，感受零延迟、无抖动的双模式无缝切换！
:::

---

## 🎨 核心特性演示

### 1. MDX 官方 Callout 提示块
Inkpoint 原生支持富文本 Callout 渲染，输入即见精美卡片：

:::info 架构优势
编辑器渲染基于 CodeMirror 6，核心模块完全平台无关，桌面端与 Web 端共用同一套高保真解析与装饰管线。
:::

:::warning 注意事项
你可以随时编辑提示块内部的文字，也可以切换为源码模式查看标准语法。
:::

:::danger 严谨保真
所有未知的 MDX 语法标签均会以 Raw 模式严谨保真，绝不破坏原有文档结构！
:::

---

### 2. 代码块与语法高亮
支持主流语言高亮与行号显示：

\`\`\`typescript
interface InkpointExperience {
  readonly mode: "wysiwyg" | "source";
  readonly fidelity: "lossless";
  readonly aiAssisted: boolean;
}

function startWriting(topic: string): InkpointExperience {
  console.log(\`开始创作: \${topic}\`);
  return {
    mode: "wysiwyg",
    fidelity: "lossless",
    aiAssisted: true,
  };
}
\`\`\`

---

### 3. GFM 表格与任务清单

- [x] CodeMirror 6 可视化渲染引擎
- [x] MDX 官方 Callout 组件
- [x] 智能大纲目录（点击右上角「📑 大纲」展开查看）
- [x] AI 智能辅助续写（点击右上角「⚙️」配置你的模型）
- [ ] 更多强大能力持续演进中...

| 特性分类 | 功能描述 | 体验状态 |
| :--- | :--- | :---: |
| **视觉呈现** | 所见即所得富文本渲染与主题适配 | ✅ 丝滑 |
| **语法控制** | 源码模式原生代码编辑 | ✅ 自由 |
| **文档结构** | 自动提取大纲层级与平滑跳转 | ✅ 即时 |
| **数据安全** | 本地草稿记忆防丢失，一键导出 .md | ✅ 安全 |

---

### 4. 试着自己写点东西吧！
你可以在这篇文档任意修改、插入文字，甚至清空后重新创作。如果想恢复原貌，点击顶部右侧的 **「↺ 重置」** 按钮即可一键复原。
`;
