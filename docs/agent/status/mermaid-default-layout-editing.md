# Mermaid 默认布局图形编辑

用途：记录 PR 261 在取消自定义布局后的实现范围、入口和验收状态，便于后续评审。更新：2026-11-16。

## 实现范围

支持 flowchart 和 sequenceDiagram 的图形编辑与空白创建；节点、关系、参与者、消息使用源码驱动的默认布局。不保存坐标或布局元数据，自定义布局留待独立调研。

- 已有图表使用悬浮工具栏的「图形编辑」；单击图表仍打开只读查看器，「编辑源码」保留。
- 桌面命令面板提供「新建 Mermaid 流程图」和「新建 Mermaid 时序图」；Web 顶栏提供「插入图表」。
- 草稿点击 Apply 才写入 Markdown，取消或未修改时不写入；应用形成一个局部历史事务。
- 有引用的节点、参与者需要先删除关系、消息；保护覆盖工具栏、浮动菜单和键盘入口。
- 不支持或无法安全映射的语法退回源码。文档、目标身份或版本变化后拒绝应用，保留草稿供复制。

语义适配在 syntax-plugins，编辑器负责范围、身份、版本、事务、历史、焦点和销毁。SDK 提供可选图形编辑端口；未提供该能力的宿主保留原有查看和源码路径。公开 core、editor、plugin-sdk 的新增契约已有 minor changeset。

## 验收

真实 Web 浏览器交互 13/13 通过，覆盖两图创建与已有图编辑、撤销重做、引用删除保护、主题、多图、离线、导出和合成 IME Enter。合成输入事件不能替代系统输入法验收。

实际 Tauri WebView 已验证两图渲染、流程图创建、编辑、应用和撤销重做；原生时序图完整编辑、拖线、系统 IME、保存重开尚未完成验收。自动化无法可靠操作系统文件面板；再次检查时测试窗口已有未确认归属的草稿，因此没有操作该草稿。不能据此声明桌面全项通过。

最终评审发现的输入框 IME 提前提交、待确认输入未阻止 Apply、公开 DocumentState 新增必填方法三个问题已修复并补充回归。清理后依次通过 `pnpm lint`、`pnpm test`、`pnpm typecheck`，另通过浏览器 13/13 和发布包验证（8 个 tarball、20 个 JS/类型入口）。独立代码复审为 COMMENT（原生验收缺口），架构复审为 CLEAR；不声明全部验收完成。公开接口保持可选；旧自定义 DocumentState 缺少忙碌状态能力时拒绝图形修改，原有编辑路径保留。

引入固定版本 Visimer 后，生产包全部资源 gzip 增加 93,703 字节（约 3.95%），启动资源 gzip 增加 73 字节；使用现有命令更新体积基线，预算容差未放宽。

```sh
pnpm --filter @md-editor/syntax-plugins test
pnpm --filter @md-editor/editor test
pnpm --filter @md-editor/web exec playwright test --config playwright.diagram.config.ts
pnpm lint
pnpm test
pnpm typecheck
```

前期可行性探针保留在 scripts/mermaid-default-layout-p0 与 scripts/mermaid-default-layout-render-p0，供复现固定上游版本的源码、主题竞争和销毁负例。它们不替代上述生产验收。[原自定义布局 P0 记录](./mermaid-visual-editing-p0.md) 作为历史证据保留。

交付保留为 draft PR，待上述原生验收补齐后再进入可合并评审。
