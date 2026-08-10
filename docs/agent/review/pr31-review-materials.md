# PR #31 Review 材料：自研 CodeMirror 6 渲染器迁移

> 用途：为 wmasfoe 亲自 review PR #31 提供分层材料——变更范围、里程碑分组、关键决策、验证证据与已知遗留。
> 生成：2026-08-10 · 基于 `git log` + CI 记录 + 验收记录

## 1. PR 总览

| 项 | 值 |
|---|---|
| PR | wmasfoe/md-editor #31 `feature/custom-markdown-renderer` |
| 提交数 | 76（含 4 个 merge/对齐提交） |
| 核心内容 | Milkdown/ProseMirror → **自研 CM6 渲染器**全链路迁移（M0-M6 + UI 优化） |
| CI | 每轮 push 全绿（Lint / Typecheck / Vitest / Rust / Browser E2E）；近期 Build/Upload 条件性跳过 |
| 本地基线 | E2E **97 passed**、vitest **641/641**、oxlint/prettier/typecheck 四关 |
| 验收 | 用户截图验收 3 轮（胶囊背景、控件对齐、拖拽指示线）+ 原生验收（S1/M0，2026-07-18） |

## 2. 里程碑分组（提交 → 能力 → 证据）

### M0-M2：单编辑器内核 + 代码块
- **关键提交**：`c440a20`（CM 唯一 truth）、`0cf4f12`（marker 保护）、`fd9b15c`（代码块）、`718c75f`（加号 CSS + 跨平台键位）
- **能力**：单一 EditorView 承载 source/WYSIWYG；隐藏 marker 防损坏；代码块语义编辑（G005 键盘命令 + 结构边界保护）
- **证据**：G005 spec（`codemirror-m2-code-block-editing.spec.ts`）、M4 HTML/MDX 安全边界（`3d32b48`、`94c864c`）

### M3：GFM 表格
- **关键提交**：`d961c27`→`7b6413f`（表格可视化、单元格就地编辑、列菜单、整表原子选中）、`02a591f`（CI 门禁）
- **证据**：M3 浏览器验收 spec 全绿 + 三套 CI 门禁

### M4：HTML/MDX 安全 + 输入快速路径
- **关键提交**：`3d32b48`（M4 边界）、`b01da78`（P0 快速路径/composition）、`e97b4cf`（可见区投影重建）
- **证据**：G004 多轮独立审查（15 个 G004 测试）；G006 性能基线（1650 行挂载 ~300ms、视口 29 行）

### M5：五项能力迁移（全部完成）
| 能力 | 提交 | 证据 |
|---|---|---|
| 列表续行 | `42b0466`/`492689a` | vitest 单测 |
| 链接交互 | `bbbd5fc`/`eeeb316` | E2E m5-links（修饰键打开 + 源码揭示） |
| 块拖拽 | `c80c58d`/`4730f36`/`0adead0` | E2E m5-block-drag（pointer 拖拽 + 落点） |
| 折叠 | `029d98a`/`4bfa4a2` | E2E m5-fold 7 项（含 N12 程序化选区修复） |
| 标题 H 控件 | `a5847a4` | E2E m5-heading-level 6 项 |
| 图片闭环 | `78e857e`/`2020d1f` | E2E m5-image 8 项（含 M6 边界 I6-I8） |

### M6：稳定收口
- **关键提交**：`c2eed00`（边界加固 + 性能抽查）
- **证据**：图片 undo/模式切换/折叠组合边界；1650 行性能基线

### UI 优化与行首控件重设计（用户反馈驱动，2026-08-08~10）
| 提交 | 内容 | 触发 |
|---|---|---|
| `0427757` | gutter 104→88、折叠并入 toolbar、拖拽 3 横线 | 用户反馈（padding 大/icon 大/手柄长）|
| `2ccc80e` | **G005 根因修复**：负边距锚 0 触发 CM6 测量 bug → 锚 ≥16px 铁律 | CI 失败 + 本地 5/5 复现 |
| `6cd45fe` | V2 悬浮胶囊（claude-design 变体稿选型） | 设计流程 |
| `3e2ae09` | **baseTheme content 引号修复**（图标自 M2 起隐形） | 用户要截图 → 暴露 |
| `100c27b` | **方案 B**：折叠常驻 + ⋮ 菜单收敛（重设计 3 方案选 B） | 用户反馈"要素过多" |
| `fba6876` | 拖拽落点线全宽 + 圆点锚 + view.dom 坐标换算 | 用户反馈"偏右" |
| `4fa2ce9` | 去残留胶囊背景 + ⋮ 30px 补测量宽度 | 用户截图 |
| `0f30bfa` | ⋮ 与折叠三角垂直对齐（align-items: center） | 用户截图 |

## 3. 关键工程决策（reviewer 理解设计的钥匙）

1. **CM6 负 margin 行首 widget 测量 bug**：工具栏锚点 x≤8px 时 posAtCoords 偏一行（点击落错行）。铁律：**锚 ≥16px**；toolbar 总宽 **≥~40px**（宽度塌陷同样触发）。
2. **baseTheme 的 content 必须带引号字面量**（`'""'` / `'"+"'`），否则构建器丢弃、伪元素不渲染。
3. **行首控件尺寸一律 rem 固定**（em 随块字号缩放，标题行 1em≈31px）。
4. **按钮图标 CSS ::before 实现**，textContent 保持空（不污染 .cm-line 文本流）。
5. **E2E 键位平台常量**（UNDO_KEY/SELECT_ALL_KEY 等），禁硬编码 Meta+*。
6. **拖拽走 pointer 通道**（HTML5 draggable 会劫持序列，破坏列表结构命令）。
7. **E2E 就绪顺序**：先 `expect.poll(isReady)` 再 `mountEditor()`（macOS 慢 runner 间歇）。
8. **文档纪律**：代码中文注释；新文档只写 docs/agent/ 并同步 index.md；状态文档与代码同变更更新。

## 4. 已知遗留 / 风险

- **AI 预览**：未实现（低优先，用户曾跳过）——文档中已明确为延后能力。
- **Node.js 20 弃用警告**：CI 强制跑 Node 24，非阻塞，可后续升级 workflow actions。
- **拖拽 ghost 样式**：维持现状（240px 上限块预览），未纳入本轮重设计。
- **list-projection.test.ts:69**：CI 偶发（历史记录），非本轮引入。
- **本机 clippy**：Linux ARM64 有 6 个既有 cfg unused warning（历史），用 oxlint+prettier+typecheck 替代门禁。

## 5. Reviewer 验证路径（建议顺序）

1. `gh pr diff` 按里程碑分组看（见 §2）
2. 跑门禁：`pnpm lint:oxlint && pnpm format:prettier:check && pnpm exec vitest run && pnpm typecheck`
3. 跑 E2E：`cd apps/desktop && npx playwright test`（97 项，~2min）
4. 手动验证交互：hover 行首 → 折叠 ▾ 常驻 / ⋮ 菜单（添加块、折叠、H1-H6）；按住 ⋮ 拖块看全宽落点线 + 圆点；代码块首行点击定位
5. 对照状态文档：`docs/agent/status/codemirror_renderer_migration_status.md`
