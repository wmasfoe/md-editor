# uTools 平台插件接入架构方案

用途：记录 uTools 平台的临时导流定位、架构设计边界、代码完全隔离收敛规范、文件与数据持久化机制以及 AI 能力免责要求。在修改 `apps/utools` 或新增外部轻量平台宿主时以此为准。

---

## 1. 战略定位与生命周期原则

1. **临时性与导流跳板定位**：
   - uTools 插件并非长期主力客户端，其战略定位为 **Inkpoint 原生桌面端与官方网站的轻量体验入口和导流跳板**。
   - 未来可能根据运营数据或维护成本随时放弃兼容并下线。
2. **绝对零污染原则（可拔插隔离）**：
   - 所有的 uTools 平台逻辑、Node.js Preload 脚本、`plugin.json`、事件生命周期路由、免责声明等代码，**100% 必须限制并收敛在单子包 `apps/utools` 中**。
   - 严禁向 `packages/*` 领域核心（如 `editor-core`、`file-system`、`ai`）反向注入任何针对 uTools 的特性逻辑或全局类型。
   - 若后续下线 uTools 插件，仅需执行 `rm -rf apps/utools` 即可彻底剥离，不遗留任何技术债。

---

## 2. 架构拓扑与职责划分

```
┌────────────────────────────────────────────────────────┐
│                      apps/ Layer                       │
│  ┌──────────────────────────┐  ┌────────────────────┐  │
│  │       apps/desktop       │  │    apps/utools     │  │
│  │   (Tauri 原生桌面主力端)    │  │ (轻量导流/便签插件) │  │
│  └────────────┬─────────────┘  └─────────┬──────────┘  │
└───────────────┼──────────────────────────┼─────────────┘
                │                          │
                ▼                          ▼
┌────────────────────────────────────────────────────────┐
│                   packages/ 核心领域层                  │
│  ┌──────────────────────────────────────────────────┐  │
│  │ @md-editor/editor-core (文档状态机、命令/快捷键注册) │  │
│  │ @md-editor/editor-ui (React 编辑器 UI、CodeMirror) │  │
│  │ @md-editor/file-system (存储接口契约、保存调度器)     │  │
│  │ @md-editor/markdown-fidelity (保真解析、大纲提取)    │  │
│  │ @md-editor/shared (通用类型、Result 容器、基础工具)   │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

- **`packages/file-system`**：定义 `FileServiceAdapter` 与 `NativeSaveAdapter` 接口契约，不感知平台底层。
- **`apps/utools/src/utools/file-adapter.ts`**：作为接入层，通过 `preload/index.js` 暴露的 `window.inkpointNodeBridge` 调用 Node.js `fs` 实现文件读写与保存调度，完成平台适配。
- **`packages/file-system`**：定义 `FileServiceAdapter` 与 `NativeSaveAdapter` 接口契约，不感知平台底层。
- **`apps/utools/src/utools/file-adapter.ts`**：作为接入层，通过 `preload/index.js` 暴露的 `window.inkpointNodeBridge` 调用 Node.js `fs` 实现文件读写与保存调度，完成平台适配。
- **`apps/utools/src/utools/db-storage.ts`**：管理最近打开的本地文件（`inkpoint_last_opened_file_path`）与工作区（`inkpoint_last_workspace_path`），并通过 `utools.dbStorage` 持久化用户偏好设置。完全移除云端便签与数据库存盘，纯本地化对齐桌面端。

---

## 3. 导流设计与 AI 安全免责规范

### 3.1 导流通道设计
- **顶部横幅 (`ReferralBanner`)**：展示“Inkpoint 桌面版已发布，支持无限多窗口、完整侧栏与独家本地专属小模型”，引导访问官网。
- **底部多功能状态栏 (`UtoolsStatusBar`)**：整合目录侧栏开关、活动文件名与脏标记（未保存指示点）、新建/打开动作按钮、字数统计、编辑模式切换、快捷键速查与常驻官网跳转入口，统一调用 `utools.shellOpenExternal("https://editor.justdev.cn/?utm_source=utools&utm_medium=plugin&utm_campaign=...")` 附带精确的 UTM 溯源参数。

### 3.2 AI 与模型能力边界
- **本地微调专属小模型 (SLM)**：
  - uTools 受限于轻量分发体积与对原生二进制推理库的严苛限制，**不支持运行 Inkpoint 的本地专属微调小模型**。
  - 本地微调小模型作为 Inkpoint 原生桌面端独占的核心壁垒与卖点。
- **自定义云端模型与 API Key 免责机制**：
  - 若用户在 uTools 插件中配置自定义云端模型 API Key，必须经过阻断式免责模态框确认（`DisclaimerModal`）：
    > *当前应用内嵌于第三方平台（uTools）中。在此配置的 API Key 和调用数据均留存于 uTools 宿主环境。若发生 API Key 泄露、额度被盗或隐私泄露，概与 InkPoint 及其开发团队无关。若需银行级隐私安全与本地专属微调小模型，请前往官网下载 InkPoint 原生桌面端。*

---

## 4. 设置中心、图片持久化与无缝预览机制

### 4.1 设置中心 (`SettingsModal`)
- **外观排版与偏好配置**：
  - 支持主题切换（跟随系统 / 浅色模式 / 深色模式）；
  - 支持编辑器正文字号调节（12px ~ 22px 连续滑块调节）；
  - 支持正文字体族栈下拉选择（对齐桌面端预设：系统默认、系统无衬线、霞鹜文楷、经典宋体、传统楷体等）；
  - 支持代码等宽字体族栈下拉选择（JetBrains Mono, Fira Code, Cascadia Code, Source Code Pro, 系统等宽等）；
  - 内置实时字体与代码块排版预览；
  - 数据通过 `utools.dbStorage`（兜底 localStorage）进行跨会话持久化。
- **快捷键指南收敛**：
  - 整合快捷键速查（常用操作与视图、Markdown 格式排版、查找与历史三大分类），100% 对齐桌面端规范；
  - 提供 uTools 系统全局快捷键绑定指南（如 `⌥ + 空格` 绑定 `md` 随时秒出沉浸写作）。

### 4.2 本地图片资产持久化与预览原理（第一性原理）
1. **纯本地文件与工作区规范（对齐桌面端）**：
   - 不使用任何云端数据库或 `utools.db` 存取文档及图片。
   - 粘贴或拖拽图片时，若当前文档尚未写盘，强制弹出原生文件保存对话框（对齐桌面端 `ensureDocumentSaved`），在确定本地 `filePath` 后计算稳定的相对存储路径；
   - 通过 `window.inkpointNodeBridge.savePastedImage` 将图片保存到当前文档所在目录的 `assets/image-${timestamp}.${ext}`；
   - Markdown 中插入相对路径 `assets/...`，自动刷新工作区文件树以呈现新生成的 assets 文件。

2. **本地图片预览机制与 Bug 根因分析**：
   - **历史 Bug 根因 1（同步渲染与 React Ref 状态脱节）**：
     在文件打开或切换时，`docState.replaceDocument` 会同步触发 CodeMirror 编辑器插件装饰层，从而同步执行 `resolveImage`。若通过 React Ref（`snapshotRef.current`）读取 `filePath`，由于 React 微任务调度尚未更新 Ref，会导致获取到 `filePath: null`，相对图片路径解析失败返回原始相对路径；Chromium 尝试向开发服务器 `http://127.0.0.1:5174/assets/...` 发起网络请求触发 404 错误，CodeMirror 永久将图片控件标记为加载失败。
     **修复方案**：`resolveImage` 绝不依赖 React Ref，严格直接从 `docState.getSnapshot().filePath` 同步读取当前权威文档路径。
   - **历史 Bug 根因 2（Electron 宿主环境协议与安全隔离）**：
     Electron/Chromium 严格禁止从 `http://` 页面直接使用 `file:///` 协议加载本地图片资源。
     **修复方案**：Node 预加载桥接脚本（`preload/index.js` 中的 `resolveImageSrc`）对 URI 编码、尖括号包裹、Query 参数与 Hash 锚点进行解析规范化，通过 Node.js 原生 `fs.readFileSync` 将目标图片直接转为 Base64 Data URL（`data:image/...;base64,...`）。零网络开销、无跨域协议限制、瞬间秒开预览。

---

## 5. 保存与图片插入防跳顶机制（Anti-Jump First-Principles Architecture）

### 5.1 故障现象与第一性原理分析
- **故障现象**：在 uTools 平台中，当按下 `Cmd/Ctrl + S` 保存、触发 600ms 自动保存或粘贴/拖拽图片时，页面视口会突然强制滚动回顶部（scrollTop 归零），光标丢失，撤销栈被破坏。
- **根因分析（从第一性原理出发）**：
  - `docState.replaceDocument(...)` 是**文档级代际边界（Generation Boundary）**，专用于新建文档、打开外部文件或切换文件树文件。每次调用均会递增 `documentGeneration`。
  - CodeMirror 渲染器收到 `snapshot.documentGeneration > this.#documentGeneration` 时，必须视作整篇文档完全换源，从而调用私有方法 `#installDocumentBoundary(snapshot)` 执行全量重置：
    ```ts
    this.#view.setState(nextState);
    this.#view.clearDomSelection();
    this.#view.setScrollTop(0); // 导致视口跳回顶部！
    ```
  - 原实现在 `handleSaveDocument`、自动防抖保存 `useEffect` 以及 `handleInsertImageFile` 中错误地直接调用了 `replaceDocument`，导致每次保存与每次图片粘贴均强行触发代际重置与视口跳顶。

### 5.2 解决方案与契约对齐
1. **保存流程（手动保存与防抖保存）**：
   - 遵循核心状态机保存检查点与结算协议（`beginSave` + `settleSave`）；
   - 保存时同步调用 `docState.beginSave(destination)` 锁定检查点，写入磁盘后同步调用 `docState.settleSave(checkpoint, { status: "succeeded", ... })`；
   - 状态机提交 `save-settled` 事件，渲染器只进行元数据簿记（`#acceptSnapshotBookkeeping`），完全不重建 `EditorView`，保持原有 `scrollTop`、选区与撤销栈不变。
2. **图片插入流程（粘贴与拖拽）**：
   - 遵循架构设计原则 6.3：“同文档程序化修改只通过 renderer `applyExternalEdit` port”；
   - 获取 `rendererPorts.applyExternalEdit(...)` 发起 CM6 原生原子事务，保留现有选区偏移并记录撤销历史；
   - 插入完成后调用 `rendererPorts.setSelection(nextCursorPos, nextCursorPos)` 将光标与新插入图片平滑聚焦，杜绝视口跳顶。
3. **文件与工作区重命名**：
   - 采用 `docState.setDocumentPath(...)` 替代 `replaceDocument`，通过乐观锁仅更新物理路径元数据，不重置脏标记、代际或视口。


