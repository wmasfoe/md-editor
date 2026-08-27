# M4 HTML / MDX 安全评审记录（G003 阶段 0 交付物，C7）

> 用途：G003（M4 基础 HTML / 官方 MDX）的依赖评审记录。验收锚点 C7（`test-spec-g003-html-mdx.md` §1）。评审结论先行：**方案获批**，锁定依赖版本与白名单形态；升级触发器与纵深补位方案一并记录。
> 配套决策：`.omx/plans/prd-g003-html-mdx.md`（D1-D11）、`.omx/plans/test-spec-g003-html-mdx.md`（C1-C7 + 攻击向量表 #1-17）。

## 1. 结论摘要

| 项 | 结论 |
| --- | --- |
| HTML 清洗方案 | **sanitize-html@≥2.17.6**（Node 无 DOM 可运行，满足 L1 无 DOM 约束） |
| 渲染方案 | CM6 原生 DOM widget 重建（禁 innerHTML 装载用户内容），双层纵深（字符串层 sanitize + 渲染层 DOM 重建） |
| MDX 解析方案 | micromark granular 系（`micromark-extension-mdx-jsx` 无 acorn 模式），registry 白名单求值，禁止任意 JSX 执行 |
| CSP | prod/dev 双形态，`connect-src` 放行 AI 端点（盘点结果见 §4），`style-src 'self'` 严格优先 |
| 升级触发器 | 再出影响本白名单的 sanitize-html 公告 → DOMPurify + jsdom 重审（纵深补位）；MDX 面出新 XSS 类公告 → 同流程 |

## 2. sanitize-html 选型记录

### 2.1 版本、license、维护状态

- **版本**：锁定 ≥2.17.6（当前最新；pnpm catalog 落账时以安装时最新稳定版为准）。
- **License**：MIT。
- **维护状态**：活跃；近一年（2025-07 ~ 2026-08）多次安全修复发布，响应及时。

### 2.2 具名安全公告史（近一年，2026 年三次兑现）

| CVE / GHSA | 影响 | 修复版本 | 与本项目白名单的关系 |
| --- | --- | --- | --- |
| CVE-2026-40186 | XSS | 2.17.3 | 与白名单标签（img/p 等）相关，修复已含 |
| CVE-2026-53606 | `javascript:` URI 未改写 | 2.17.5 | 直接相关（协议白名单） |
| CVE-2026-44990（GHSA-rpr9-rxv7-x643） | `<xmp>` raw-text 走私：仅 2.17.3 受影响、**2.17.4 修复**；默认 `disallowedTagsMode: 'discard'` 路径下 htmlparser2 把 xmp 内容当文本、输出未转义复活为可执行 HTML，CVSS 9.3 | 2.17.4 | 白名单不含 xmp + 渲染层禁 innerHTML，双层兜底（向量表 #17 实测） |

- **版本事实**：受影响 =2.17.3、修复 2.17.4；2.17.5 补 `javascript:` 加固；2.17.6 为 2026-07-10 最新。锁定 ≥2.17.6 为保守下限。

### 2.3 mXSS 分析结论

- sanitize-html 基于 htmlparser2（tokenizer 级字符串处理），对"DOM 树外残片在浏览器 parser 中复活"（mXSS）的理论面弱于浏览器 parser 型 sanitizer（DOMPurify）。
- 缓解（三层）：①白名单收窄（无 svg/math/form/iframe/style/xmp）——2026 在野类恰好都依赖这些标签；②渲染层禁 innerHTML（走私 payload 在 widget 层被 textContent 降级为纯文本）；③向量表 #8/#9/#17（mXSS/parser differential + xmp 走私）在 L1 + L3 双跑实测。
- **备选 DOMPurify 为何不选**：DOMPurify 强依赖浏览器 DOM（或 jsdom 补环境）——与本里程碑"L1 Node 无 DOM 直接可测"（`vitest.config.ts:5` `environment: "node"`）冲突；且引入 jsdom 会扩大测试依赖面。保留为升级触发器的纵深补位。

### 2.4 实证验证（2026-08-03，sanitize-html@2.17.6，Node 24 直接运行）

| 行为 | 实测结果 | 对设计的影响 |
| --- | --- | --- |
| 属性剥离时序 | `exclusiveFilter` 收到的是 **allowedAttributes 过滤后**的属性（`<img onerror>` 到回调时只剩 `src`） | 双轨①成立：已登记标签走属性级剥离；exclusiveFilter 只做残留复检，不会误杀 |
| 未登记 allowedAttributes 的白名单标签 | **放行全部属性**（`<strong data-x onclick>` 原样保留） | 不变量成立必需：每个白名单标签都登记属性；exclusiveFilter 对未登记标签 fail-closed 整标签剔除 |
| `data:image/svg+xml` src | **不被 scheme 过滤剥离**（src 保留、内容实体转义） | scheme 层管不到 data 子类型 → exclusiveFilter 必须按值整标签剔除（向量 #10 期望已改为整标签移除） |
| xmp 走私（CVE-2026-44990 类） | `<div><xmp><script>…` → `<div></div>`（内容随标签丢弃，2.17.6 修复生效） | 向量 #17 字符串层断言成立 |
| 无 scheme 相对值 | `src="x"`/`href="/a"` 不被剥离 | 纯函数语义定为"无 scheme 放行、有 scheme 必须入白名单"（相对路径不具脚本执行面） |
| mXSS #8（math/mtext/table 载荷） | 幸存仅 `<img title="--&gt;&lt;img…" />`（载荷进 title 文本、实体转义，无实义危险属性） | L1 断言用"存活标签真实属性提取"而非全文正则（转义文本含 onerror 字样会误报） |
| 大小写/实体 | 标签/属性名小写化；`&#106;…` 实体解码后 scheme 校验（javascript: 被剥离） | 向量 #7/#16 断言成立 |

### 2.4 拒绝自研理由

自研 HTML parser 在实体解码、嵌套、mXSS 边角上需要复刻 htmlparser2 + 浏览器差异知识，属高错误面且与仓库"成熟开源方案优先"（AGENTS.md 注意事项 2）直接冲突。

## 3. MDX 解析选型记录

### 3.1 方案与版本

- **micromark** + **micromark-extension-mdx-jsx**（**无 acorn 模式**——"unaware of JavaScript"，JSX 标签结构纯文法解析，不引入 JS 解析器/JSX 运行时）+ **micromark-extension-mdx-md** + **mdast-util-mdx-jsx** + **mdast-util-from-markdown**；版本以 pnpm 安装时最新稳定为准（catalog 落账）。
- 产出 mdast AST + 精确 position（→ CM6 源码范围映射），Node 与浏览器同构可跑。

### 3.2 排除项（评审记录）

- **umbrella `micromark-extension-mdxjs`**：自 2023-10 v3.0.0 停更约 2.8 年；**强制依赖 acorn + acorn-jsx**（JS 解析器，与"不引入 JSX 运行时"自相矛盾）；其 export/import（mdxjs-esm）功能明确超范围。
- **`@mdx-js/mdx` 编译链路**：官方完整栈但产出 JSX/运行时模块，与"白名单求值"架构相悖（等于把求值从 registry 移到编译器输出），增量解析重。
- **正则预筛**：架构文档 `:287` 禁止（`isLikelyMdxBlock` 仅作性能预筛，正式范围一律 micromark 权威解析）。

## 4. webview 网络端点盘点（D6 前置，2026-08-03）

| 端点 | 位置 | 形态 | CSP 影响 |
| --- | --- | --- | --- |
| `${settings.openAiCompatible.baseUrl}/chat/completions` | `packages/ai/src/completion.ts:169,178`（全局 fetch，`fetchImpl` 可注入但无调用侧注入，types.ts:76） | 用户可配置 OpenAI-compatible baseUrl：默认 openai/deepseek（https 远程）、本地 llama 场景可为 `http://127.0.0.1:<port>` | `connect-src` 必须含 `https:` 通配 + `http://127.0.0.1:*`，否则**静默杀死全部 AI 续写**（本里程碑最高风险项） |
| `https://api.github.com/repos/wmasfoe/homebrew-tap/releases?per_page=20` | `apps/desktop/src/app/settings/app-settings.ts:135-136,404,407` | 发布检查（https，GitHub API） | `https:` 通配覆盖 |
| Vite HMR（dev） | Tauri dev webview | `ws://localhost:7273`（`vite.config.ts:53`、`tauri.conf.json:9` devUrl） | 仅 dev CSP 覆盖需要 |
| asset protocol / 图片 | `asset:`（`tauri.conf.json:30`） | `img-src 'self' asset: data:` | 已定形 |

**盘点结论**：无 WebSocket/EventSource/XMLHttpRequest、无 Tauri HTTP 插件（搜索零命中）。`connect-src` 定形：`'self' ipc: http://ipc.localhost https: http://127.0.0.1:*`（ws:// 仅 dev 覆盖）。**把 AI 请求改走 Tauri HTTP 插件移出 webview 属越界改动**（涉及 app-settings 结构 + 错误面迁移），不入本里程碑，记录待评估。

## 5. 白名单形态（D5，落代码即此清单）

- tags：`p div span h1 h2 h3 h4 h5 h6 blockquote pre code br hr ul ol li a img strong em b i u s sub sup small mark`（**不含** table 系、form 系、iframe/object/embed/script/style/link/meta、svg/math/input/button、xmp）。
- attributes：`a[href,title]`、`img[src,alt,title]`、其余标签显式登记 `title`（逐标签写入 `allowedAttributes`）；拒绝 class/id/style/data-*/on*/srcdoc/width/height。
- **双轨拒绝语义**：①已登记标签属性级剥离（拒绝属性移除、标签保留）；②`exclusiveFilter` 兜底（漏配标签命中拒绝属性 → 整标签剔除；`data-*`/`on*` 前缀无条件硬拒）。
- 协议：`http/https/mailto/asset/data-image` 白名单；拒绝 `javascript:`/`data:text/html`/`file://`/`data-svg`。
- 含被剥的块级结构标签（table/form 系）→ **整块错误占位**（fail-closed），不拼接乱文。

## 6. CSP 形态（D6）

- prod：`default-src 'self'; script-src 'self'; style-src 'self'`（严格优先，回归破才退 `'unsafe-inline'` 并记录）；`img-src 'self' asset: data:`；`connect-src` 见 §4。
- dev：独立 dev 覆盖放行 Vite HMR（`ws://` + `http://localhost:7273`）。
- 双环境回归清单：图片/字体/asset protocol/HTML widget/HMR/**AI 续写请求**（dev 与 prod 各一行记录）。

## 7. 已知局限（显式记录）

- e2e 环境（`http://127.0.0.1:4173` 纯 Vite）无 Tauri CSP 头——CSP 行为靠配置断言单测 + 手工回归。
- sanitize-html 的 mXSS 理论面弱于 DOMPurify（§2.3 三层缓解）。
- 攻击向量表 #1-17 之外的未知向量无法穷举——升级触发器兜底。

## 8. 升级触发器

1. sanitize-html 再出**影响本白名单**的安全公告 → DOMPurify + jsdom 重审（选型变更需回 ralplan/用户确认）。
2. micromark-extension-mdx-jsx 出 XSS 类公告 → 同流程。
3. 白名单任何标签/属性调整 → U-SANITIZE 清单断言同步更新（禁止只改常量不改测试）。
