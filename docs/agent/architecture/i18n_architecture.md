# 国际化 (i18n) 架构与多语言扩展方案

用途：记录 `@md-editor/i18n` 架构设计、全应用多语言接入方案、类型安全契约以及未来添加新语言的扩展指南。

---

## 1. 架构定位与核心原则

为避免在各个 UI 组件或宿主壳层硬编码翻译或零散维护字典，Inkpoint 将所有国际化职责收敛至独立的 `@md-editor/i18n` 工作区包中（位于 `packages/i18n/`）：

1. **单一事实源与强类型约束**：
   - 中文字典（`zh.ts`）作为类型系统的基线 Schema，通过 `TranslationSchema` 递归约束所有语言（如 `en.ts`）必须具备 100% 的键路径对齐（Key Parity）；
   - 在编译期（TypeScript `pnpm typecheck`）与测试期（Vitest 单测遍历键路径）双重保障无遗漏或拼写错漏。
2. **零运行时重构的多语言扩展能力**：
   - 采用标准且成熟的开源方案（`i18next` + `react-i18next`）；
   - 支持参数插值（例如 `{{count}} 词` / `{{count}} words`、`{{version}}` 等）；
   - 支持三种语言模式：`"system"`（跟随系统/浏览器偏好）、`"zh"`（简体中文）、`"en"`（English）；
   - 当需要接入日语、德语、繁体中文等新语言时，只需新增对应语言字典并注册，调用层代码无需任何架构调整。
3. **分层清晰与领域职责收敛**：
   - 翻译资源与初始化逻辑集中在 `@md-editor/i18n`；
   - 宿主壳层（Desktop 端与 Web 端）只负责在设置持久化中保存 `language`，并在挂载与变更时调用 `changeLanguage(settings.language)`；
   - 所有 UI 组件直接调用 `useTranslation()` Hook 或 `t()` 函数消费文案。

---

## 2. 模块结构 (`packages/i18n`)

```
packages/i18n/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts               # 公开导出 (t, useTranslation, changeLanguage, types 等)
│   ├── types.ts               # 语言类型、配置项与支持语言列表
│   ├── detect.ts              # 系统语言检测与解析算法
│   ├── i18n.ts                # i18next 实例配置与初始化
│   └── locales/
│       ├── zh.ts              # 简体中文字典与 TranslationSchema 类型定义
│       └── en.ts              # 英文字典（受 TranslationSchema 强类型约束）
└── tests/
    └── i18n.test.ts           # 键完整性校验、语言切换与参数插值单元测试
```

### 2.1 字典模块划分规范

字典按功能模块严格分类组织：
- `common`: 通用操作（保存、取消、确认、删除、复制等）；
- `sidebar`: 侧边栏与文件树头部；
- `settings`:
  - `general`: 语言、图片资源目录、版本检测与更新；
  - `appearance`: 亮暗主题、自定义 CSS、正文/代码字体、字号与行号；
  - `shortcuts`: 快捷键录制、恢复默认与键位列表；
  - `ai`: 云端 API 配置、本地模型下载与管理；
  - `plugins`: 内置插件开关（数学公式、Mermaid、容器指令等）；
  - `other`: 导出、重置与关于；
- `fileTree`: 文件树空状态、搜索提示、右键上下文菜单、错误提示；
- `editor`: 欢迎引导、大纲面板、文档状态栏、资源预览、窗口标题、词数统计；
- `commands`: 命名命令标题与分组映射；
- `commandPalette`: 命令面板占位符与快捷导航；
- `dialogs`: 未保存更改确认弹窗、删除确认弹窗；
- `toasts`: 保存成功/失败提示、AI 状态与反馈；
- `loading`: 全局处理与各项文件/目录操作的进度提示；
- `web`: Web Playground 专属文案（大纲抽屉、模式切换、服务商预设等）。

---

## 3. Desktop 端与原生菜单集成

### 3.1 Tauri Rust 后端原生菜单本地化

- 在 `apps/desktop/src-tauri/src/settings.rs` 中，`AppSettings` 包含 `pub(crate) language: Option<String>`；
- 在 `apps/desktop/src-tauri/src/app_menu.rs` 与 `recent_files.rs` 中，macOS 顶栏原生菜单（"文件"/"File"、"编辑"/"Edit"、"视图"/"View"、"设置"/"Settings" 等）以及最近文件子菜单根据当前激活的语言动态构建；
- 当用户在设置面板更改语言并保存时，Tauri 会重新持久化并同步语言状态。

### 3.2 Desktop React 状态与设置联动

- `apps/desktop/src/app/settings/app-settings.ts`：定义 `language: LanguageSetting`，默认值为 `"system"`；
- `apps/desktop/src/app/settings-context.tsx`：通过 `useEffect` 监听 `settings.language`，并实时调用 `changeLanguage(settings.language)`；
- `apps/desktop/src/components/settings/OtherSettingsPanel.tsx`：提供语言下拉选择器（"跟随系统"、"简体中文"、"English"）。

---

## 4. Web 端集成 (`apps/web`)

- `apps/web/src/lib/web-settings.ts`：持久化 `language: LanguageSetting` 到 `localStorage`；
- `apps/web/src/App.tsx`：监听 `settings.language` 并触发 `changeLanguage`，将所有 Toast 提示通过 `t("toasts.*")` 本地化；
- `apps/web/src/components/WebSettingsDialog.tsx`：提供快捷键指南、AI 配置、外观与语言设置面板；
- `apps/web/src/components/WebHeader.tsx` 与 `WebOutlineDrawer.tsx`：大纲抽屉、切换明暗模式等控件均使用 `useTranslation()`。

---

## 5. 如何添加新的语言（以日文 `ja` 为例）

1. **定义语言代码**：
   在 `packages/i18n/src/types.ts` 中，扩展 `Locale` 与 `SUPPORTED_LOCALES`：
   ```ts
   export type Locale = "zh" | "en" | "ja";
   export const SUPPORTED_LOCALES: readonly Locale[] = ["zh", "en", "ja"] as const;
   ```
2. **新增语言字典**：
   创建 `packages/i18n/src/locales/ja.ts`：
   ```ts
   import type { TranslationSchema } from "./zh";
   export const ja: TranslationSchema = {
     // 完整填入所有对应翻译，编译器会自动提示缺失的键
   };
   ```
3. **注册资源**：
   在 `packages/i18n/src/i18n.ts` 的 `resources` 中引入并注册 `ja`。
4. **检测匹配**：
   在 `packages/i18n/src/detect.ts` 中添加对 `ja` 前缀的识别。
5. **UI 选项补充**：
   在 `zh.ts` 和 `en.ts` 的 `settings.general.languageJa` 中填入名称（如 `"日本語"`），并在设置面板的下拉菜单中增加选项。
6. **自动化验证**：
   运行 `pnpm --filter @md-editor/i18n test`，单测会自动确保 `ja` 与 `zh` 保持 100% 键对齐。
