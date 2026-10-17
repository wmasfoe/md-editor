# CJK 友好强调契约规范：`**加粗**` / `~~删除~~` / `==高亮==` 的中文标点邻接

用途：记录「中文（CJK）句子里的强调标记为什么曾经不生效、现在按什么规则解析、两个渲染引擎各自落在哪」。
改动**强调 / 斜体 / 删除线 / 高亮的定界符解析**、lezer Markdown 扩展链、或 `@md-editor/compiler` 的 marked 配置前先读本文件。

适用范围：`packages/renderer-codemirror`（编辑器语法树与 WYSIWYG 投影）、`packages/syntax-plugins`（`==高亮==` 等插件语法）、`packages/compiler`（静态渲染：移动端阅读器 / QuickLook / 导出）。

---

## 1. 问题：CommonMark 的 flanking 规则与 CJK 排版互斥

CommonMark §6.2 用 **left-flanking / right-flanking delimiter run** 判定强调能否开合，而规则里的「Unicode 标点」
把全角标点（`「」`、`（）`、`。、：`）也算作标点；CJK 又不使用空格分词，于是标记两侧的判定**同时**失败：

```text
本文档整理了从**「爆款洗稿（视频/小说逆向拆解）」**到**「角色锁定」**的完整落地路径
                ↑ 后接 `「`（标点）、前接 `从`（汉字）⇒ 开定界符不满足 left-flanking
                           ↑ 前接 `」`（标点）、后接 `到`（汉字）⇒ 闭定界符不满足 right-flanking
```

后果不只是"不加粗"，而是**跨对错配**：第一对 `**` 退化为字面文本，后面的 `**到**` 反而被识别成加粗。
用户唯一可行的规避是手动在标记外侧补空格，而补空格会在正文里留下**可见空隙**，不是等价修复。

上游结论一致：commonmark-spec#650、cmark-gfm#80 均确认当前行为"符合规范但不符合 CJK 排版预期"；
GitHub / GFM 同样不复现中文标点邻接的加粗。因此这是**有意偏离规范**的兼容性修订，必须显式记录。

## 2. 采用的规则：CommonMark「CJK-friendly amendments」

规则来源：<https://github.com/tats-u/markdown-cjk-friendly/blob/main/specification.md>（社区修订，正推进合并进 commonmark-spec）。

| 项 | 约定 |
| --- | --- |
| flanking 判定用的标点集合 | 「**非 CJK 标点**」——CJK 标点按**普通文字**对待（这是修复的核心） |
| 合法前置边界 | 追加承认 `CJK 序列`（CJK 字符 + 非 emoji 变体选择符）与 `IVS`（U+E0100–U+E01EF） |
| `_` / `__` 家族 | **保持 CommonMark 词内限制**（`a_b_c`、`中_斜体_文` 仍不解析）；规范修订刻意不放宽 |
| 非 CJK 文本 | 解析结果与标准 CommonMark **完全一致**（纯增量兼容，不是全域放宽） |
| 未定义情形 | 邻接孤立/残缺变体选择符时，规范标注为 **Unspecified**（各方实现允许不同） |

覆盖的定界符语法：`*` / `**`（斜体 / 加粗）、`~~`（GFM 删除线）、`==`（本仓库的高亮扩展）。

## 3. 引擎落点（唯一事实来源与各引擎映射）

同一套判定必须在两个引擎上一致，否则会出现「编辑器所见 ≠ 阅读器/导出所得」：

| 引擎 | 落点 | 说明 |
| --- | --- | --- |
| lezer 语法树（WYSIWYG 编辑器） | `packages/renderer-codemirror/src/markdown/cjk-friendly-emphasis.ts` | 按名替换 `Emphasis` 与 GFM `Strikethrough` 行内解析器；`M1_MARKDOWN_EXTENSIONS` 统一挂载（必须在 `GFM` 之后） |
| 共享判定函数 | `resolveCjkFriendlyDelimiterSides()` + `readDelimiterNeighbors()`（同上文件，经包入口导出） | `==高亮==` 等自定义定界符直接复用，不再各自复刻标点正则 |
| marked（静态渲染 / 移动端阅读器 / QuickLook） | `packages/compiler/src/parser/tokenizer.ts` | 接入 `marked-cjk-friendly`，但**只接管 `*` 家族与 `~~`**；`_` / `__` 交回 marked 默认实现 |

依赖与版本下限：

- `@lezer/markdown >= 1.8.0`：该版本起导出 `InlineContext.emphasisAsterisk` / `emphasisUnderscore`，替换解析器产出的定界符才能按强调规则 resolve；同时修掉「部分消耗的定界符 run」配对缺陷。
- `micromark-extension-cjk-friendly-util`：提供 CJK 字符 / CJK 标点 / IVS / 变体选择符 / Unicode 标点的分类，**避免自维护 Unicode 表**。
- `marked-cjk-friendly >= 0.1.2`（peer `marked >= 15`）：上游 marked 实现。

### 3.1 为什么 marked 侧要收回 `_` 家族

`marked-cjk-friendly` 把 CJK 字符整体按标点对待，隐含地**放宽了 `_` 的词内限制**（例如 `这是 _斜体_文字` 会被它解析成斜体）。
这与规范修订和编辑器语法树都不一致，会造成「移动端阅读器显示斜体、桌面编辑器显示字面下划线」的保真缺口。
做法是把 `_` 开头的位置交回 `Tokenizer.prototype.emStrong`（marked 默认实现），其余交给扩展。

## 4. 验证方式（改这块必须重跑）

1. **对规范参考实现零分歧**：用 `micromark + micromark-extension-cjk-friendly(+gfm-strikethrough)` 作为基准，
   对 5 类定界符 × 25 种边界字符（空 / 空格 / ASCII / CJK 汉字 / 日文 / 韩文 / 全角标点 / ASCII 标点 / emoji / VS15 / VS16 / IVS / CJK 扩展区）× 25 的矩阵比对，当前为 **3125 例 0 分歧**。
2. **跨引擎一致**：编辑器语法树 vs `compileToTokens` 的同类矩阵（2646 例）中，`*` / `**` / `~~` / `==` 全量一致；
   `_` / `__` 剩余 56 例差异**全部**落在"变体选择符（VS15/IVS）与下划线直接相邻"这一**规范标注为 Unspecified** 的窄带（或 marked 默认实现不处理星号面代理对的 `prevChar`）。
3. 回归用例：`packages/renderer-codemirror/tests/markdown/cjk-friendly-emphasis.test.ts`、
   `packages/compiler/tests/cjk-emphasis.test.ts`、`packages/syntax-plugins/tests/highlight.test.ts`（CJK 邻接用例）。
   三条用例都锁定了**本次报告的原始串**与"不得再出现 `**到**` 跨对错配"。

## 5. 踩坑与禁止事项

- **不要用"两侧加空格"当修复**：那会向正文插入可见空隙，属于改变用户内容。
- **不要把 `_` 家族也放宽**：`marked-cjk-friendly` 的默认行为就是这样，已在本仓库显式收回（见 §3.1）。
- **不要自己写 Unicode 分类表**：东亚宽度、emoji 例外、IVS、变体选择符的边界由 `micromark-extension-cjk-friendly-util` 承担。
- **不要用 `cx.slice(pos - 1, pos)` 取"前一个字符"**：`InlineContext.char`/`slice` 以 UTF-16 码元为单位，
  CJK 扩展区（U+20000+）、IVS（U+E0100+）、emoji 都会拿到半个代理对，分类必然判错；必须用 `readDelimiterNeighbors()`。
- **行首探测要按 `cx.offset` 截断**：`cx.char(-1)` 返回 `NaN` 而不是 `-1`，会让"行首等价于空白"的判定失效（曾导致 `_x_` 在行首不解析）。
- 升级 marked 大版本时，除了跑 `packages/compiler` 测试，还要确认 `Tokenizer.prototype.emStrong` 仍存在（`_` 家族委派依赖它）。
