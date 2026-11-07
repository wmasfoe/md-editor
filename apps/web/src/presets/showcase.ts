import { resolveActiveLocale, type LanguageSetting, type Locale } from "@md-editor/i18n";

/**
 * Inkpoint Web 体验版多语言预置展示文档
 * 集中展示所见即所得富文本、MDX 官方 Callout、代码高亮、表格、任务清单与数学排版。
 */

export const SHOWCASE_MARKDOWN: Record<Locale, string> = {
  zh: `# 欢迎体验 Inkpoint 编辑器

Inkpoint 是一款轻量、优雅且功能完备的 Markdown 与 MDX 编辑器。在浏览器里即可体验所见即所得编辑，文件不会上传。

:::tip 快捷键体验提示
按下快捷键 **Mod-/ (⌘/)**，即可在「所见即所得」与「源码模式」之间切换，光标和滚动位置保持不变。
:::

---

## 核心特性演示

### 1. MDX 容器指令与 GFM 官方 Alert

Inkpoint 原生支持富文本 Callout 与 GitHub 警示块渲染，输入后立即渲染为卡片：

> [!NOTE] GFM 官方 Alert 警示块
> 编辑器原生支持 GitHub Flavored Markdown 警示块（\`> [!NOTE]\`、\`> [!TIP]\`、\`> [!IMPORTANT]\`、\`> [!WARNING]\`、\`> [!CAUTION]\`），与 GitHub、Obsidian 的写法一致。

:::info 架构优势
编辑器渲染基于 CodeMirror 6，核心模块完全平台无关，桌面端与 Web 端共用同一套高保真解析与装饰管线。
:::

:::warning 注意事项
你可以随时编辑提示块内部的文字，光标聚焦时自动展开源码供原地修改。
:::

:::danger 严谨保真
所有无法识别的语法标签都会按原文保留，不会改写文档结构。
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
- [x] 文档大纲（在侧栏顶部切换到大纲）
- [x] AI 续写（在右上角设置中配置模型）
- [ ] 更多功能开发中

| 特性分类 | 功能描述 | 体验状态 |
| :--- | :--- | :---: |
| **视觉呈现** | 所见即所得富文本渲染与主题适配 | 可用 |
| **语法控制** | 源码模式直接编辑 Markdown | 可用 |
| **文档结构** | 自动提取大纲层级并跳转 | 可用 |
| **数据安全** | 草稿保存在本地，可导出为 .md | 可用 |

---

### 4. 自己试试
你可以随意修改、插入文字，甚至清空后重新写。想恢复这份演示内容，打开设置，点击「恢复初始演示内容」。
`,

  "zh-Hant": `# 歡迎體驗 Inkpoint 編輯器

Inkpoint 是一款輕量、優雅且功能完備的 Markdown 與 MDX 編輯器。在瀏覽器裡即可體驗所見即所得編輯，檔案不會上傳。

:::tip 快捷鍵體驗提示
按下快捷鍵 **Mod-/ (⌘/)**，即可在「所見即所得」與「原始碼模式」之間切換，游標與捲動位置維持不變。
:::

---

## 核心特性演示

### 1. MDX 容器指令與 GFM 官方 Alert

Inkpoint 原生支援富文本 Callout 與 GitHub 警示塊渲染，輸入後立即渲染為卡片：

> [!NOTE] GFM 官方 Alert 警示塊
> 編輯器原生支援 GitHub Flavored Markdown 警示塊（\`> [!NOTE]\`、\`> [!TIP]\`、\`> [!IMPORTANT]\`、\`> [!WARNING]\`、\`> [!CAUTION]\`），與 GitHub、Obsidian 的寫法一致。

:::info 架構優勢
編輯器渲染基於 CodeMirror 6，核心模組完全平台無關，桌面端與 Web 端共用同一套高保真解析與裝飾管線。
:::

:::warning 注意事項
你可以隨時編輯提示塊內部的文字，光標聚焦時自動展開源碼供原地修改。
:::

:::danger 嚴謹保真
所有無法辨識的語法標籤都會依原文保留，不會改寫文件結構。
:::

---

### 2. 代碼塊與語法高亮
支援主流語言高亮與行號顯示：

\`\`\`typescript
interface InkpointExperience {
  readonly mode: "wysiwyg" | "source";
  readonly fidelity: "lossless";
  readonly aiAssisted: boolean;
}

function startWriting(topic: string): InkpointExperience {
  console.log(\`開始創作: \${topic}\`);
  return {
    mode: "wysiwyg",
    fidelity: "lossless",
    aiAssisted: true,
  };
}
\`\`\`

---

### 3. GFM 表格與任務清單

- [x] CodeMirror 6 視覺化渲染引擎
- [x] MDX 官方 Callout 組件
- [x] 文件大綱（在側欄頂部切換到大綱）
- [x] AI 續寫（在右上角設定中設定模型）
- [ ] 更多功能開發中

| 特性分類 | 功能描述 | 體驗狀態 |
| :--- | :--- | :---: |
| **視覺呈現** | 所見即所得富文本渲染與主題適配 | 可用 |
| **語法控制** | 原始碼模式直接編輯 Markdown | 可用 |
| **文檔結構** | 自動提取大綱層級並跳轉 | 可用 |
| **數據安全** | 草稿保存在本地，可匯出為 .md | 可用 |

---

### 4. 自己試試
你可以隨意修改、插入文字，甚至清空後重新寫。想恢復這份示範內容，開啟設定，點擊「恢復初始示範內容」。
`,

  en: `# Welcome to Inkpoint

Inkpoint is a lightweight, elegant, and fully featured Markdown & MDX editor. Edit visually in your browser. Your files are not uploaded.

:::tip Quick Shortcut Tip
Press **Mod-/ (⌘/)** to switch between WYSIWYG and Source mode. The cursor and scroll position stay where they are.
:::

---

## Core features

### 1. MDX Directives & GFM Alert Callouts

Inkpoint renders callouts and GitHub alerts as you type:

> [!NOTE] GFM Official Alerts
> The editor natively supports GitHub Flavored Markdown alerts (\`> [!NOTE]\`, \`> [!TIP]\`, \`> [!IMPORTANT]\`, \`> [!WARNING]\`, \`> [!CAUTION]\`), the same syntax GitHub and Obsidian use.

:::info Shared engine
Built on CodeMirror 6, the core engine is completely platform-agnostic, sharing the exact same high-fidelity parsing and decoration pipeline across desktop and web.
:::

:::warning Focus to Edit
You can edit the text inside callouts anytime. Focusing the cursor reveals the raw source for inline editing.
:::

:::danger Lossless by design
Syntax the editor does not recognize is kept as written, so your document structure is never rewritten.
:::

---

### 2. Code Blocks & Syntax Highlighting
Full syntax highlighting and line numbers for major languages:

\`\`\`typescript
interface InkpointExperience {
  readonly mode: "wysiwyg" | "source";
  readonly fidelity: "lossless";
  readonly aiAssisted: boolean;
}

function startWriting(topic: string): InkpointExperience {
  console.log(\`Start writing: \${topic}\`);
  return {
    mode: "wysiwyg",
    fidelity: "lossless",
    aiAssisted: true,
  };
}
\`\`\`

---

### 3. GFM Tables & Task Lists

- [x] CodeMirror 6 visual rendering engine
- [x] Official MDX Callout components
- [x] Document outline (switch to it from the top of the sidebar)
- [x] AI continuation (configure a model in Settings)
- [ ] More in progress

| Category | Description | Status |
| :--- | :--- | :---: |
| **Visual editing** | WYSIWYG rich text rendering with theme support | Available |
| **Source editing** | Edit Markdown directly in source mode | Available |
| **Document outline** | Headings are extracted and linked automatically | Available |
| **Local drafts** | Drafts stay on this device and export to .md | Available |

---

### 4. Try it yourself
Edit, insert, or clear this document. To bring this demo back, open Settings and choose "Restore Default Showcase".
`,

  ja: `# Inkpoint エディタへようこそ

Inkpoint は、軽量・洗練・高機能な Markdown & MDX エディタです。ブラウザ上で WYSIWYG（見たまま編集）を試せます。ファイルはアップロードされません。

:::tip ショートカットのヒント
ショートカット **Mod-/ (⌘/)** で「WYSIWYG モード」と「ソースコードモード」を切り替えられます。カーソルとスクロール位置は保たれます。
:::

---

## 主な機能

### 1. MDX コンテナ記法と GFM 公式 Alert

Inkpoint は Callout カードと GitHub Alert を入力と同時に描画します：

> [!NOTE] GFM 公式 Alert 記法
> GitHub Flavored Markdown の Alert 構文（\`> [!NOTE]\`、\`> [!TIP]\`、\`> [!IMPORTANT]\`、\`> [!WARNING]\`、\`> [!CAUTION]\`）を標準でサポートします。GitHub や Obsidian と同じ書き方です。

:::info 共通のエンジン
CodeMirror 6 を基盤とし、コアエンジンは完全にプラットフォーム非依存。デスクトップ版と Web 版で共通の高精度な構文解析・装飾パイプラインを共有しています。
:::

:::warning インライン編集
コールアウト内のテキストはいつでも編集可能です。カーソルを合わせるとソースが展開され、その場で修正できます。
:::

:::danger 内容を変えない
認識できない構文やタグは書かれたまま保持され、ドキュメント構造は書き換えられません。
:::

---

### 2. コードブロックとシンタックスハイライト
主要言語のハイライトと行番号表示に対応しています：

\`\`\`typescript
interface InkpointExperience {
  readonly mode: "wysiwyg" | "source";
  readonly fidelity: "lossless";
  readonly aiAssisted: boolean;
}

function startWriting(topic: string): InkpointExperience {
  console.log(\`執筆開始: \${topic}\`);
  return {
    mode: "wysiwyg",
    fidelity: "lossless",
    aiAssisted: true,
  };
}
\`\`\`

---

### 3. GFM テーブルとタスクリスト

- [x] CodeMirror 6 ビジュアルレンダリングエンジン
- [x] 公式 MDX Callout コンポーネント
- [x] ドキュメントアウトライン（サイドバー上部で切り替え）
- [x] AI による続きの執筆（設定でモデルを指定）
- [ ] 今後の機能を開発中

| カテゴリ | 機能概要 | 体験状況 |
| :--- | :--- | :---: |
| **ビジュアル編集** | WYSIWYG レンダリングとテーマ対応 | 利用可 |
| **ソース編集** | ソースモードで Markdown を直接編集 | 利用可 |
| **ドキュメント構造** | 見出し階層の自動抽出とジャンプ | 利用可 |
| **ローカル下書き** | 下書きはこの端末に保存され、.md で書き出せます | 利用可 |

---

### 4. 試してみる
このドキュメントは自由に編集・追加・消去できます。デモ内容を元に戻すには、設定を開いて「初期デモ内容に戻す」を選んでください。
`,
};

export const DEFAULT_SHOWCASE_MARKDOWN = SHOWCASE_MARKDOWN.zh;

export function getShowcaseMarkdown(lang?: LanguageSetting): string {
  const locale = resolveActiveLocale(lang ?? "system");
  return SHOWCASE_MARKDOWN[locale] ?? SHOWCASE_MARKDOWN.en;
}
