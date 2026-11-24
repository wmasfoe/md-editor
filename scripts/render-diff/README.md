# 渲染差分测试（render-diff）

守护「桌面/QuickLook 的 Rust 渲染器」与「移动端的 TS 渲染器」长期等价。

## 为什么需要它

`apps/mobile/core/src/components/ReaderCanvas.tsx` 永远使用 `@md-editor/compiler`（TS），
而桌面导出与 QuickLook 预览改用 Rust 渲染核心。**两套实现是终态，不是过渡态。**

一致性不能靠人工纪律，只能靠一个会失败的测试。

## 设计决定：不做 golden 快照

任务契约最初写的是「把当前 JS 输出固化为 golden」。实现时改为**实时双跑对比**：

```
fixture.markdown ──┬──→ @md-editor/compiler（TS）──→ expected
                   └──→ crates/render（Rust）    ──→ actual
                                                        ↓
                                            按 mode 断言等价
```

理由：

1. **没有快照过期问题**。参考物永远是「当前的 JS 实现」，JS 侧行为一改，差分立刻暴露。
2. **不会被 prettier 破坏**。若把 golden 存成 `.md` / `.html` 文件，`prettier --check .`
   会重写它们，字节级比较随之失效。语料因此以 `.mjs` 模块内的模板字符串形式存放。
3. **JS 实现是永久存在的一方**，天然适合当参照物。

## 比较模式

每条 fixture 显式声明 `mode`：

| mode | 含义 | 适用 |
|---|---|---|
| `byte` | 逐字节一致 | 输出完全由我们控制的语法：标题 ID/去重/legacy 别名、callout、`==highlight==`、代码高亮结构、KaTeX 公式、整体 HTML 骨架 |
| `semantic` | 规范化投影一致 | 实现不同但语义应等价：CJK 强调/删除线边界（comrak 的 `cjk_friendly_emphasis` 与 `marked-cjk-friendly` 是两套独立实现，不 fork comrak 就无法保证字节一致） |

`semantic` 的投影规则（见 `lib.mjs` 的 `projectHtml`）：

- 属性排序（HTML 里属性顺序无语义）
- 文本节点折叠空白、裁剪两端、丢弃空节点
- **不放宽标签结构**：一侧 `<strong>` 另一侧 `<em>` 仍判失败
- 非 void 元素的自闭合 `<div/>` 展开为 `<div></div>`

间距类回归由 `byte` 模式的 fixture 守护，因此 `semantic` 裁剪空白不会漏掉真实差异。

## 自收紧规则

避免「永久跳过」退化成永久漏测：

- `crates/render/Cargo.toml` **不存在** → 阶段 0 状态，跳过 Rust 侧并显式报告待对齐语料数量
- `crates/render/Cargo.toml` **存在但渲染器跑不起来** → **测试失败**

也就是说，一旦开始实现 Rust 侧，这个测试立刻开始真正守门，不需要额外记得「把 skip 改成 fail」。

## Rust 侧接口约定

`crates/render` 需要提供一个 `render-fixtures` bin：

```bash
cargo run --manifest-path crates/render/Cargo.toml --bin render-fixtures
```

- stdin：`{ "fixtures": [{ "id": "…", "markdown": "…" }] }`
- stdout：`{ "results": { "<id>": "<html>" } }`

一次进程调用渲染全部语料，避免逐条启动开销。

## 目录

```
scripts/render-diff/
  corpus/
    inline-and-cjk.mjs   行内语法与 CJK 邻接边界
    blocks.mjs           标题 ID / 列表 / 表格 / 代码块 / 引用块
    plugins.mjs          callout / directive / ==highlight== / 数学 / mermaid
    edge.mjs             空文档 / frontmatter / 围栏陷阱 / 组合文档
    index.mjs            汇总 + 语料自校验
  lib.mjs                HTML 投影与比较（纯函数）
  lib.test.mjs           比较逻辑单测
  render-diff.test.mjs   差分测试本体
  real-docs-parity.mjs   仓库内全部 markdown 的真实文档对比
  fuzz.mjs               组合式 fuzz（固定种子，6 个套件约 1258 例）
```

**三层防线**，覆盖「想到的」之外还覆盖「没想到的」：

1. `corpus/` —— 手写语料，每条声明 `mode` 与所守护的 TS 契约（精确、可读）；
2. `real-docs-parity.mjs` —— 仓库里 364 份真实 markdown（贴近生产写法）；
3. `fuzz.mjs` —— 笛卡尔积 + 固定种子随机组合（1.2k 例，30 秒）。

fuzz 与 `KNOWN_DIVERGENCES.md` 联动：命中已登记项的不计入失败但会单独列出，
避免「绿测掩盖未登记差异」。历史上半数以上分叉是通过 fuzz 发现的
（highlight 嵌套、容器内定义行、列表续行缩进等）。

语料新增时：`mode` 必须显式声明，`guards` 必须写明守护 `packages/compiler/tests/` 里的哪条契约，
否则 `validateCorpus` 会失败。

## 已知且显式接受的分歧

见 [KNOWN_DIVERGENCES.md](./KNOWN_DIVERGENCES.md)。

目标明确要求「若某项无法达到约定的等价级别，停止并上报，**不得悄悄降低验收标准**」，
因此**所有**接受的差异都必须登记在案，并说明为什么接受。差分语料与
`real-docs-parity.mjs` 不覆盖这些形态。

## 运行

```bash
pnpm test:render-diff     # 单独运行
pnpm test                 # 全仓测试链的最后一环
```
