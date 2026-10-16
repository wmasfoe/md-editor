# 仓库结构与命名规范

> 状态：2026-10-16 起生效（PR1 引入）。**唯一事实来源**：机器可读部分以 `scripts/structure/check.mjs` 中的常量为准，本文件解释其意图与判据；改规则必须同时改「检查器 + 本文件 + 反例测试（`scripts/structure/check.test.mjs`）」。

## 用途（何时必须读）

- 新增/移动**文件或目录**、新增 workspace 包或应用之前；
- 改动 `packages/renderer-codemirror` 的 `wysiwyg/` 结构、测试位置、或任何"整行块级 widget"之前；
- 调整体量阈值、豁免清单、或 `scripts/structure/**` 检查规则之前；
- 出现以下任一提示时：`lint:structure` 失败、需要登记豁免、或需要给某文件放行超过 1200 行。

---

## 1. 目录职责表

| 路径 | 职责 | 说明 |
| --- | --- | --- |
| `apps/*` | 宿主应用（desktop / web / utools / tui / mobile） | 只做平台适配与 UI 集成，不复制编辑器核心语义 |
| `packages/*` | 可复用库（editor-core / renderer-codemirror / editor-ui / compiler / ai / i18n / shared / file-system / mdx-* / markdown-fidelity / syntax-plugins） | 包内 `src/` 是源码，`tests/` 是测试，`exports` 是对外唯一入口 |
| `infra/*` | 基础设施（如 Cloudflare Worker） | 同样纳入体量阈值域 |
| `scripts/*` | 仓库级脚本（release / git / mobile / site / structure …） | 每个子目录自带 `*.test.mjs`（Node `node:test`） |
| `docs/agent/*` | Agent 文档（见 `docs/agent/index.md` 的分类判据） | 新增子目录必须同步更新该 index |
| `docs/human/*` | 面向人类的使用/发布文档 | 与 agent 文档分离 |
| `apps/site` | 官网（Next.js） | **2026-10-16 由根 `site/` 迁入**；Vercel 项目 Root Directory 必须同步设为 `apps/site` |
| `scratch/` | 本地产物目录（`releases.json` 等） | 已在 `.gitignore`，**不入库**、不参与结构检查 |

## 2. 命名与后缀语义

- 文件名一律 `kebab-case.ts`；React 组件文件与 hook 例外：组件 `PascalCase.tsx`、hook `use-*.ts`。
- 后缀语义（同一后缀必须表达同一职责）：

| 后缀 | 含义 |
| --- | --- |
| `*-projection` | 把 Markdown 语法记录投影为装饰/widget（`table-projection`、`html-projection`） |
| `*-editing` | 编辑操作与回写（`table-editing`） |
| `*-commands` | 命令/按键绑定集合（`code-block-commands`、`markdown-commands`） |
| `*-selection` | 选区语义（`atom-selection`、`code-block-selection`） |
| `*-widget` / `widgets/` | DOM widget 定义（`table-widget`、`callout-widget`） |
| `*-state` / `state/` | 投影状态与 effects 的持有者（见 §6） |
| `*.test.ts` | 测试（位置规则见 §3） |

## 3. 测试位置规则

1. **所有测试位于 `<pkg>/tests/**`**；`src/**` 内不允许任何 `*.test.ts*`，也不允许残留 `<pkg>/src/tests/` 或 `<pkg>/src/**/__tests__/` 目录（空目录同样不允许）。
2. **顶层目录镜像**：`<pkg>/tests/<top>` 必须有对应 `<pkg>/src/<top>`，**域内允许扁平**（不要求文件级镜像）。
3. **辅助目录豁免**：`support/`、`fixtures/`、`helpers/`、`__fixtures__/` 不参与镜像检查（存量合法反例：`packages/editor-core/tests/support/`）。
4. **非 TS 宿主测试不入范围**：如 `apps/mobile/ios/Tests/InkpointContractTests/`（Xcode 测试，无 `src/` 兄弟目录）。
5. 各包 `vitest.config.ts` 的 `include` 只允许 `tests/**/*.test.ts(x)`（迁出 colocated 后不得保留 `src/**` 条目）。

## 4. 导入规则

1. **禁止冗余回退段**：`a/b/../c.ts` 必须写成 `a/c.ts`（合法的前导 `../../` 不受影响）。
2. **禁止跨包深导入**：不得 `import ... from "@md-editor/<pkg>/src/..."`；跨包只使用各包 `exports` 中**显式声明**的子路径（如 `@md-editor/editor-ui/hooks`）。
3. **依赖方向**：`src/**` 不得引用 `tests/**`。
4. **不留兼容 re-export**：移动文件后直接改所有调用方（AGENTS.md 第 10 条）；组件内部聚合用的 `index.ts` 属模块边界，不算兼容转发。

## 5. 体量阈值与豁免机制

- **阈值**：单文件 > **800 行** 警告；> **1200 行** 失败。
- **适用域**：`packages/*/src/**`、`apps/*/src/**`、`infra/*/src/**` 的 `.ts`/`.tsx`。
- **不纳入**：`tests/**`、`e2e/**`、`*.css`（理由：测试文件是聚合断言；CSS 拆分风险是层叠与视觉，测试看不见）。
- **豁免清单**：`structure-exceptions.json`（仓库根），条目 `{ id, path, maxLines, reason }`；
  - `id` 是**跨搬迁稳定**的逻辑键（文件搬家时只改 `path`）；
  - 现行 `id` 集合必须是 `scripts/structure/exceptions.baseline.json` 的**子集**（禁止新增）；
  - 同 `id` 的 `maxLines` 不得高于基线（**搬迁 PR 允许 ≤ +5 行 headroom**）；
  - 允许删除条目（拆分完成后必须缩减清单）；
  - 豁免指向的文件不存在即失败（防僵尸条目）；
  - 被豁免文件的实际行数不得超过其 `maxLines`（豁免只允许缩小）。
- **变更流程**：调整豁免必须**同 commit** 修改 `structure-exceptions.json` 与 `exceptions.baseline.json` —— 这会让变更成为显式的双文件 diff（评审信号）。真正的硬阻断需 CODEOWNERS 覆盖 `exceptions*.json` 或受保护分支校验（见 follow-up）。
- **当前豁免（全量，1 条）**：`infra-router-module`(2097，本任务域外、登记冻结)。PR3 已拆分 renderer 与 projection-state，并同步删除两份清单中的对应豁免。
- **可接受的警告**：域内 800–1200 行存量文件（`UtoolsApp.tsx` 1139、`web-file-system.ts` 841、`useDesktopEditorController.ts` 835）产生 warn 但不豁免；`tests/` 内的 2 个 >1000 行测试文件不在适用域。

## 6. 域是职责标签（taxonomy），不是分层（layering）

`packages/renderer-codemirror/src/wysiwyg/` 分为 6 个职责域：`state/`、`blocks/`、`projections/`、`editing/`、`input/`、`view/`（外加既有 `widgets/`）。

**不要**据此施加"低层不得依赖高层"的护栏 —— 实测跨域依赖是向外的单向边，例如：

- `state/decorations.ts` / `state/ranges.ts` / `state/projection-field.ts` → `projections/inline-heading`、`projections/link-projection`、`input/plain-text-input`
- `state/change-protection.ts` → `projections/code-block-projection`
- `blocks/atom-selection.ts` → `state/change-authorization`
- `editing/table-editing.ts` → `projections/table-projection`

域只回答"文件放哪"，不承诺依赖方向。

PR3 的 `state/` 成员固定为 `types.ts`、`projection-field.ts`、`decorations.ts`、`ranges.ts`、`atoms.ts`、`visible-marks.ts`、`change-authorization.ts`、`change-protection.ts`。
`types.ts` 持有 Facet/Effect 唯一实例，`projection-field.ts` 持有 StateField 唯一实例以及依赖该字段的配置/查询入口；装饰、范围与 atom 计算按职责拆出，禁止为旧路径保留兼容转发。
`widgets/table/index.ts` 是表格 widget 的目录聚合边界，DOM、提交与焦点行为在同目录协作。

## 6.1 协作者（collaborator）模式与 cluster 级体量契约

把巨型文件拆成"入口 + 协作者"时，遵守以下约定（PR3 拆分 `renderer.ts` / `projection-state.ts` / `table-widget.ts` 时确立）：

1. **状态归属单一**：可变状态由**入口模块**（owner，如 `CodeMirrorRendererController`、`TableGridWidget`、`wysiwygProjectionField`）持有；协作者是**叶子模块**，只能通过显式参数或窄 context 对象读写 owner 的状态，不得自行持有可变状态。
2. **例外须登记**：确需共持有的状态必须在**代码注释**与本节各写一处，说明为何不能收敛到 owner（当前实现已全部收敛到 owner，无例外实例；本条目为条件式约束）。
3. **依赖单向**：协作者之间只允许单向依赖；跨模块共享类型用 `import type`，不得引入运行期双向 import 或求值环。
4. **cluster 级体量契约（机器强制）**：`CLUSTER_STRICT_PACKAGES`（当前 `packages/renderer-codemirror`）内**任何** `.ts/.tsx` 超过 800 行即**失败**——防止"把巨型文件拆成巨型协作者"。其它包仍为 >800 警告 / >1200 失败。
5. **命名**：协作者名以其**职责角色**命名（`mode-viewport`、`document-protocol`、`host-visibility`、`transaction-ledger`、`view-operations`、`probe`、`composition`、`selection`、`validation` 等），不得用 `helpers`、`utils`、`misc` 等无语义名。
6. **登记义务（pr3 起机器强制）**：新增/重命名协作者必须同步登记：`wysiwyg/**` 与 `widgets/**` 走 `WYSIWYG_DOMAIN_MEMBERS`；`renderer/**` 走 `RENDERER_CLUSTER_MEMBERS`（顶层与 `controller/` 两个作用域）。未登记成员会被判为"多出未登记的簇成员"而失败；已登记但缺失同样失败。
7. **不留副本**：抽取后必须删除原位置实现；禁止保留兼容 re-export（`index.ts` 仅作目录聚合）。

---

## 7. 规则分批上线（ruleset rollout）与基线自检铁律

护栏只在"**自身 PR 完成后为真**"时才启用，否则护栏测的是历史欠债而非本次改动。

| 阶段 | 启用规则 |
| --- | --- |
| `--phase pr1` | 体量阈值+豁免、冗余回退段路径、跨包深导入、测试镜像 |
| `--phase pr2` | 追加：`src/**` 无测试文件/目录、`wysiwyg/` 顶层集合相等、逐文件域归属 |
| `--phase pr3` | 追加：renderer/index、renderer/controller、state/projection-field、widgets/table/table-widget 均 ≤800 行 |

**铁律**：任何形如"全部/精确/不得/零命中"的新判据，必须先在**未迁移的当前 main** 上跑绿再进入验收。

## 8. 检查器用法

```bash
pnpm lint:structure                 # 等同于 node scripts/structure/check.mjs --phase pr3（已串入 pnpm lint）
node scripts/structure/check.mjs --phase pr2 --json     # 指定阶段 + JSON 输出
node scripts/structure/check.mjs --root <fixture-dir>   # 在 fixture 根上运行（反例测试用）
node --test scripts/structure/check.test.mjs            # N 类反例（已串入 pnpm test）
```

失败信息格式：`FAIL [<规则>] <相对路径>: <原因>`；警告不阻塞。

## 9. 变更本规范的流程

1. 改 `scripts/structure/check.mjs` 的常量/规则（并保持阶段门控）；
2. 在 `scripts/structure/check.test.mjs` 增加或更新反例（证明会拦人、且不误伤存量）；
3. 更新本文件对应章节（含初始豁免清单）；
4. 若涉及新增/移动目录，同步更新 `docs/agent/index.md` 与 `AGENTS.md` 的相关引用；
5. 跑 `pnpm lint`（含 `lint:structure`）、`pnpm test`（含 `test:structure`）、`pnpm typecheck`。
