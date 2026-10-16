# Agent 文档目录

用途：作为 agent 的第一层导航。只记录当前目录下有哪些文档集合；具体文档请进入对应子目录的 `index.md` 按需查找。

## 目录

- 产品需求、路线与竞品分析（如 VMark 等）： [product/index.md](./product/index.md)
- 设计规范： [design/index.md](./design/index.md)
- 技术架构、能力边界与方案（含 PR3 模块拆分与结构护栏）： [architecture/index.md](./architecture/index.md)
- 实现状态、迁移进度、Beta 缺口与阶段验证记录： [status/index.md](./status/index.md)
- 高风险问题规范（选区、IME、AI 修复预览等编辑器交互契约）： [specs/index.md](./specs/index.md)
- 发布与仓库流程： [release/index.md](./release/index.md)
- 评审、体验与问题审查记录： [review/index.md](./review/index.md)

## 文档分类判据

写新文档前先判断它属于哪一类，避免放错目录导致重复与漂移：

| 目录 | 判据（回答什么问题） | 典型内容 |
| --- | --- | --- |
| `architecture/` | **稳定的设计与契约来源**："系统为什么这样分层、边界在哪" | 能力边界、渲染器架构、结构/命名规范 |
| `specs/` | **高风险交互契约**："改这块代码前必须知道的不可变量" | 选区完整性、表格编辑生命周期、Inclusivity 契约 |
| `status/` | **进度快照**："现在做到哪、还缺什么" | 迁移进度、Beta 缺口、阶段验证记录 |
| `review/` | **审查与体检记录**："某次评审发现了什么" | UX 审查、问题清单 |
| `design/` | **视觉与交互语言**："长什么样、动效如何" | DESIGN.md、玻璃材质、动效系统 |
| `product/` | **需求与路线**："为什么做、优先做什么" | PRD、竞品分析、任务优先级 |
| `release/` | **发布与仓库流程**："怎么发、怎么回滚" | 发版流程、分发链路 |

若一份文档同时符合多类：**契约放 `specs/`、设计放 `architecture/`、进度放 `status/`**；同一事实只在一处定义，其他文档引用它。

## 使用规则

- 先读本文件判断方向，再读对应子目录的 `index.md`。
- 根目录索引只保留一层导航，不展开具体文档清单。
- 新增子目录时必须同步更新本文件。
- 及时更新对应的文档，文档和代码的状态要保持同步。
