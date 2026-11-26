# 设计文档目录

用途：记录产品设计原则与交互建议。部分文档基于旧 WebView / React 界面形成；这些记录可作设计背景，不能作为当前 GPUI 界面的实现说明。

## 文档

- [设计原则与产品界面基线](./DESIGN.md)：产品目标、信息层级、写作优先和交互原则。旧界面实现现状已失效。
- [桌面界面整理记录](./unslop_desktop_ui_pass.md)：历史界面评审记录，GPUI 迁移后需重新核验具体控件与样式。
- [表格交互评审](./table_interaction_review.md)：表格交互问题与建议；以当前 Rust 编辑器为准验证行为。
- [Liquid Glass 视觉方案](./liquid_glass_design_specifications.md)：视觉参考与设计提案，不代表所有控件已接入。
- [本地 AI 建议交互方案](./ai_suggestion_ambient_style_spec.md)：历史 AI 建议视觉方案，当前 Beta 能力以 Rust 桌面代码为准。
- [FoldingMirror 主题与动效方案](./foldingmirror_theme_and_motion_system.md)：主题与动效设计记录。

## 使用规则

- 将以上文档视作设计背景或提案。实现当前功能前，先检查 GPUI 代码和实际窗口状态。
- 不要根据旧 Web、站点、uTools 或 CodeMirror 截图推断当前桌面 UI 已实现相同布局。
