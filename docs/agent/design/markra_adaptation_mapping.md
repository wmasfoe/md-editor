# Markra 可复刻项 × 我们的架构:映射分析

> 用途:竞品调研(`markra_competitor_research.md`)的落地篇。把 Markra 值得借鉴的**设计模式**逐条映射到我们的 `renderer-codemirror` 具体模块,给出"怎么抄、抄到哪、优先级"。本文是 **clean-room 模式借鉴**,不复制其代码(仓库为 AGPL-3.0,见调研文档 §D.3 与结尾 license 说明)。
> Markra 源码出处:`github.com/markrahq/markra` commit `bd17942`(v2.5.4),本文以仓库内相对路径引用;本地克隆在 `/tmp/markra-research`(可能被清理,引用以 commit 为准)。
> 最后更新:2026-08-04
> 落地状态:G004 P0-1/P0-2/P0-3 已实现；最终实现以 `projection-state.ts`、`visible-marks.ts`、`wysiwyg/index.ts` 与 G004 state/E2E 测试为准。projection 与 visible-marks 使用不同的安全门禁，后者还校验 mode、聚合事务与 visibleRanges 映射等价。

---

## 0. 结论摘要

| 可复刻项 | Markra 出处 | 落地模块(我们) | 优先级 | 工作量 |
| --- | --- | --- | --- | --- |
| 纯文本输入快速路径(只 map 不重建) | `packages/editor/src/codemirror/preview.ts` `plainTextInputCanMapDecorations` | `wysiwyg/projection-state.ts` `updateDocumentProjection` | **P0** | S |
| composition 期间只 map 不重建 | 同文件 `update()` composition 分支 | `wysiwyg/projection-state.ts` + `renderer.ts` | **P0** | S |
| typedBoundary(刚输入闭合符保留显示) | 同文件 `typedBoundary` 状态 | `renderer.ts` + `projection-state.ts` reveal 判定 | **P0** | S |
| 全量重建限定 visibleRanges | 同文件 `buildDecorations` 可见区遍历 | `projection-state.ts` `compileProjection/buildLayoutDecorations` | P1 | M |
| renderer "认领"语义(通用化) | `renderers.ts` `rendererClaimedNodes` | 我们的 kind 分支已等价覆盖 | P1(评估) | M |
| 代码块 header chrome(语言下拉+复制) | `code-block.ts` | `wysiwyg/code-block-projection.ts` + widgets | P2 | M |
| 表格 caret-host 光标定位 | `table.ts` `createVisualTableCaretHost` | `wysiwyg/table-editing.ts` | P2 | S |
| HTML 白名单放宽(style/data-*) | `raw-html-sanitize.ts` | `markdown/html-whitelist.ts` | **不建议**(我们更安全) | — |
| 命令注册表统一 UI 入口 | `plugin.ts` | desktop 层 `s1-capability-inventory`(雏形已有) | P3 | L |

---

## 1. 渲染更新循环对照(核心差异)

### 1.1 Markra:可见区遍历 + 选择性跳过重建

`preview.ts` 的 `previewPlugin.update()` 决策树:

```
typedInput && 空选区          → 记录 typedBoundary(刚输入的闭合符保留显示)
composing                    → decorations.map(update.changes) 直接返回(重建会取消 IME)
plainTextInputCanMapDecorations → decorations.map(update.changes) 直接返回
  (纯文本插入 + 单光标 + 空选区 + 光标前后都在顶层 Paragraph + 无段落渲染器)
否则全量 buildDecorations     → 遍历 syntaxTree,但只处理 view.visibleRanges 内的节点
```

关键点:
- **buildDecorations 从不遍历全文**:按 `view.visibleRanges` 切片,块节点跨区时按区重访(`preview.ts:385` 注释:折叠时块节点可跨多个不连续可见区,必须每区重访,但只给实际绘制行加样式)。
- **纯文本输入是零遍历路径**:普通字母/数字在顶层段落里不可能产生 Markdown 结构,直接 map 保留 DOM。
- **composition 是保护性跳过**:`this.composing && update.view.composing` 期间只 map;`compositionend` 后发一个空事务触发一次重建(`preview.ts:925`)。
- 全量重建的触发条件显式枚举:`compositionEnded / docChanged / selectionChangeAffectsReveal / focusChanged / viewportChanged / reconfigured / treeChanged`(`preview.ts:895-912`)。其中 `treeChanged` 用 `!update.selectionSet && syntaxTreeChanged(...)`——纯输入不改变选区时,lezer 增量解析若树没变就不重建。

### 1.2 我们:按 record 粒度增量重建(更细,但缺快速路径)

`projection-state.ts`:

```
StateField.update 每事务执行:
  compileProjection(全量)     → 只在 source↔wysiwyg 模式切换等场景
  updateDocumentProjection(增量) → 常规路径:
    previous.layoutDecorations.map(changes)  ← 已有装饰先 map 保留
    collectChangedRecordIds(previousIndex, index, ...) ← 两次全量遍历 records 求对称差 + 增删
    updateChangedLayoutDecorations → 只重建 changedIds 对应记录,previous.update({filter, add})
```

对照结论:

| 维度 | Markra | 我们 | 差距 |
| --- | --- | --- | --- |
| 增量粒度 | 无(可见区全量重算) | **按 record id 精确增量** | 我们更细 ✅ |
| 纯文本输入 | 零遍历快速路径 | `collectChangedRecordIds` 两次全量遍历 records | **我们缺** ❌ |
| composition | 跳过重建只 map | compositionGuardRanges 保护(仍走增量更新) | 我们缺"跳过" ❌ |
| 遍历范围 | visibleRanges 限定 | 全量重建时遍历全文 records | **我们缺** ❌ |
| reveal 细节 | typedBoundary + 成对分隔符 | activeSyntaxIds(纯 selection 驱动) | **我们缺 typedBoundary** ❌ |

> 我们的增量粒度优于 Markra,但**缺少"整轮跳过"的快速路径**——纯文本输入时 `collectChangedRecordIds` 的两次全量遍历是白花成本(结果几乎总是"无变化记录")。这是大文件输入延迟的潜在来源,也是 P0 三项的全部动机。

---

## 2. 可复刻项清单(按优先级)

### P0-1 纯文本输入快速路径

- **Markra 做法**(`preview.ts:813-829`):`updateOnlyInsertsPlainText && 单选区 && 前后都空 && 光标前后都在顶层 Paragraph && 无 Paragraph 渲染器` → 直接 `decorations.map(update.changes)`。
- **我们现状**:每次 `updateDocumentProjection` 都执行 `collectChangedRecordIds`(O(N),N=records 数)。
- **落地建议**(`projection-state.ts` `updateDocumentProjection` 入口):
  1. 判定函数 `plainTextInsertCanMapProjection(transaction)`:仅纯插入(`transaction.isUserEvent("input")` + Unicode 字母/组合标记/数字，排除 Variation Selector)、单光标、空选区、插入位置前后均无语法 record，且**事务前后所有 record ID 集合完全一致**(`recordIdsStable`,第四轮审查补:结构记录前的插入会让后续 record 因绝对偏移获得新 ID,map 后的 decoration 携带旧 `wysiwygRecordId` 会失同步,必须回退增量重建);表格/代码块/html/标题等内部编辑不走快速路径。visible-marks 快速路径同此门禁,并额外要求 mode 不变、仅 1 个 docChanged 事务、viewport 变化时 visibleRanges 映射精确相等、光标不在 inline marker 内。
  2. 命中时:跳过 `collectChangedRecordIds`,`layoutDecorations/atomicRanges` 直接 `map(transaction.changes)`(注意:此时 **range-index 仍要更新**,因为选区/record 边界映射仍需正确;只是装饰集合不重建)。安全起见把 `protectedRanges` 也走 map 路径。
  3. 用 `getWysiwygDiagnostics` 记录跳过次数,便于量化收益。
- **验证**:大文件(万行级)纯文本连续输入,对比输入延迟;现有性能测试(`code-block-performance.test.ts` 同款 fixture)补一个"纯文本段落输入不重建"的断言。

### P0-2 composition 期间只 map 不重建

- **Markra 做法**(`preview.ts:872-877,918-926`):composition 期间 `decorations.map`;`compositionend` 后 `view.dispatch({})` 触发一次重建;`data-markra-composing` 隐藏选区背景防闪烁。
- **我们现状**:`renderer.ts` 有 `#compositionActive` 状态(用于外部编辑排队 `queued-composition`);projection 层有 `compositionGuardRanges`(保护已注入的 composition 编辑区,`projection-state.ts:138-147` 映射 guard)。但 projection 更新本身仍逐事务执行。
- **落地建议**:在 `updateDocumentProjection` 前判断 `transaction.startState`/`transaction.state` 的 `composition` 状态(或复用 `renderer.ts` 的 `#view.compositionStarted`),composition 中直接 map 返回;`compositionend` 后 dispatch 空事务触发一次全量/增量重建。guard 机制保留(它解决的是"保护注入区间"问题,与"跳过重建"正交)。
- **验证**:中文 IME 连续输入,断言 composition 期间无 decoration 重建记录(`diagnostics` 有 `recordFullProjectionBuild` 可断言)。

### P0-3 typedBoundary reveal 细节(范围修正:仅 link/image 闭合符边界)

> **2026-08-04 修正**:深入实现后发现我们的行内标记(bold/italic/code)是"**淡色恒显 marker**"方案(CSS `.cm-md-marker` 低对比色 + 0.88em 等宽,`CodeMirrorEditor.css:63-73`),marker 从不隐藏,不存在"打字瞬间语法消失"。typedBoundary 真正有价值的场景是 **`reveal-source` 记录(link/image)**:输入 `[text](url)` 的闭合 `)` 瞬间,光标落在 `fullRange.to` 右缘,`selectionActivatesRecord` 的"严格内部"判定(`projection-state.ts:803` `from > fullRange.from && from < fullRange.to`)不成立 → 链接立即收起,刚打的 `)` 视觉上消失。行内标记场景无需 typedBoundary。

### P1-4 全量重建限定 visibleRanges

- **Markra 做法**:buildDecorations 按 `view.visibleRanges` 切片遍历;跨区块节点每区重访,只样式实际绘制行。
- **我们现状**:`buildLayoutDecorations` 遍历 `index.records` 全文(全量重建场景:模式切换、reconfigure)。`visible-marks.ts` 已用 `view.visibleRanges`(仅语法标记隐藏模块)。
- **落地建议**:全量重建路径(`compileProjection`)用 `view.visibleRanges` 过滤 records——但**必须保留跨区/相邻语义**:表格、代码块、HTML 块这类"整块 widget"记录,只要与任一可见区重叠就完整重建(不可截断);纯行内记录按可见区裁剪。投影 API 是 `StateField`(无 view),需把 `visibleRanges` 通过事务 effect 或 renderer 层传入,或在 `EditorView` 装饰提供者里做(`wysiwyg/index.ts` 的提供扩展有 view 上下文)。这块改动面较大,建议等 P0 三项稳定后再做。
- **验证**:万行文档滚动,断言滚动期间 decoration 构建次数/耗时上限(现有 diagnostics 已有计数器)。

### P1-5 renderer "认领"语义(评估)

- **Markra 做法**(`renderers.ts:449-468`):渲染器 `render()` 返回 `false` 表示"认领该节点",后续基础标记装饰跳过该节点子树,避免 widget 替换区与行内装饰重叠。
- **我们现状**:等价靠 kind 分支达成——`buildLayoutDecorationsForRecord` 对 html/table/code 等 kind 直接返回各自 widget 装饰,基础行内装饰不会作用于这些记录(`range-index.ts` 中 `html-widget`/`table-widget` 等 renderPolicy 记录不产生行内 atom 记录)。
- **评估**:当前架构下**无需引入**通用认领机制;若未来出现"自定义渲染器插件"需求(像 markra 那样任意第三方注册渲染器),再引入"渲染器返回认领"协议。记录在案,不落地。

### P2-6 代码块 header chrome

- **Markra 做法**(`code-block.ts:167-230` 主题 + header 行):顶部 gap + header 行(语言下拉 `select` + 一键复制按钮)、内容行浅底 + 左右细边框、**行号用 `::before` + `data-code-line-number` 伪元素(min-width 2ch,可开关)**、闭合围栏行高保持可点、整体圆角。
- **我们现状**:行号已是**同款伪元素方案**(`code-block-line-numbers.ts:23,37` `data-md-code-line-number` + `::before` + CSS 变量宽度)——说明这是共识最优解 ✅。M2 已有语言菜单 + 行号 + 复制(body-only copy)。可对照项:header 是否整合语言下拉与复制按钮为单行 chrome、闭合行可点性。
- **落地建议**:对照我们的 `code-block-toolbar-widget.ts` 视觉细节,低优先。

### P2-7 表格 caret-host 光标定位

- **Markra 做法**(`table.ts:63,613,770-827`):单元格编辑用 `createVisualTableCaretHost`(caret-host + `TABLE_CARET_PLACEHOLDER` ZWSP 占位)+ `replaceVisualTableCell` 精确回写源码;空单元格用 `<br>` 保持 caret 可落点。
- **我们现状**:M3 已用 contenteditable 单元格 + 受保护 transaction 回写 GFM 源码(`table-editing.ts` `serializeTableRow`),已验证通过。差异:markra 的 caret-host 对"光标落点稳定性"(尤其空单元格、末尾 Enter 后)有专门处理。
- **落地建议**:仅当出现"空单元格光标跳动/回写后光标漂移"类 bug 时参考 caret-host 技巧;当前不主动改。记录在案。

### P2-8 HTML 白名单(维持现状,不放宽)

- **Markra 做法**(`raw-html-sanitize.ts:12-98`):28 标签(**允许 `data-*` 全放行、`style` 属性走 18 个 CSS 属性白名单、允许 width/height/align/target/rel/loading/decoding/role/aria-label**),禁 script/iframe/svg/math/form/object/embed/template;`template.innerHTML` 浏览器解析 + 逐节点重建;`a` 强制 `rel=noopener noreferrer`。
- **我们现状**(`html-whitelist.ts`):29 标签、**无条件硬拒 `data-*`/`on*`/style/class/id/width/height**、协议白名单 + data:image 非 svg、双轨拒绝语义 + exclusiveFilter 兜底;渲染层禁 innerHTML(DOMParser + createElement 重建)。
- **结论**:**我们的边界更严,保持现状**。markra 的 18 属性 CSS 白名单(`raw-html-sanitize.ts:80-98`)可作为"未来若需支持 style 属性"的参考清单,但引入前需重新走 `m4_html_mdx_security_review.md` 的安全评审(style 是 mXSS/历史漏洞高发面)。注意:我们的 E2E 断言 `[class='hero']` 被剥(`codemirror-m4-html-mdx.spec.ts:68`)即白名单收紧的验收锚点,放宽需同步改测试。

### P3-9 命令注册表统一 UI 入口

- **Markra 做法**(`plugin.ts`):`MarkraPlugin = { id, extension, commands, ui }`,UI contribution 声明 `placement`(toolbar/selection-toolbar/slash-menu/context-menu)与 `when`,统一从 registry 拉取。
- **我们现状**:desktop 层已有 `runtime.commands.list()` + `s1-capability-inventory.ts`(命令注册与审计),但工具栏/菜单未从同一 registry 拉取。
- **落地建议**:应用层 UI(斜杠菜单、右键菜单)规模化前不做;届时把 `placement/when` 概念引入现有 runtime registry。

---

## 3. 不建议复刻(我们的优势)

1. **按 record 增量重建**:我们已优于 markra 的可见区全量重算;补上 P0 快速路径后大文件性能预期反超。
2. **HTML 白名单严格度**:我们拒绝 style/data-*,markra 放行;安全评审(`m4_html_mdx_security_review.md`)已锁定不变量,不放宽。
3. **自研 range-index parser**:markra 的 lezer 路线做 MDX 需换 parser,我们 M4/M5 直接扩展自有语义层。
4. **compositionGuardRanges**:markra 只有"跳过重建",我们有"保护注入区间 + 跳过"的组合能力(补齐 P0-2 后)。
5. **零重依赖**:markra 内置 katex/lowlight/mermaid/turndown,我们按里程碑渐进引入(M4 目前仅 +sanitize-html)。

---

## 4. 落地路线图(建议顺序)

1. **P0-1 + P0-2 + P0-3**(一个 PR,~2-3 个工作日):纯文本快速路径 + composition 跳过 + typedBoundary。三者都改 `projection-state.ts` 更新循环与 `renderer.ts`,一起改避免中间态。
   - 配套:diagnostics 加"跳过重建"计数;补性能/IME/输入跳动三类测试。
2. **P1-4**(单独 PR,需评估 visibleRanges 传入 StateField 的架构改动):全量重建限定可见区,滚动性能。
3. **P2 项**按产品优先级穿插:M3 表格打磨(caret 稳定性)→ 代码块 chrome → 命令注册表。
4. **P2-8 明确不做**,除非产品需求要求 style/data-* 支持(需安全评审重审)。

---

## 附:license 说明

Markra 仓库为 **AGPL-3.0**(强 copyleft)。本文所有"可复刻项"均为**设计模式/架构思路层面的借鉴**(接口形状、决策树、触发条件),不复制其代码表达;落地实现一律在我们的 `renderer-codemirror` 内自研。若未来有直接移植需求,必须先与项目 owner 确认 license 策略(当前仓库无 LICENSE 文件)。
