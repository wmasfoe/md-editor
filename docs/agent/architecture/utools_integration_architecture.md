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
- **`apps/utools/src/utools/file-adapter.ts`**：作为接入层，通过 `preload/index.cjs` 暴露的 `window.inkpointNodeBridge` 调用 Node.js `fs` 实现文件读写与保存调度，完成平台适配。
- **`apps/utools/src/utools/db-storage.ts`**：便签模式下接入 `utools.db`，实现用户账号下跨设备自动云漫游。

---

## 3. 导流设计与 AI 安全免责规范

### 3.1 导流通道设计
- **顶部横幅 (`ReferralBanner`)**：展示“Inkpoint 桌面版已发布，支持无限多窗口、完整侧栏与独家本地专属小模型”，引导访问官网。
- **操作栏与状态栏**：常驻官网跳转入口，统一调用 `utools.shellOpenExternal("https://inkpoint.app/?utm_source=utools&utm_medium=plugin&utm_campaign=...")` 附带精确的 UTM 溯源参数。

### 3.2 AI 与模型能力边界
- **本地微调专属小模型 (SLM)**：
  - uTools 受限于轻量分发体积与对原生二进制推理库的严苛限制，**不支持运行 Inkpoint 的本地专属微调小模型**。
  - 本地微调小模型作为 Inkpoint 原生桌面端独占的核心壁垒与卖点。
- **自定义云端模型与 API Key 免责机制**：
  - 若用户在 uTools 插件中配置自定义云端模型 API Key，必须经过阻断式免责模态框确认（`DisclaimerModal`）：
    > *当前应用内嵌于第三方平台（uTools）中。在此配置的 API Key 和调用数据均留存于 uTools 宿主环境。若发生 API Key 泄露、额度被盗或隐私泄露，概与 InkPoint 及其开发团队无关。若需银行级隐私安全与本地专属微调小模型，请前往官网下载 InkPoint 原生桌面端。*
