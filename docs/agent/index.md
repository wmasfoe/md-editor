# Agent 文档目录

用途：作为 agent 文档的第一层导航。先从本页选择相关主题，再按需查看对应文档。

## 目录

- [架构](./architecture/index.md)：Rust workspace、GPUI 编辑器和仍适用的职责边界。
- [设计](./design/index.md)：产品视觉与交互设计原则。
- [产品](./product/index.md)：产品目标、需求与优先级。
- [规范](./specs/index.md)：编辑器行为契约和回归场景；旧实现专属规范会标明历史状态。
- [状态](./status/index.md)：Beta 编辑器当前状态和仍有效的技术记录。
- [发布](./release/index.md)：Rust beta 桌面应用构建与发布流程。
- [评审](./review/index.md)收录 Rust Beta 交互审计、历史体验问题和代码评审记录。

## 文档规则

- 本目录记录 agent 需要的项目背景、稳定约束和已知状态；面向维护者的说明放在 [`docs/human/`](../human/index.md)。
- 新增文档时同步更新对应子目录的 `index.md`，并在本页保持一层导航。
- 文档只描述经代码或流程验证的现状。方案、目标与历史记录应明确标注，不作为当前实现承诺。
- 当前 Rust workspace 结构与验证命令见[架构索引](./architecture/index.md)和[桌面开发说明](../../apps/desktop/README.md)。
