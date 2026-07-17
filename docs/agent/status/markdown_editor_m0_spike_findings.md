# Markdown Editor M0 Spike Findings

用途：记录 M0 headless 技术尖刺的验证结论、限制和后续接入风险，供后续实现 Markdown / MDX 编辑器主链路时查询。

> 状态：迁移前历史基线。本文的已验证事实继续有效，但 Milkdown / ProseMirror 后续接入建议不再执行；CM6 实时进度见 [`codemirror_renderer_migration_status.md`](./codemirror_renderer_migration_status.md)。

## 结论

- 已建立最小 pnpm workspace 与 `@md-editor/editor-core` / `@md-editor/shared` 包骨架。
- `rawMarkdown` 是保存权威源，`dirty` 由 `rawMarkdown !== savedRawMarkdown` 派生。
- 普通 Markdown round-trip 先采用 normalized-equal fixture seam，覆盖 heading、paragraph、list、blockquote、image、code fence 等常见块。
- Frontmatter、HTML/raw block、未知 MDX、MDX ESM / expression、code fence metadata 进入 raw fragment 保真路径，未编辑时优先使用原始 `rawSource`。
- Raw fragment source range 只作为临时定位信息使用；当当前源码对应 range 已不再匹配原始 `rawSource` 时，序列化会通过 `RawFragmentRangeError` 显式失败，避免误写错误字节。
- Frontmatter 保真已覆盖 LF / CRLF 两类换行输入。
- 官方 `Callout` 最小切片已具备 descriptor、parser mapping、serializer mapping、dirty transition 和 extension smoke seam。
- 文件生命周期 seam 已覆盖 load、raw content update、persist、reload、保存基线更新和 dirty reset。

## 当前限制

- 本文记录的是 M0 headless 技术尖刺结论；桌面层的最新状态见 [markdown_editor_v0_1_sidebar_runtime_mdx_status.md](./markdown_editor_v0_1_sidebar_runtime_mdx_status.md)。
- M0 的 raw fragment / Callout 仍是 headless seam 与 fixture proof，不是完整 Milkdown / remark-mdx parser 集成。
- 未知 MDX 和 MDX expression 当前仍按 raw-only 策略保存，不执行、不格式化、不做结构化编辑。
- Inline MDX 的 source range 仍是高风险点；当前已做 stale range fail-fast，但后续真实 parser 接入时仍必须验证 range remap 或改用 node-bound raw source。
- Callout extension smoke 在当前环境记录为 blocker：尚未安装 / 验证真实 Milkdown 或 ProseMirror extension API。
- 桌面层已接入 Milkdown / CodeMirror，WYSIWYG 不会因为 Frontmatter / MDX / HTML raw block 自动切到源码模式；源码模式由用户显式切换。
- 本地 `node` 可用，且 `node --experimental-strip-types scripts/smoke-editor-core.mjs` 已通过无依赖 runtime smoke。
- 当前环境下 `pnpm test` 和 `pnpm typecheck` 会被 pnpm 11.6.0 registry signature fetch 失败挡住，需要恢复 pnpm 校验或使用已安装二进制做局部验证。

## P1 边界

- 源码模式仍为 P1，本次只保留 `rawMarkdown` 权威模型，不接入 CodeMirror。
- 导出模块仍为 P1，本次不实现 HTML / PDF / docx export。
- 桌面 native dialog、recent file、窗口关闭提示不进入 editor-core；后续桌面层只能通过 file lifecycle seam 接入。

## 后续优先级状态

1. pnpm / dependency 验证和既有 fixture 仍作为迁移前基线保留。
2. 不再投入真实 Milkdown extension、ProseMirror node 或 Milkdown Callout API 接入。
3. Raw fragment、MDX range invalidation 和 fail-fast 断言迁移到 CM6 parser / Widget 测试。
4. 当前执行顺序以 CM6 架构的 S1-S6 和实时状态文档为准。
