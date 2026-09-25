import { resolveActiveLocale, type LanguageSetting, type Locale } from "@md-editor/i18n";

/**
 * Inkpoint Web 体验版多语言预置展示文档
 * 集中展示所见即所得富文本、MDX 官方 Callout、代码高亮、表格、任务清单与数学排版。
 */

export const SHOWCASE_MARKDOWN: Record<Locale, string> = {
  zh: `# 欢迎体验 Inkpoint 编辑器 ✨

Inkpoint 是一款轻量、优雅且功能完备的 Markdown 与 MDX 编辑器。在纯浏览器环境中，你即可享受丝滑的所见即所得编辑体验！

:::tip 快捷键体验提示
按下快捷键 **Mod-/ (⌘/)**，感受零延迟、无抖动的「所见即所得」与「源码模式」无缝切换！
:::

---

## 🎨 核心特性演示

### 1. MDX 容器指令与 GFM 官方 Alert

Inkpoint 原生支持富文本 Callout 与 GitHub 警示块渲染，输入即见精美卡片：

> [!NOTE] GFM 官方 Alert 警示块
> 编辑器原生支持 GitHub Flavored Markdown 警示块（\`> [!NOTE]\`、\`> [!TIP]\`、\`> [!IMPORTANT]\`、\`> [!WARNING]\`、\`> [!CAUTION]\`），完美兼容 GitHub 与 Obsidian 事实标准。

:::info 架构优势
编辑器渲染基于 CodeMirror 6，核心模块完全平台无关，桌面端与 Web 端共用同一套高保真解析与装饰管线。
:::

:::warning 注意事项
你可以随时编辑提示块内部的文字，光标聚焦时自动展开源码供原地修改。
:::

:::danger 严谨保真
所有未知的语法标签均会以 Raw 模式严谨保真，绝不破坏原有文档结构！
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
`,

  "zh-Hant": `# 歡迎體驗 Inkpoint 編輯器 ✨

Inkpoint 是一款輕量、優雅且功能完備的 Markdown 與 MDX 編輯器。在純瀏覽器環境中，你即可享受絲滑的所見即所得編輯體驗！

:::tip 快捷鍵體驗提示
按下快捷鍵 **Mod-/ (⌘/)**，感受零延遲、無抖動的「所見即所得」與「源碼模式」無縫切換！
:::

---

## 🎨 核心特性演示

### 1. MDX 容器指令與 GFM 官方 Alert

Inkpoint 原生支援富文本 Callout 與 GitHub 警示塊渲染，輸入即見精美卡片：

> [!NOTE] GFM 官方 Alert 警示塊
> 編輯器原生支援 GitHub Flavored Markdown 警示塊（\`> [!NOTE]\`、\`> [!TIP]\`、\`> [!IMPORTANT]\`、\`> [!WARNING]\`、\`> [!CAUTION]\`），完美兼容 GitHub 與 Obsidian 實質標準。

:::info 架構優勢
編輯器渲染基於 CodeMirror 6，核心模組完全平台無關，桌面端與 Web 端共用同一套高保真解析與裝飾管線。
:::

:::warning 注意事項
你可以隨時編輯提示塊內部的文字，光標聚焦時自動展開源碼供原地修改。
:::

:::danger 嚴謹保真
所有未知的語法標籤均會以 Raw 模式嚴謹保真，絕不破壞原有文檔結構！
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
- [x] 智慧大綱目錄（點擊右上角「📑 大綱」展開檢視）
- [x] AI 智慧輔助續寫（點擊右上角「⚙️」設定你的模型）
- [ ] 更多強大能力持續演進中...

| 特性分類 | 功能描述 | 體驗狀態 |
| :--- | :--- | :---: |
| **視覺呈現** | 所見即所得富文本渲染與主題適配 | ✅ 絲滑 |
| **語法控制** | 源碼模式原生代碼編輯 | ✅ 自由 |
| **文檔結構** | 自動提取大綱層級與平滑跳轉 | ✅ 即時 |
| **數據安全** | 本地草稿記憶防丟失，一鍵導出 .md | ✅ 安全 |

---

### 4. 試著自己寫點東西吧！
你可以在這篇文檔任意修改、插入文字，甚至清空後重新創作。如果想恢復原貌，點擊頂部右側的 **「↺ 重置」** 按鈕即可一鍵復原。
`,

  en: `# Welcome to Inkpoint ✨

Inkpoint is a lightweight, elegant, and fully featured Markdown & MDX editor. Enjoy a silky-smooth WYSIWYG editing experience directly in your browser!

:::tip Quick Shortcut Tip
Press **Mod-/ (⌘/)** to seamlessly toggle between WYSIWYG and Source mode with zero delay and zero layout jitter!
:::

---

## 🎨 Core Feature Highlights

### 1. MDX Directives & GFM Alert Callouts

Inkpoint natively supports rich text callouts and GitHub alerts with instant live rendering:

> [!NOTE] GFM Official Alerts
> The editor natively supports GitHub Flavored Markdown alerts (\`> [!NOTE]\`, \`> [!TIP]\`, \`> [!IMPORTANT]\`, \`> [!WARNING]\`, \`> [!CAUTION]\`), fully compatible with GitHub and Obsidian conventions.

:::info Architectural Excellence
Built on CodeMirror 6, the core engine is completely platform-agnostic, sharing the exact same high-fidelity parsing and decoration pipeline across desktop and web.
:::

:::warning Focus to Edit
You can edit the text inside callouts anytime. Focusing the cursor reveals the raw source for inline editing.
:::

:::danger Strict Fidelity
All unknown syntax and tags are strictly preserved in raw mode without ever corrupting your document structure!
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
- [x] Smart document outline (click "Outline" in the top bar to inspect)
- [x] Ambient AI continuation (click "Settings" to configure your model)
- [ ] More powerful capabilities coming soon...

| Category | Description | Status |
| :--- | :--- | :---: |
| **Visual Fidelity** | WYSIWYG rich text rendering with theme adaptation | ✅ Smooth |
| **Syntax Control** | Pure source mode for precise editing | ✅ Flexible |
| **Document Hierarchy** | Automatic outline extraction with smooth navigation | ✅ Instant |
| **Data Safety** | Local draft persistence, one-click export to .md | ✅ Safe |

---

### 4. Try Writing Something Yourself!
Feel free to modify, insert, or clear this document to start creating. If you ever want to restore this initial showcase, simply click **"↺ Reset"** in the top navigation.
`,

  ja: `# Inkpoint エディタへようこそ ✨

Inkpoint は、軽量・洗練・高機能な Markdown & MDX エディタです。ブラウザ上だけで、快適で滑らかな WYSIWYG（見たまま編集）をお楽しみいただけます！

:::tip ショートカットのヒント
ショートカット **Mod-/ (⌘/)** を押すと、遅延やレイアウト崩れなく「WYSIWYG モード」と「ソースコードモード」を瞬時に切り替えられます！
:::

---

## 🎨 主な機能のご紹介

### 1. MDX コンテナ記法と GFM 公式 Alert

Inkpoint はリッチな Callout カードと GitHub Alert のリアルタイム描画を標準サポートしています：

> [!NOTE] GFM 公式 Alert 記法
> GitHub Flavored Markdown の Alert 構文（\`> [!NOTE]\`、\`> [!TIP]\`、\`> [!IMPORTANT]\`、\`> [!WARNING]\`、\`> [!CAUTION]\`）を標準サポートし、GitHub や Obsidian と高い互換性を保持します。

:::info アーキテクチャの強み
CodeMirror 6 を基盤とし、コアエンジンは完全にプラットフォーム非依存。デスクトップ版と Web 版で共通の高精度な構文解析・装飾パイプラインを共有しています。
:::

:::warning インライン編集
コールアウト内のテキストはいつでも編集可能です。カーソルを合わせるとソースが展開され、その場で修正できます。
:::

:::danger 厳格な忠実性
未知の構文やタグも Raw モードで安全に保持され、元のドキュメント構造を壊すことは決してありません！
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
- [x] スマートドキュメントアウトライン（右上の「📑 アウトライン」で展開）
- [x] AI 執筆支援（右上の「⚙️」からモデルを設定）
- [ ] さらに高度な機能を継続開発中...

| カテゴリ | 機能概要 | 体験状況 |
| :--- | :--- | :---: |
| **ビジュアル表現** | WYSIWYG レンダリングとテーマ適応 | ✅ スムーズ |
| **構文コントロール** | ソースコード直接編集 | ✅ 自由 |
| **ドキュメント構造** | 見出し階層の自動抽出とジャンプ | ✅ 瞬時 |
| **データ安全性** | ローカル下書き自動保存、ワンクリック .md 出力 | ✅ 安全 |

---

### 4. 自由に書いてみましょう！
このドキュメントを自由に編集・追加したり、すべて消去して新規作成することもできます。初期状態に戻したい場合は、上部ナビゲーションの **「↺ リセット」** ボタンを押すだけで復元できます。
`,
};

export const DEFAULT_SHOWCASE_MARKDOWN = SHOWCASE_MARKDOWN.zh;

export function getShowcaseMarkdown(lang?: LanguageSetting): string {
  const locale = resolveActiveLocale(lang ?? "system");
  return SHOWCASE_MARKDOWN[locale] ?? SHOWCASE_MARKDOWN.en;
}
