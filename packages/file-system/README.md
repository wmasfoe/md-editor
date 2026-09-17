# @md-editor/file-system

Inkpoint 跨平台文件系统抽象层与资产持久化管理库。负责解耦不同宿主环境（Tauri 桌面端本地磁盘、Web 浏览器端内存虚拟文件系统、uTools 插件环境）的底层 I/O 细节。

---

## 1. 架构定位

- **标准统一接口 (`FileServiceAdapter`)**：无论底层是 Rust Tauri 命令、Node.js fs 还是浏览器内存/IndexedDB，上层应用使用完全一致的异步方法；
- **保序并发保存调度 (`FileSaveScheduler`)**：提供带队列与去重机制的保存调度器，避免快速连击 `Cmd+S` 或自动保存并发引起的写入冲突与文件损坏；
- **本地图片资产管理**：支持智能转存剪贴板粘贴与拖拽的图片文件至相对目录（如 `./assets`），并返回保真相对路径。

---

## 2. 核心模块与功能

### 2.1 文件服务抽象 (`FileServiceAdapter`)
- `openMarkdownFile()`: 弹出系统文件选择器打开单一 Markdown 文档；
- `openMarkdownFolder()`: 载入工作区根目录并递归生成多层级文件树；
- `createMarkdownTreeItem()` / `renameMarkdownTreeItem()` / `deleteMarkdownTreeItem()`: 工作区文件及目录增删改查。

### 2.2 文件保存调度器 (`FileSaveScheduler`)
- **并发锁与状态机**：维护 `idle`、`saving`、`pending` 状态，平滑合并重复的保存请求；
- **原子写入**：配合桌面端 Rust 写入管道，保障极端断电或崩溃时文档不丢失。

### 2.3 文件树状态管理 (`tree-view-state.ts`)
- 维护多层级文件节点的展开/折叠状态集合（`Set<string>`）；
- 节点高亮激活与重命名就地编辑状态跟踪。

---

## 3. 主要 API 与使用

```typescript
import {
  type FileServiceAdapter,
  createFileSaveScheduler,
} from "@md-editor/file-system";

// 创建带保存调度的适配器
const scheduler = createFileSaveScheduler({
  saveFile: async (path, content) => {
    // 调用底层 Tauri 或虚拟文件系统写入
    await nativeFsWrite(path, content);
  },
  debounceMs: 500,
});

// 触发安全保存
scheduler.scheduleSave("/path/to/doc.md", "# 新的文档内容");
```

---

## 4. 开发与测试

```bash
pnpm test
pnpm typecheck
```
