# 界面去 AI 味整理记录（unslop pass）

用途：记录按 unslop 清单对桌面端、`editor-ui`、web、utools 和官网 site 做的界面整理，包含判定、改动范围和后续约束。改动界面样式前可对照本文，避免把已清理的做法改回去。

- 状态：已完成（分支 `refactor/unslop-desktop-ui`）
- 判定：轻度问题，沿用现有品牌与 `--theme-*` 变量，不重做视觉方向
- 范围：`apps/desktop`、`packages/editor-ui`、`apps/web`、`apps/utools`、`apps/site`（mobile 为原生代码，tui 无源码，未处理）

## 已落地的规则

| 方面 | 规则 |
| --- | --- |
| 图标 | 界面中不使用 emoji 或 `✓ ✗ ✕` 字符，统一用 `@heroicons/react/24/outline` 线性图标，16px |
| 快捷键 | 用 keycap 展示，通过 `editor-ui` 的 `formatKeymapParts` 渲染；不得在界面显示内部命令 id，也不得硬编码快捷键文本 |
| 文案 | 分组标题、区块标题使用句首大写，不用 `uppercase` 加字距；命令分组必须在 i18n `commands.groups` 中有对应 key |
| 字重 | 只用 400 和 500；选中态只用底色加指示条，不再叠加字重和阴影 |
| 动效 | 不用 `transition-all`，写明具体属性；按下反馈保留 `active:scale-*` |
| 遮罩与浮层 | 不使用 `backdrop-blur`；阴影统一走 `--theme-shadow`，开关滑块等功能性小阴影除外 |
| 间距 | 高度、间距落在 4px 阶梯；文件树行高 32px，行间距 2px |
| 圆角 | 控件 8px（`rounded-lg`），对话框和面板 12px（`rounded-xl`），8px 菜单内的菜单项 4px |
| 颜色 | 不使用未定义的 token（如 `--theme-foreground`、`--theme-hover`）；强调按钮使用 `--theme-primary-fill`，错误色使用 `--theme-danger-*` |
| 欢迎页 | 只保留「新建文档」一个主操作，打开文件和打开文件夹为文字按钮 |
| 插件卡片 | 内置插件与外部插件统一用 `editor-ui/settings` 的 `PluginCard` + `PluginToggle`（开关为 `SettingsSwitch`）；卡片内次要操作用 `settingsTextButtonClassName`，移除用 `settingsDangerTextButtonClassName`，错误提示用 `settingsErrorNoticeClassName`；不要在调用方手写卡片外框或原生 checkbox 开关 |

## 已知遗留

- `CodeMirrorEditor.css` 约 2000 行，本次只核对了过渡曲线，没有逐条审查。
- 设置对话框、版本历史和 AI 面板没有逐屏截图对比，只做了代码层面的规则检查。
- 命令面板 e2e `E02` 的断言依赖按钮文本包含命令 id，已改为匹配本地化标题。

## 各端补充

| 端 | 处理 | 保留 |
| --- | --- | --- |
| web | 标题栏、侧栏文案改走 `web.header.*` i18n（四种语言同步）；示例文档去掉 emoji、感叹号和「丝滑」类词，表格状态列改为「可用」；去掉 AI 续写图标的 `animate-pulse` | 示例文档的结构与 Callout 演示不变 |
| utools | `⚠️ 💡` 换成 `Icons.tsx` 的线性图标；删除 `PRO` 徽标；横幅文案去掉「银行级」「0 延时」「隐私零外传」；`h-7`、`rounded-[6px]` 等同桌面端处理 | `ai-disclaimer.ts` 的免责声明条款原样保留（法律性文本，需单独确认后再改） |
| site | 悬浮卡片、示例文件列表、AI 区卡片的 emoji 换成 heroicons（数据层改用 `iconKey`，不引入 React）；去掉循环漂浮动画 `ink-float-*`、徽标圆点的 `animate-pulse` 和 `animate-ping`；药丸徽标改为句首大写；字重只用 400 和 500；i18n 去掉 `✨ 🎉 💡`、`seamless`、「行云流水」类词；三个悬浮卡片的结构保留 | 品牌词标 `inkpoint-wordmark.tsx` 的字重与字距、Liquid Glass 材质、背景径向光晕、扫光效果 |

## 已知遗留（补充）

- site 保留的玻璃与径向光晕与本文的「不用 backdrop-blur」规则不一致，属于官网品牌决定，见 `site_feature_sections_design_spec.md`。
- `apps/site/app/globals.css` 里 `liquid-glass-*` 的 `backdrop-filter` 未改。
- web 在 127.0.0.1 下加载 jsdelivr 上的霞鹜文楷字体返回 404（`lxgw-wenkai-webfont@1.1.0`），与本次改动无关，未处理。
