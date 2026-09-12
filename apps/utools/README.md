# @md-editor/utools - Inkpoint uTools 插件

本子包为 Inkpoint 针对 **uTools 平台** 的轻量级插件实现。

---

## 1. 定位与架构原则

- **战略定位**：作为 Inkpoint 原生桌面端与官方网站的**轻量体验入口与导流跳板**，随时可放弃兼容与下线。
- **物理完全隔离（零污染原则）**：所有针对 uTools 的接入层代码、preload 桥接脚本、`plugin.json` 与免责声明等，**100% 收敛在当前 `apps/utools` 目录中**。如未来需要下线，直接删除本目录即可，不会在 `packages/*` 遗留任何技术债。
- **本地微调小模型 (SLM)**：uTools 插件不支持大体积本地微调模型推理，以此作为引导用户前往官网下载安装原生桌面端的核心壁垒。

---

## 2. 功能特性与双模式设计

### 本地文件与工作区双模式设计 (Dual-Mode Design)
插件根据呼出场景自动匹配最适合的体验：
1. **快速呼出模式 (无侧栏沉浸式编辑 / Focused Mode)**：
   - **进入途径**：uTools 快捷呼出、系统全局快捷键，或输入 `md`、`markdown`、`新建`、`草稿` 等轻量指令，亦或划词进入。
   - **特点**：默认**收起侧边栏**（`isSidebarOpen: false`），全宽沉浸式无干扰写作，即开即写，随写随走。支持通过 `Cmd+S` 随时保存到本地磁盘。需要查看文件树时，可随时通过快捷键 `Cmd+Shift+B`（或 `Cmd+\`）或底部按钮展开。
2. **完整工作区模式 (Full Workspace)**：
   - **进入途径**：在 uTools 插件市场/已安装插件中心直接点击打开插件图标，或搜索 `Inkpoint`、`工作区`、`workspace`，亦或打开本地文件夹。
   - **特点**：默认**展开侧边栏文件树**（`isSidebarOpen: true`），自动恢复并记忆最近打开的工作区目录或最近打开的本地文件，提供完整层级文件树导航、文件/文件夹新建、删除、重命名、即时搜索与多文件无缝切换。

### 快捷键体系 (Keyboard Shortcuts - 100% 对齐桌面端)
| 快捷键 | 功能说明 | 适用场景 |
| :--- | :--- | :--- |
| `⌘ / Ctrl + S` | 立即保存当前文档至本地磁盘 | 全局 |
| `⌘ / Ctrl + N` | 新建本地空白文档 | 全局 |
| `⌘ / Ctrl + O` | 打开本地 Markdown 文件 | 全局 |
| `⌘ / Ctrl + Shift + O` | 打开本地工作区文件夹 | 全局 |
| `⌘ / Ctrl + Shift + B` | 展开 / 收起文件树侧边栏抽屉（同时兼容 `⌘ / Ctrl + \`） | 全局 |
| `⌘ / Ctrl + /` | 切换编辑模式（所见即所得 ⇄ 源码模式） | 全局 |
| `⌘ / Ctrl + 1` | 切换为所见即所得视图模式 | 全局 |
| `⌘ / Ctrl + ,` | 打开设置与快捷键速查面板 | 全局 |
| `⌘ / Ctrl + Enter` | 贴回原应用（隐藏 uTools 窗口并将内容粘贴至原窗口光标处） | 速记 / 润色 |
| `⌘ / Ctrl + B` | 选中文本加粗 (Bold) | 编辑区 |
| `⌘ / Ctrl + I` | 选中文本斜体 (Italic) | 编辑区 |
| `⌘ / Ctrl + K` | 插入 / 包裹链接 | 编辑区 |
| `⌘ / Ctrl + E` | 行内代码 (Inline Code) | 编辑区 |
| `⌘ / Ctrl + Shift + C` | 插入代码块 (Code Block) | 编辑区 |
| `⌘ / Ctrl + Shift + S` | 删除线 (Strikethrough) | 编辑区 |
| `⌘ / Ctrl + Shift + H` | 文本高亮 (Highlight) | 编辑区 |
| `⌘ / Ctrl + Shift + Q` | 切换引用块 (Blockquote) | 编辑区 |
| `⌘ / Ctrl + Shift + U` | 无序列表 (Bullet List) | 编辑区 |
| `⌘ / Ctrl + Shift + T` | 待办任务列表 (Task List) | 编辑区 |
| `⌘ / Ctrl + ⌥ + 1 ~ 6` | 一级至六级标题 (H1 ~ H6) | 编辑区 |
| `⌘ / Ctrl + ⌥ + 0` | 正文段落 | 编辑区 |
| `⌘ / Ctrl + F` | 文档内查找 | 编辑区 |
| `⌘ / Ctrl + H` | 文档内替换 | 编辑区 |
| `⌘ / Ctrl + Z` | 撤销操作（加 Shift 为重做） | 编辑区 |

> **提示：如何设置系统级全局呼出快捷键**
> 在 uTools 客户端按 `⌘ / Ctrl + ,` 打开「偏好设置」->「快捷呼出 / 全局快捷键」，添加全局快捷键（例如 `⌥ + 空格` 或 `⌘ + ⌥ + M`），关联指令填 `md`，即可在操作系统任意界面瞬间调出速记！

---

## 3. 本地开发与调试 (HMR)

1. **启动开发服务**：
   ```bash
   pnpm dev:utools
   # 或在当前目录下：
   pnpm dev
   ```
   默认启动在 `http://127.0.0.1:5174/`。

2. **在 uTools 中接入开发**：
   - 打开 uTools 客户端，进入“开发者工具”插件。
   - 点击左侧“新建项目”，或者在已有项目中选择“选择工程 [plugin.json] 文件夹”。
   - 选中当前工程根目录：`apps/utools`（即包含 `plugin.json` 的目录）。
   - 点击“接入开发”。此时由于 `plugin.json` 中配置了 `"development": { "main": "http://127.0.0.1:5174/index.html" }`，uTools 将直接连接 Vite 热更新服务器，享受实时 HMR。

---

## 4. 生产编译与发布

1. **执行编译**：
   ```bash
   pnpm build:utools
   ```
   该命令会自动编译前端代码并触发 `utools-dist-bundle` 插件，在 `apps/utools/dist` 下自动生成：
   - `dist/index.html` 与编译后的静态资源
   - `dist/logo.png`
   - `dist/preload/index.js`（保持未混淆、清晰可读的 CommonJS 规范）
   - `dist/plugin.json`（已自动将 `main` 重定向至 `index.html`，并移除了开发配置）
   - uTools 专用图标位于 `apps/utools/logo.png`，尺寸不得超过 `256x256`；发布校验会检查构建产物，桌面端与网站图标不受影响。

2. **CI 发布目录**：
   - Pull Request 和手动运行 `.github/workflows/release-utools.yml` 时，CI 会执行类型检查、单测、生产构建和发布清单校验，并上传 `inkpoint-utools-<version>.zip`。
   - 推送与版本一致的 `utools-v*` 标签（首个标签为 `utools-v0.1.0`）后，CI 会自动创建对应 GitHub Release。
   - `apps/utools/package.json`、源码 `plugin.json`、构建后的 `dist/plugin.json` 和 Git tag 必须使用同一版本。
   - 构建产物不得包含 `.map`、`.js.gz`、`.css.gz` 等调试或预压缩文件；CI 会递归检查整个 `apps/utools/dist` 并阻止不合规产物发布。

3. **提交 uTools 市场审核或生成 UPXS 离线包**：
   - 在 uTools 开发者工具中，项目目录选择 `apps/utools/dist`。
   - 点击“打包”可生成 `.upxs` 离线安装包；点击“发布”可填写版本说明、介绍和截图并提交审核。
   - uTools 官方目前没有公开的市场发布 API 或 CLI，因此市场提交仍需在开发者工具中完成，CI 不保存 uTools 账号凭证，也不自动化 GUI。

官方流程参见 [发布到应用市场](https://www.u-tools.cn/docs/developer/basic/publish-plugin.html) 与 [打包为离线安装包](https://www.u-tools.cn/docs/developer/basic/offline-plugin.html)。
