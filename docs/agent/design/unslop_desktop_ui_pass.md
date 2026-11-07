# 桌面端界面去 AI 味整理记录（unslop pass）

用途：记录一次按 unslop 清单对桌面端与 `editor-ui` 做的界面整理，包含判定、改动范围和后续约束。改动界面样式前可对照本文，避免把已清理的做法改回去。

- 状态：已完成（分支 `refactor/unslop-desktop-ui`）
- 判定：轻度问题，沿用现有品牌与 `--theme-*` 变量，不重做视觉方向

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

## 已知遗留

- `CodeMirrorEditor.css` 约 2000 行，本次只核对了过渡曲线，没有逐条审查。
- 设置对话框、版本历史和 AI 面板没有逐屏截图对比，只做了代码层面的规则检查。
- 命令面板 e2e `E02` 的断言依赖按钮文本包含命令 id，已改为匹配本地化标题。
