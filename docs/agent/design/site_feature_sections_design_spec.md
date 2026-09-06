# 官网双 Feature 展区视觉与交互设计规范 (Claude & Open Design)

## 一、 规范目的与设计哲学

本文档为 Inkpoint 官方网站（`site` 模块）新增的 **基础编辑功能区（Core Live Editor Showcase）** 与 **AI 智能赋能区（Ambient AI Feature Showcase）** 提供权威的 UI/UX、排版、微交互与 Apple 视差滚动规范。

### 核心设计哲学
1. **纸墨相生（Paper & Ink）**：
   继承中国传统宣纸温润、墨色深沉的质感，避免冷峻刺目的纯白底色，采用偏暖石色调（`--color-canvas: #faf9f6`、`--color-surface: #ffffff`）。
2. **Apple 级空间质感（Apple Spatial Depth & Liquid Glass）**：
   融合 Apple HIG 与 macOS 精细材料感：微圆角、内嵌高光镜面边缘、高饱和度背景模糊与双层漫反射投影，营造悬浮于桌面之上的温润立体舞台。
3. **返璞归真，零干扰书写（Distraction-Free Zen）**：
   基础编辑展区彻底去除冗余标题栏（无 macOS 交通灯、无顶栏文件名、无模式胶囊），让编辑器化身一幅平整展开的信笺；AI 展区强调“润物无声”的幽灵文字（Ghost Text），只在停顿时献策，绝不弹窗打断心流。

---

## 二、 设计 Token 与排版契约

### 1. 色彩语义表 (Color Palette)

| Token 变量 | 颜色值 | 语义说明 | 适用场景 |
| :--- | :--- | :--- | :--- |
| `--color-canvas` | `#faf9f6` | 暖调生宣底色 | 全站大背景与外层画布 |
| `--color-surface` | `#ffffff` | 纯净纸张面 | 编辑器工作台主背景、悬浮卡片高亮底 |
| `--color-surface-soft`| `#f3f1eb` | 浅石色软背景 | 侧栏悬停态、次级卡片底色 |
| `--color-ink` | `#14120f` | 浓墨正文字 | 一级标题、强对比文字、光标高亮 |
| `--color-ink-soft` | `#3f3a34` | 焦墨副文字 | 正文长文排版、常驻侧栏文字 |
| `--color-muted` | `#7a736a` | 灰墨弱强调 | 注释、幽灵提示前缀、元信息 |
| `--color-line` | `#e8e4dc` | 浅墨界线 | 卡片弱分割线、侧栏微界限 |
| `--color-line-strong` | `#d6d0c4` | 沉石描边 | 外层卡片边框（配合内嵌高光） |
| `--color-accent` | `#1f6feb` | 霁蓝点睛色 | 徽标指示点、选区背景色 |
| `--color-blot` | `#5a4336` | 赭石温润色 | 灵感徽标、副标题重点提示 |
| `--color-seal` | `#b23b2c` | 朱砂落款印 | 强调引言竖条、关键标注 |

### 2. 字体体系 (Typography Hierarchy)

- **展区主标语 (Display/Headline)**：
  - 字体：`var(--font-fraunces), "LXGW WenKai", serif`
  - 字号：移动端 `text-2xl` (24px)，桌面端 `text-3xl sm:text-4xl` (36px)，追踪紧凑 `tracking-tight`。
- **编辑区正文 (Prose Typography)**：
  - 字体：`"LXGW WenKai", "LXGW WenKai Screen", "霞鹜文楷", system-ui, sans-serif`
  - 字阶：`15px` ~ `16px`，行高设定为 `1.75`（`leading-[1.75]`），字间距自然舒缓。
- **代码与元数据 (Mono/Code)**：
  - 字体：`"SF Mono", "SFMono-Regular", ui-monospace, Menlo, monospace`
  - 字阶：`12px` ~ `13px`，行高 `1.6`。

---

## 三、 Feature 展区 1：基础编辑功能区 (Core Live Editor Showcase)

### 1. 结构与布局规范
```
┌────────────────────────────────────────────────────────────────────────┐
│ [✨ 所见即所得 · 纯粹书写]                                               │
│ 即开即写，让文字回归纯粹                                                 │
│ 无需复杂配置，也不必等待加载。在宣纸般温润的画布上，所见即所想。          │
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────────┐ │  <- rounded-3xl, shadow
│ │ ┌───────────────┐ ┌──────────────────────────────────────────────┐ │ │
│ │ │ 📁 示例文稿    │ │ # 静水流深，字字生香                         │ │ │  <- No Title Bar!
│ │ │ ───────────── │ │                                              │ │ │
│ │ │ 📄 专注写作.md │ │ > 好的工具如水，润物无声...                  │ │ │  <- Real CodeMirror WYSIWYG
│ │ │ 📄 纸墨相生.md │ │                                              │ │ │     Pure In-Memory State
│ │ │               │ │ 写作本是一场沉静的对话...                    │ │ │
│ │ └───────────────┘ └──────────────────────────────────────────────┘ │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### 2. 视觉与组件细则
1. **彻底无标题栏 (No Title Bar Contract)**：
   - 不渲染 macOS 交通灯，不渲染文件名顶栏或 WYSIWYG 胶囊；
   - 顶部内边距 `pt-6 sm:pt-8`，直接呈现一整面干净平整的白纸感。
2. **左侧假迷你侧栏 (Mock Mini-Sidebar)**：
   - 宽度：桌面端固定 `w-48` 或占用 12 列网格中的 3 列（`md:col-span-3`）；移动端隐藏（`hidden md:block`）；
   - 背景色：`bg-canvas/50`，带右侧细边线 `border-r border-line`；
   - 条目样式：
     - 默认态：`px-3 py-2 rounded-xl text-xs text-muted hover:text-ink hover:bg-surface-soft/60 transition-all`；
     - 激活态：`bg-surface font-medium text-ink shadow-[0_1px_3px_rgba(20,18,15,0.04)] ring-1 ring-black/5`。
3. **右侧真实编辑器工作面**：
   - 纯客户端引入 `@md-editor/editor-ui` 的 `CodeMirrorEditor`；
   - 高度范围：`min-h-[380px] max-h-[460px] overflow-y-auto`，滚动条采用 4px 超薄微距圆角；
   - 零本地持久化：使用 `createDocumentState({ markdown: sample.markdown, mode: "wysiwyg" })`；
   - 点击侧栏切换时调用 `replaceDocument(...)`，无页面重刷，光标自动保持合理状态。
4. **Apple 视差微升动效**：
   - 随着页面向下滚动，该展区舞台从微俯视角平滑升起：
     `translateY = interpolate(scrollY, [stageStart, stageEnd], [35, -20])`；
     `scale = interpolate(scrollY, [stageStart, stageEnd], [0.96, 1.0])`。

---

## 四、 Feature 展区 2：AI 智能赋能区 (Ambient AI Showcase)

### 1. 结构与布局规范
```
┌────────────────────────────────────────────────────────────────────────┐
│ [⚡️ 本地端侧 AI · 灵犀相契]                                              │
│ 灵犀相通，润物无声                                                       │
│ 端侧大模型直跑，零网络依赖。在你沉思停顿之时，悄然送上恰如其分的灵感。      │
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ 交互式行内续写演示舞台 (Interactive Ghost Text Demo)                 │ │
│ │ "写作本是一场沉静的对话。"|                                         │ │  <- Cursor
│ │   [墨色正文]             [淡雅幽灵文字 45% Opacity]                   │ │
│ │                          "—— 在方寸之间，重拾落笔成文的纯粹愉悦。"   │ │
│ │                                                                    │ │
│ │                       [ ⇥ Tab 采纳 ]   [ ⎋ Esc 忽略 ]              │ │  <- Micro Keycaps
│ └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│ ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐  │
│ │ 🔒 端侧本地直跑   │  │ 🎯 非侵入行内续写 │  │ 🧠 全篇脉络感知   │  │  <- Staggered Bento
│ │ 离线可用，私密安全│  │ 零弹窗，轻敲 Tab  │  │ 多层上下文蒸馏    │  │     Parallax Cards
│ └───────────────────┘  └───────────────────┘  └───────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### 2. 核心交互舞台：行内幽灵文字模拟器 (Interactive Ghost Text Simulator)
1. **幽灵文字样式 (Ghost Text Token)**：
   - 颜色：`text-ink/40 font-serif italic`；
   - 光标效果：墨色呼吸竖线（`animate-pulse`），宽 2px，紧跟在已确认文字后。
2. **拟物键盘键帽 (Keycap Design)**：
   - 键帽背景：`bg-surface border border-line-strong/80 shadow-[0_2px_0_rgba(20,18,15,0.08)]`；
   - 悬停/点击态：点击时下沉 1px（`active:translate-y-[1px] active:shadow-none`）；
   - 交互反馈：点击 `[Tab 采纳]` 按钮，幽灵文字以平滑淡入（`duration-300`）的形式完全转变为正常墨色正文，并浮现轻量“已采纳”水墨印记；再次点击可重置演示。
3. **3 枚 Apple 悬浮 Bento 特性卡片 (Staggered Floating Cards)**：
   - 材质采用 `.liquid-glass-track` 磨砂微透光底，配以 16px 圆角；
   - 视差错位步长：
     - 左卡（端侧直跑）：`interpolate(scrollY, [range], [40, -20])`；
     - 中卡（行内续写）：`interpolate(scrollY, [range], [15, -45])`；
     - 右卡（脉络感知）：`interpolate(scrollY, [range], [55, -15])`。

---

## 五、 响应式与可访问性 (Responsive & Accessibility)

1. **移动端适配 (< 768px)**：
   - 基础编辑区假侧栏自动隐藏，编辑工作面占满 100% 容器宽度；
   - AI 展区 3 枚 Bento 卡片平滑变为单列卡片网格，视差位移自动收敛（Reduced Motion 模式位移归零）；
   - 触控高度均保持 `>= 44px`，确保移动端顺畅点按。
2. **可访问性 (WCAG AA)**：
   - 所有文本与背景对比度保持 `>= 4.5:1`（正文 `#14120f` vs `#ffffff` 对比度高达 18.5:1）；
   - 幽灵文字提供 `aria-label="建议续写内容"` 辅助朗诵说明；
   - 所有交互按钮均有语义化 `role="button"` 与键盘操作支持。
