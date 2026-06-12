# Markdown Editor M0 Spike Findings

用途：记录 M0 headless 技术尖刺的验证结论、限制和后续接入风险，供后续实现 Markdown / MDX 编辑器主链路时查询。

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

- 当前实现是 headless seam 与 fixture proof，不是完整 Milkdown / remark parser 集成。
- 未知 MDX 和 MDX expression 当前仍按 raw-only 策略保存，不执行、不格式化、不做结构化编辑。
- Inline MDX 的 source range 仍是高风险点；当前已做 stale range fail-fast，但后续真实 parser 接入时仍必须验证 range remap 或改用 node-bound raw source。
- Callout extension smoke 在当前环境记录为 blocker：尚未安装 / 验证真实 Milkdown 或 ProseMirror extension API。
- 本地 `node` 可用，且 `npm run smoke:editor-core` 已通过无依赖 runtime smoke。
- `pnpm` shim / 依赖安装仍不可用，因此 `pnpm -r test` 和 `pnpm -r typecheck` 尚未实际运行通过。

## P1 边界

- 源码模式仍为 P1，本次只保留 `rawMarkdown` 权威模型，不接入 CodeMirror。
- 导出模块仍为 P1，本次不实现 HTML / PDF / docx export。
- 桌面 native dialog、recent file、窗口关闭提示不进入 editor-core；后续桌面层只能通过 file lifecycle seam 接入。

## 后续优先级

1. 修复 pnpm / dependency install 环境后运行 `pnpm -r test` 和 `pnpm -r typecheck`。
2. 用真实 Milkdown / remark / remark-mdx API 替换 headless fixture seam，并保留当前 fixture 断言。
3. 验证 Callout extension API，若 API 不匹配，先记录阻断再调整 descriptor / node contract。
4. 在真实 parser adapter 中继续验证 inline MDX 和 range invalidation，确保 `RawFragmentRangeError` 能接入重新收集 / remap 恢复路径。
