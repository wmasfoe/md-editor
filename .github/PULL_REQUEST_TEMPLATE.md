## 📌 变更概述 (Summary of Changes)

<!-- 请简要描述本次 PR 的核心变更内容与技术动机（Why & What） -->

## 🔗 关联 Issue (Related Issues)

<!-- 关联的 Issue 编号，例如：Fixes #47 或 Closes #12 -->
Fixes #

## 🏷️ 变更类型 (Type of Change)

- [ ] 🐛 Bug 修复 (Non-breaking bug fix)
- [ ] ✨ 新特性 (Non-breaking new feature)
- [ ] ⚡ 性能优化 (Performance improvement)
- [ ] ♻️ 代码重构 (Refactoring without behavior change)
- [ ] 📚 文档更新 (Documentation update)
- [ ] 💥 破坏性变更 (Breaking change)

## 🏛️ 架构边界自查 (Architecture Boundary Check)

<!-- 根据项目的架构能力边界设计原则进行自查 -->
- [ ] 遵循职责单一：核心模块提供基础能力，接入层仅作数据适配与调用
- [ ] 不在外部层硬算编辑器核心领域状态
- [ ] 语法或装饰扩展支持优雅降级

## 🧪 测试与验证 (Testing & Verification)

<!-- 说明如何验证本次变更，附上运行测试命令的输出或截图证据 -->
- [ ] 运行 `pnpm test` 通过所有单元测试
- [ ] 运行 `pnpm typecheck` 无类型错误
- [ ] 运行 `pnpm lint` 无代码风格问题
- [ ] （如涉及 UI/桌面端）进行了实际界面交互测试

## 📋 检查清单 (Checklist)

- [ ] 代码已添加必要的注释，关键逻辑易维护、易扩展
- [ ] 提交信息符合约定规范
- [ ] 如有新公开 API，已同步补充/更新对应文档
