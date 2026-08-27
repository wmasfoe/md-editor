# 折镜（FoldingMirror）纸上排版与 12 项动效设计系统

用途：记录基于折镜（FoldingMirror）纸上排版与 Web 12 项经典动画设计原则在 `md-editor` 渲染内核与桌面端 UI 的落地规范。

---

## 1. 核心设计理念

以「一页两面、纸上书写」为物理隐喻，结合迪士尼/现代数字界面的 12 项动效原则，提升编辑器的排版呼吸感与微交互质感。

---

## 2. 纸质主题体系（Built-in Themes）

### 2.1 宣纸浅色（Paper Light）
- **底色与表面**：暖宣纸色 `--theme-bg: #f7f5f0`，工具栏 `--theme-chrome: #efede7`
- **文字层级**：标题浓墨 `--theme-title: #201d19`，正文主体 `--theme-text: #38332c`，次级文本 `--theme-muted: #656057`
- **印章强调色**：朱砂红 `--theme-primary: #6e1f2c`，柔和悬浮态 `--theme-primary-soft: rgba(110, 31, 44, 0.09)`
- **字体栈**：霞鹜文楷为主 `"LXGW WenKai", "LXGW WenKai GB", "Kaiti SC", "STKaiti", "Songti SC", serif`
- **行高与版心**：`--theme-editor-line-height: 1.88`，`--theme-content-width: 820px`

### 2.2 炭焙深色（Charcoal Dark）
- **底色与表面**：深茶/炭色 `--theme-bg: #1b1815`，侧栏 `--theme-chrome: #221e1a`
- **文字层级**：宣纸白标题 `--theme-title: #f2ede4`，暖白正文 `--theme-text: #ddd6c9`
- **印章强调色**：绯红 `--theme-primary: #c9576b`，填充色 `--theme-primary-fill: #a84054`
- **字体栈**：同上文楷字体栈与 `1.88` 行高

---

## 3. 12 项动效设计原则落地规范

| 原则 | 物理隐喻 / 交互机制 | 落地 CSS / Token |
|---|---|---|
| **挤压与拉伸 (Squash & Stretch)** | 按钮与复选框在按下时产生微弹性形变，释放归位 | 按钮 `:active { transform: scale(0.95) }`，复选框 `:active { transform: scale(0.92) }` |
| **纸张阻尼感 (Slow In & Out)** | 运动符合物理阻尼与加速度，告别生硬线性 | `--cm-transition-fast: 120ms cubic-bezier(0.22, 1, 0.36, 1)` |
| **时间节奏 (Timing)** | 微交互干脆利落，避免界面粘滞感 | 微交互 `120ms`，菜单切换 `200ms`，面板进入 `280ms` |
| **次要动作 (Secondary Action)** | 主动作完成时的确认反馈与状态沉淀 | 复制成功时的文字徽标状态渐变、表格 handle 的 hover 渐显 |
| **空间感与微发光 (Solid Drawing)** | 就地单元格激活光晕代替生硬边框跳动 | 表格单元格聚焦 `box-shadow: inset 0 0 0 1.5px var(--theme-primary)` |

---

## 4. 渲染器组件交互对齐

1. **三段式代码块卡片**：
   - 顶部 Header（`.cm-md-code-toolbar`）与代码行无缝贴合；
   - 语言徽标支持点击切换，悬浮带有 `--theme-primary-soft` 微底色；
   - 复制按钮带有状态文本徽标（`Copied` / `Copy failed`）平滑过渡。
2. **就地表格（In-Place Table）**：
   - 单元格采用 `font-variant-numeric: tabular-nums` 等宽排版；
   - 表头具有 `4%` 背景底纹，聚焦单元格采用微发光内阴影。
