# Mermaid 默认布局图形编辑

用途：记录 PR 261 在取消自定义布局后的实现范围、入口和验收状态。更新：2026-11-18（PR #261 已于 2026-11-16 合入 `main`，随 v0.23.0 发布）。

## 实现范围

支持 flowchart 和 sequenceDiagram 的图形编辑与空白创建；节点、关系、参与者、消息使用源码驱动的默认布局。不保存坐标或布局元数据，自定义布局留待独立调研。

- 已有图表使用悬浮工具栏的「图形编辑」；单击图表仍打开只读查看器。源码修改走源码模式（`Mod-/`），查看器内不再有「编辑源码」按钮。
- 桌面命令面板提供「新建 Mermaid 流程图」和「新建 Mermaid 时序图」；Web 顶栏提供「插入图表」。
- 草稿点击 Apply 才写入 Markdown，取消或未修改时不写入；应用形成一个局部历史事务。
- 删除节点或参与者时一次性移除其关联关系、消息及失效样式，保留其余元素与仍有效的样式，并支持撤销重做；不再要求先手动删除引用。
- 不支持或无法安全映射的语法退回源码。文档、目标身份或版本变化后拒绝应用，保留草稿供复制。

语义适配在 syntax-plugins，编辑器负责范围、身份、版本、事务、历史、焦点和销毁。SDK 提供可选图形编辑端口；未提供该能力的宿主保留原有查看和源码路径。公开 core、editor、plugin-sdk 的新增契约已有 minor changeset。

`@visimer/core` 与 `@visimer/dom` 由 `mermaid-graphical-editor.ts` 按需 `import()`，不在模块顶层静态引入。原因是 `mermaidPlugin` 从包根再导出，该模块处于宿主**启动即加载**的 chunk 内；静态引入会让从未渲染图表的宿主也付约 53 KB gzip。改为动态导入后，Web 的启动 chunk 从 122 KB 降到 82 KB gzip（-40 KB），Visimer 只在真正存在图表时加载。新增静态引入会让该收益回退，改动此处前先确认体积。

懒加载必须配合**能力检查时预热**：画布 chunk 否则要等到首次点「编辑」才下载，已离线的宿主无法解析从未下载过的 chunk，导致既有图表不可编辑、新建图表失败（违反 H3「断网预览/创建/编辑使用本地资源」）。因此 `inspect()` 在判定为可编辑后调用 `warmEditorModules()` 预取画布模块：此时文档仍在线，且存在图表就说明用户可能编辑。启动 chunk 仍不含 Visimer，无图表的文档不受影响。回归由 Web 的离线用例与 `mermaid-visimer-lazy-load.test.ts` 双重覆盖。

## 验收

真实 Web 浏览器交互 17/17 通过，覆盖两图创建与已有图编辑、撤销重做、级联删除、拖拽连线预览与取消、主题、多图、离线、导出和合成 IME Enter。合成输入事件不能替代系统输入法验收。

实际 Tauri WebView 已验证两图渲染、流程图创建、编辑、应用和撤销重做；补充验证了时序图参与者改名与引用同步、消息改文案，以及包含两名中文参与者的空白图创建，均支持单步撤销重做。检查在 File New 创建的临时草稿中进行，之后丢弃测试草稿并恢复原文档和视图。原生时序图完整消息创建与结构操作、拖线、系统 IME、保存重开尚未完成验收：自动化无法可靠切换接收方原生下拉框或完成系统保存面板，且当前拖动接口不提供 Option 修饰键保持能力。不能据此声明桌面全项通过。

2026-11-20 原生复验：`/Applications/Inkpoint.app` 的 bundle identifier 为 `dev.md-editor.app`，显示版本与构建版本均为 `0.23.4`；仓库 `main` 的 v0.23.4 发布提交为 `bfa3743890c542a365d67a1ce814f93db050943d`，是当前 `main` HEAD 的祖先。此信息确认安装版与已发布稳定版本号一致，但 bundle 不包含可证明其二进制由当前源码重新构建的源码提交标记。通过原生 UI 成功启动应用，但临时文件选择器中选中的 `/private/tmp/mermaid-native-acceptance.md` 对应的“打开”按钮保持禁用；直接将该临时文件传给 bundle executable 退出码 134。因此本轮无法进入文档，未能复验结构操作、连线、系统输入法、保存或重开，也未对已有文件或设置作任何修改。原生验收缺口继续保留。

最终评审发现的输入框 IME 提前提交、待确认输入未阻止 Apply、公开 DocumentState 新增必填方法三个问题已修复并补充回归。清理后依次通过 `pnpm lint`、`pnpm test`、`pnpm typecheck`，另通过浏览器 17/17 和发布包验证（8 个 tarball、20 个 JS/类型入口）。独立代码复审为 COMMENT（原生验收缺口），架构复审为 CLEAR；不声明全部验收完成。公开接口保持可选；旧自定义 DocumentState 缺少忙碌状态能力时拒绝图形修改，原有编辑路径保留。

引入固定版本 Visimer 后，生产包全部资源 gzip 增加 93,703 字节（约 3.95%），启动资源 gzip 增加 73 字节；使用现有命令更新体积基线，预算容差未放宽。后续把 Visimer 改为按需动态导入，Web 启动 chunk 由 122 KB 降至 82 KB gzip，避免未使用图表的宿主承担该依赖。

```sh
pnpm --filter @md-editor/syntax-plugins test
pnpm --filter @md-editor/editor test
pnpm --filter @md-editor/web exec playwright test --config playwright.diagram.config.ts
pnpm lint
pnpm test
pnpm typecheck
```

前期可行性探针保留在 scripts/mermaid-default-layout-p0 与 scripts/mermaid-default-layout-render-p0，供复现固定上游版本的源码、主题竞争和销毁负例。它们不替代上述生产验收。[原自定义布局 P0 记录](./mermaid-visual-editing-p0.md) 作为历史证据保留。

## 交付状态

PR #261 已于 2026-11-16 合入 `main`（squash 提交 `68ed9eff`），随 **v0.23.0** 发布；后续可靠性修复见 PR #265（v0.23.2）。

**合并时的验收边界**（未因合并而改变）：Web 侧 17/17 与上述 Tauri WebView 子集已通过，但原生时序图的完整消息创建与结构操作、拖线、系统 IME、保存重开仍未完成验收。这些缺口作为已知边界保留，不得据 PR 已合并反推桌面全项通过。

## 探针依赖维护

固定版本探针会精确检查 Visimer、Mermaid、Vite 和 Playwright 的安装版本，以保留原始结论的可复现性。桌面端升级 Vite 或 Playwright 后，旧探针可能主动报版本不匹配；不要仅放宽为主版本检查。先安装锁定依赖、复验相关探针并检查源码补丁和浏览器交互结果，再同步更新 `scripts/mermaid-p0/runner.mjs` 的 `expectedVersions`、对应测试的版本断言以及其他受影响探针中的版本常量。Visimer 升级还必须重新核对生命周期补丁的上游哈希和原始负例，不能仅更新哈希使检查通过。

Mermaid 通过 `packages/syntax-plugins/package.json` 创建的 `createRequire` 解析其包清单，再定位相邻渲染入口，不依赖 workspace 的 `node_modules` 目录布局。隔离的 Visimer 探针依赖仍由 `scripts/mermaid-p0/setup.mjs` 安装到 scratch，不改变生产依赖。
