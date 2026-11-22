# PR #290 公开 API 合并后审查

审查基准为 2026-11-22 合入 `main` 的 [PR #290](https://github.com/wmasfoe/md-editor/pull/290)，提交 `f9a6be16`。以下是基于该版本的修复建议，供后续实现和验收使用。

建议保留这次拆包。主题变量由 editor 统一编译，React 写入单个编辑器，app-ui 复用同一映射生成应用主题。core 通过 shared 获取 MDX 契约，也消除了对插件 SDK 的依赖。**发版前优先修插件注册与 lint 配置**，这两处已经能让按公开接口接入的宿主进入错误状态。随后修复锚点定位和可选模块的刷新范围。[主题编译器](../../../packages/editor/src/theme/compile.ts) · [应用主题调用方](../../../packages/app-ui/src/themes/style-compiler.ts) · [core 入口](../../../packages/core/src/index.ts)

## 1. 插件注册应整批生效，句柄应只释放当次注册

**触发条件。** 命令式注册插件对象 `p` 后，调用 `setSyntaxPlugins([p])` 会被当成无变化。控制器比较的是含有命令式条目的完整注册表，跳过了声明式集合的冲突校验。另一个已复现的问题是，同一个 `p` 卸载后重新注册，再次调用旧句柄的 `dispose()` 会卸掉新注册。桌面 registrar 只按 ID 删除，连换成同 ID 的另一个实例也受影响。[编辑器注册管理](../../../packages/editor/src/renderer/controller/plugin-management.ts) · [SDK 注册表](../../../packages/plugin-sdk/src/syntax-registry.ts) · [桌面 registrar](../../../apps/desktop/src/app/plugins/syntax-conflict-validation.ts)

**跨层原因。** 桌面预检会对比内置插件的节点名，但在已注册的外部插件中只检查 ID。两个不同 ID 的外部插件声明同一个节点策略时，宿主可以先接受两者。React 随后逐个调用 `addSyntaxPlugin`，第二个被 SDK 拒绝时，第一个已经注册，负责清理的函数还没返回。另有一个缺口是 SDK 对节点策略做预检，却没有覆盖两个外部插件仅通过 Lezer `defineNodes` 声明同名节点的情形。后者是静态检查发现的规则差异，未观测到 Lezer 崩溃。[桌面逐项注册](../../../apps/desktop/src/components/editor/use-external-syntax-registration.ts) · [SDK 预检](../../../packages/plugin-sdk/src/syntax-registry.ts)

**怎样改。** 桌面负责启用清单和内置名称保留策略，SDK 统一提取节点名、校验冲突并区分注册来源。声明式替换只与原声明式清单比较。SDK 和桌面句柄都应可重复释放，并能区分同一插件对象的两次注册。编辑器先校验候选集合，再提交注册表和 CodeMirror 更新；短期若仍逐项添加，失败时须回收本批已创建的句柄。

**验收。** 同一对象跨来源注册也报冲突；旧句柄第二次释放后新注册仍有效；两外部插件发生节点冲突时，宿主清单和编辑器均保持原集合；切换一个内置插件后，已启用的外部插件仍可用。

## 2. lint 同时提交引擎与开关，并对齐官方类型

**触发条件。** README 推荐的 `markdownlint={{ lint }}` 在严格 TypeScript 下出现 `TS2322`。运行期从“有引擎、已开启”切换到“无引擎、已关闭”也有问题。React 先撤出引擎，控制器已经写入新值，又按旧开关重新启用 lint，随即抛错。单纯调换两个 effect 的顺序，会把顺序问题移到开启路径。[README 示例](../../../packages/editor/README.md) · [引擎类型](../../../packages/editor/src/lint/engine.ts) · [React 接线](../../../packages/editor/src/react/CodeMirrorEditor.tsx) · [lint 控制器](../../../packages/editor/src/renderer/controller/markdown-lint.ts)

**怎样改。** 让编辑器控制器一次接收目标 `{ engine, enabled }`，先校验目标组合，再将引擎 facet 和实时 lint 扩展放进同一事务，成功后更新控制器状态。React 提交完整配置，现有命令式端口可委托给同一实现。保留“开启时缺引擎立即报错”的契约。按实际读取的字段对齐官方结果类型，包括可为 `null` 的诊断信息，将 README 中直接传入官方 `lint` 的示例接入已有编译检查。

**验收。** 严格模式下原样示例可编译，无需类型断言。同一轮 React 更新可以同时注入并启用，也可以同时关闭并撤出；非法组合失败后，旧配置仍可使用。传入函数身份相同的新包装对象时，继续跳过重复配置。

## 3. 可选模块按用途刷新，释放旧编辑器状态

**代码证据。** HTML 消毒器、MDX 解析器和粘贴转换器都触发同一个无参数就绪通知。只要视图有 HTML 记录，连只供下次粘贴使用的 Turndown 就绪也可能触发完整 range index 重建。另一方面，降级路径把 `EditorState` 放入模块级 `Set`，就绪判断却改成读取视图索引，生产路径中已没有消费该集合的调用。慢加载期间记录的状态可在视图销毁后继续被引用。另一个监听器若抛错，还会中断后续视图的通知，并落入导入失败的 catch。额外解析耗时和堆占用未做量化测量。[模块缓存与通知](../../../packages/editor/src/module-loader.ts) · [视图订阅](../../../packages/editor/src/renderer/controller/optional-modules.ts) · [索引重建](../../../packages/editor/src/markdown/range-index.ts)

**怎样改。** 保留跨视图共享的模块缓存，让就绪通知携带模块名。消毒器就绪只刷新等待 HTML 预览的投影，MDX 就绪才重建受影响视图的解析索引，Turndown 就绪无需派发编辑器事务。删除旧 `Set`、全局标记及沿解析链传递的 `scope`。将导入失败与监听器异常分开处理，确保一个视图发生异常时其余视图仍能收到通知。

**验收。** 用两个真实视图断言 HTML 占位被替换、MDX 记录得到解析，并核对无关视图的完整索引重建次数。Turndown 就绪前后该计数应相同。让首个监听器抛错，后续订阅者仍应收到通知。现有用例只检查 `mode` 有值，无法证明 HTML 已经升级。[现有用例](../../../packages/editor/tests/module-loader-pending-work.test.ts)

## 4. 标题锚点同时保证 ID 唯一与导航目标正确

**已复现的冲突。** 标题 `A`、`A`、`A-1` 导出为 `a`、`a-1`、`a-1`。分配器按原始 slug 计数，没有登记实际分配出去的 ID。另一个独立冲突发生在旧别名上，`テスト手順` 和 `ガイド手順` 会各输出一个 `id="手順"`。[共享分配器](../../../packages/shared/src/heading-slug.ts) · [HTML 发射器](../../../packages/compiler/src/emitter/html-emitter.ts)

**导航与导出的分歧。** 大纲按行匹配标题，导出按 Markdown token 识别标题。若代码围栏中有一行 `# 安装`，围栏外又有真正的 `# 安装`，大纲会提前分配 `安装`，而导出只给真实标题分配这个 ID。列表项中的块转换也会创建新的默认分配器，嵌套标题可能失去文档级去重上下文。这些路径来自源码审查。[大纲与片段解析](../../../packages/markdown-fidelity/src/index.ts) · [列表项与块转换](../../../packages/compiler/src/parser/tokenizer.ts)

**怎样改。** shared 记录文档内已占用的最终 ID，碰撞就递增至可用值。compiler 将同一分配器传入所有嵌套块，递归收集真实标题 ID 后，仅为仍可用的旧别名输出一次锚点。markdown-fidelity 复用已有围栏识别逻辑，并明确引用、列表内标题在大纲展示和 ID 分配中的处理规则。

**验收。** 覆盖数字后缀、重复旧别名、围栏示例和嵌套标题。对每篇样本文档检查导出 HTML 的全部 ID 唯一，并用导出片段调用 `resolveHeadingAnchor`，断言返回预期标题的源码行号。

## 已执行的验证

以下结果来自合并后审查，基准均为 `f9a6be16`。本轮未重新执行全仓 CI。上文各节的验收条件供修复后执行。

| 验证 | 实际结果 |
| --- | --- |
| [插件端口既有用例](../../../packages/editor/tests/plugins/ports-registration.test.ts) | 9/9 通过。旧句柄用例重新创建了插件对象，遗漏同一对象重复注册。 |
| [lint 引擎晚到既有用例](../../../packages/editor/tests/lint/engine-late-arrival.test.ts) | 3/3 通过。覆盖缺引擎开启、注入后产出诊断、同引擎重复注入。 |
| [模块就绪既有用例](../../../packages/editor/tests/module-loader-pending-work.test.ts) | 3/3 通过。HTML 场景未断言最终投影内容。三份文件共 15/15 通过。 |
| 临时插件端口探针 | `add(p) → set([p])` 被接受。另一次执行 `add(p) → 释放 → add(p) → 再释放旧句柄` 后，第三次添加同一 ID 竟然成功，证实新注册已被旧句柄移除。 |
| 临时 lint 端口探针 | 注入引擎并启用后撤出引擎，抛出 ``Cannot enable markdown lint: no `markdownlint` engine was injected when the editor was created.`` |
| 临时 HTML 导出探针 | 两组输入的全部 ID 分别为 `[a, a-1, a-1]` 和 `[テスト手順, 手順, ガイド手順, 手順]`。 |
| TypeScript 严格编译 | 将官方 `lint` 直接赋给 `MarkdownLintEngine` 时出现 `TS2322`。首个明确差异是官方 `errorDetail: string \| null` 无法赋给编辑器的 `string \| undefined`。 |

三项临时 Vitest 探针均执行完毕并记录了上述异常行为，临时文件已移除。复跑三份仓库既有用例可在仓库根目录执行：

```sh
pnpm --filter @md-editor/editor exec vitest run \
  tests/plugins/ports-registration.test.ts \
  tests/lint/engine-late-arrival.test.ts \
  tests/module-loader-pending-work.test.ts
```
