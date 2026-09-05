# @md-editor/utools - Inkpoint uTools 插件

本子包为 Inkpoint 针对 **uTools 平台** 的轻量级插件实现。

---

## 1. 定位与架构原则

- **战略定位**：作为 Inkpoint 原生桌面端与官方网站的**轻量体验入口与导流跳板**，随时可放弃兼容与下线。
- **物理完全隔离（零污染原则）**：所有针对 uTools 的接入层代码、preload 桥接脚本、`plugin.json` 与免责声明等，**100% 收敛在当前 `apps/utools` 目录中**。如未来需要下线，直接删除本目录即可，不会在 `packages/*` 遗留任何技术债。
- **本地微调小模型 (SLM)**：uTools 插件不支持大体积本地微调模型推理，以此作为引导用户前往官网下载安装原生桌面端的核心壁垒。

---

## 2. 功能特性

1. **随手便签 (`cmd: md` / `markdown` / `便签`)**：
   - 呼出即写，内置 600ms 自动防抖保存。
   - 对接 `utools.db`，支持在 uTools 登录账号的多台设备间自动云漫游。
2. **本地文件即时编辑 (`cmd: files`)**：
   - 关联 `.md` / `.markdown` / `.mdx` / `.txt` 文件，通过 Node.js 原生 `fs` 桥接实现直接读写与保存。
3. **快捷键即时保存**：
   - 支持 `Cmd+S` / `Ctrl+S` 主动写盘并给予即时保存提示。
4. **超级面板划词导入 (`cmd: over`)**：
   - 系统任意位置选中文本后呼出 uTools 超级面板，一键导入编辑。
5. **贴回上一应用**：
   - 编辑完成后点击“贴回应用”，窗口自动隐藏并将内容贴回刚才聚焦的软件。
6. **AI API Key 安全与免责机制**：
   - 阻断式安全提醒，明确告知在第三方底座中的数据安全责任归属。

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

## 4. 生产编译与离线包打包 (UPX)

1. **执行编译**：
   ```bash
   pnpm build:utools
   ```
   该命令会自动编译前端代码并触发 `utools-dist-bundle` 插件，在 `apps/utools/dist` 下自动生成：
   - `dist/index.html` 与编译后的静态资源
   - `dist/logo.png`
   - `dist/preload/index.cjs`（保持未混淆、清晰可读的 CommonJS 规范）
   - `dist/plugin.json`（已自动将 `main` 重定向至 `index.html`，并移除了开发配置）

2. **生成 UPX 离线安装包**：
   - 在 uTools 开发者工具中，项目目录选择 `apps/utools/dist`。
   - 点击“打包”，填写版本号与说明，即可一键导出 `.upx` 离线安装包。
