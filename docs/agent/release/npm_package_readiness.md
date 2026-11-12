# npm 子包分发与工程债收口

用途：记录子包发布产物、独立宿主语言隔离和消费验证的约束与验证入口。

## 本轮清理计划

1. 先补充失败回归：不同编辑器的 lint 语言、不同 i18n 宿主、打包后的导出与资源。
2. 清理 SDK 纯能力在 editor/compiler/widget 中的转发，调用方直接引用能力所属入口。
3. editor 用实例状态持有语言，React 只注入配置；默认语言保留现有宿主语言回退。
4. i18n 提供实例作用域能力；应用默认实例保留明确用途，独立实例不登记全局 React 默认值。
5. 为子包生成独立 JS/声明与样式资源，保留跨包依赖；本地 pack 和独立消费者验证不执行发布。
6. 定向回归后运行 lint、test、typecheck；只有通过验证的能力才声明完成。

默认语言与可选 peer 属于有明确契约的回退，不删除。重复导出属于边界残留，直接移除。

## 分发验证与发布边界

- `pnpm build:packages` 按依赖顺序生成各子包的 JS 与声明，保留跨包依赖，复制 CSS 资源。
- `pnpm verify:packages` 仅对 8 个公开包执行真实 `pnpm pack`，检查发布清单、入口、依赖闭包、全部 JS、声明与 editor CSS；公开包依赖 private 包会直接失败。
- 验证消费者内的内部包全部来自 tarball；第三方依赖复用本机已安装版本，不依赖 registry 网络，不宣称已覆盖所有版本组合。
- 声明检查关闭 `skipLibCheck`；Node 验证只忽略 CSS 的执行，JS 导入使用原生 ESM 解析。
- 公开包：plugin-sdk、shared、compiler、markdown-fidelity、core、plugin-host、editor、syntax-plugins。app-ui 等应用专属包保持 private，不进入 pack 消费验证。
- `pnpm verify` 和 PR 的 Unit Tests job 包含分发验证。构建脚本自身的路径解析反例包含在 `pnpm test`。
- 发布必须使用 pnpm，才能转换 `workspace:` / `catalog:` 并应用 `publishConfig.exports`。
- 本轮不修改版本、不发布 npm。SDK 的 0.1.0 已存在于 npm，后续发布其变更必须选择新的版本。

## 宿主语言契约

编辑器的 `language` 配置与 `ports.setLanguage(language)` 控制该实例的 lint 文案及修复按钮。配置变化不创建文档编辑、不进入撤销历史；省略语言保留页面语言回退。React 仅转发，不重建编辑器。

i18n 的 `createI18nScope()` 返回独立、惰性初始化的实例与 `t/changeLanguage/getCurrentLocale` 能力。React 宿主先调用 scope.ensureI18nInitialized，再以 `I18nextProvider i18n={scope.instance}` 包裹组件。`useTranslation` 优先使用显式实例或 provider，不初始化应用默认 scope。包级 `configureI18n/t/changeLanguage` 是本仓库应用的共享默认 facade；嵌入宿主使用各自 scope，默认不广播全局事件或修改页面语言。

## 独立消费暴露的类型依赖

原 react-i18next 15.7.4 的声明引用 i18next 25 的 selector 类型，而工作区使用 i18next 24；固定到已验证兼容的 react-i18next 15.4.0。参考 [该版本的上游声明](https://github.com/i18next/react-i18next/blob/v15.4.0/index.d.ts)。未通过升级整个 i18next 主版本扩大本次范围。

Mermaid 原始运行时与 Turndown 服务是内部实现，移除未使用的公开辅助入口，避免声明泄漏它们的实现类型。SDK callout/CJK 能力由原拥有入口直接提供，editor/compiler 不再兼容转发。

## 发布范围收窄与边界修复计划

用途：落实已发布 SDK 的版本边界、内部包禁发，以及路径和文末块交互收口。

- plugin-sdk 已发布，本轮只验证本地产物，不执行重复发布。
- ai、app-ui、changelog、file-system、i18n、mdx-plugins 保持 private；消费者验证仅打包公开包，并拒绝公开包依赖 private 包。
- markdown-fidelity 是 editor 的直接依赖；compiler 不依赖它。保留 editor 的正常包依赖意味着其发布闭包必须包含 fidelity。
- 路径以 file-system 为职责归属：先锁定盘符、Windows 扩展前缀、UNC、POSIX 根目录、大小写及路径边界，再迁移调用方并删除旧实现和别名。
- 折叠状态持久化复用现有 file-system 实现，保留存储故障不阻断编辑的已有契约。
- 文末测试覆盖 Mermaid、引用/列表中的块、真实空行、源码模式、首次输入与 undo。核心层统一维护块边界和物化行为，插件不依赖 editor 实现。
- 本轮保留普通段落末尾使用原生光标的契约；不改变其产品行为。

## 路径与文末交互收口

- `file-system/src/path.ts` 统一词法路径语义；桌面旧 `lib/path.ts`、文件树路径/持久化副本、uTools 局部路径函数及 link-validator 的 normalizer 已删除。统一处理盘符/UNC 大小写、扩展前缀、目录边界、根目录及点段，POSIX 路径保持大小写敏感。
- editor 按插件的 `directive-panel` 契约识别文末块，覆盖引用/列表容器；插件整块装饰复用统一替换构造器归一，不引入 syntax-plugins → editor 反向依赖。
- 虚拟行激活的 effect-only 事务会刷新投影，源码随光标进入落脚行折叠。真实空行、普通段落与源码模式保持既有契约。
- 插件整块替换的上下方向键沿用核心导航，避免不对称 Inclusivity 修正后原生移动直接跳过 widget；源码展开后的移动交回 CM6。回归同时模拟两个方向跨过整个块，并在浏览器以真实文档位置验证进入 Mermaid 源码。
- 回归入口：file-system 的 `path.test.ts` / `tree-view-state.test.ts`，editor 的 `virtual-terminal-blocks.test.ts`，desktop 的 `codemirror-terminal-blocks.spec.ts` / `codemirror-mermaid-viewer.spec.ts`。

## 本地验证（2026-11-12）

- `pnpm lint`、`pnpm test`、`pnpm typecheck` 全部通过；editor 942 条、file-system 87 条单测通过。结构检查保留既有 6 条大文件 warning，未新增豁免。
- `pnpm verify:packages`：8 个公开包 tarball、20 个 JS/类型入口与 CSS 资源消费通过，无私有包或工作区源码混入。
- Chromium：terminal-blocks、mermaid-viewer、virtual-trailing-line、block-blank-line-fidelity、m4-html-mdx 五组 E2E 共 86 条通过。未验证真实 Tauri IME 与原生菜单。
- 新路径与文末块回归先在旧实现上失败；插件上下导航另有两个先失败后通过的方向回归。

## 后续审查修复计划

用途：修复进一步审查发现的三个边界问题，不扩大公开包范围。

- 先补方向键精确落点回归，再使用实际移动方向选择源码首尾；不根据跳过 widget 后的落点反推方向。
- 发布闭包以 tarball 内的名称/版本为准，使用 SemVer 校验 dependencies、optionalDependencies 和 peerDependencies 的范围，覆盖范围依赖、仅 peer 依赖及缺包/版本不匹配。复用 semver 工具，不手写范围解析。
- 盘符相对路径只做词法归一，保留 `C:` 与相对 `..`，不读取当前目录，也不将其转换为 `C:/`；覆盖目录名、文件名与路径比较。
- 本轮不存在需要保留的错误掩盖 fallback；已有可选 peer 缺失处理属于 npm 契约，保留并补测。修改后运行定向回归、浏览器导航验证和全仓门禁。

完成结果：三项均已修复。方向键精确落点回归和盘符丢失回归先失败后通过；发布脚本共 27 条测试通过。全仓 lint/test/typecheck 与 8 包、20 入口的 tarball 消费复验通过；terminal-blocks 与 mermaid-viewer 两组 Chromium 回归共 30 条通过，包含两个方向的精确源码入口验证。semver 7.8.5 仅作为根开发依赖用于检查器，不进入公开包运行时。验证仅在本地进行，未执行 npm 发布。

## PR #242 评论核查与修复计划

用途：记录审查建议的复现、处理边界与验证证据。

- 先复现 POSIX 根目录拼接变成 UNC 的问题，补路径与根目录文档资源解析回归；仅规范拼接边界的分隔符，保留第一段的 UNC 身份。
- 先复现默认 scope 的反复 React 全局登记，覆盖 `t()`、无 Provider 渲染、实例切换与恢复；同一默认实例只登记一次，独立 scope 继续不登记全局。
- pnpm 发布约束已在上文明确。pnpm 会自动将 workspace 根 LICENSE 打进子包；已实际检查 plugin-sdk tarball，后续消费验证同时断言每个包的许可证存在，无需复制 8 份许可证。[pnpm 发布契约](https://pnpm.io/cli/publish)
- WKWebView 最低版本属于全仓运行时基线问题：当前 Tauri 主应用配置未显式设置最低 macOS 版本，editor/desktop 已广泛使用 `toSorted` 等新 API；本 PR 不通过替换一个调用宣称旧 Safari 已受支持。后续需统一最低系统版本、构建目标和兼容验证。
- 冗余入口移除已写入 PR 破坏性变更说明；首次正式发布时须补对应发布说明，不在本轮虚构版本发布记录。

完成结果：根路径与全局实例覆盖回归先失败后通过。全仓 lint/test/typecheck 通过，其中 file-system 96 条、i18n 16 条；8 个 tarball、20 个入口的消费验证通过，且每个包均包含 LICENSE。原提交 `e0f452ae` 的完整 CI 全绿；本轮修复另行追加提交并复验 CI。
