# @md-editor/i18n

Inkpoint 全局国际化多语言系统。基于 [i18next](https://www.i18next.com/) 与 [react-i18next](https://react.i18next.com/) 深度整合，为桌面端、Web 端、官网与插件提供类型安全的中英双语本地化支持。

---

## 1. 核心特性

- **严格的 TypeScript 类型推导**：通过 `i18next` 的模块声明增强（Declaration Augmentation），自动依据中文词典键值推导 `t('...')` 的参数类型与代码自动补全；
- **系统语言自适应**：支持跟随操作系统偏好（`auto`）或手动锁定（`zh-CN` / `en-US`）；
- **全环境通用**：既支持 React Hooks（`useTranslation`），也导出纯函数（`t`），可在无 React 上下文的纯逻辑与工具库中随时调用。

---

## 2. 词典结构与支持语言

- `zh`（简体中文，基准词典）位于 `src/locales/zh/`
- `en`（英文对照词典）位于 `src/locales/en/`

涵盖模块：
- `common`: 通用按钮、确认框、状态文字
- `menu`: 菜单项与系统快捷键说明
- `editor`: 编辑器模式、大纲、工具栏及斜杠菜单
- `settings`: 设置面板、AI 配置项、本地存储与关于页面
- `status`: 底部状态栏字符数统计与保存指示器

---

## 3. 主要 API 与使用

### 在 React 组件中使用
```tsx
import React from "react";
import { useTranslation } from "@md-editor/i18n";

export function StatusBar() {
  const { t } = useTranslation();
  return <div>{t("status.saved")}</div>;
}
```

### 在纯 TypeScript 逻辑中使用
```typescript
import { t, changeLanguage } from "@md-editor/i18n";

// 直接获取国际化文案
const alertText = t("common.confirm");

// 动态切换语言
await changeLanguage("en-US");
```

---

## 4. 开发与测试

```bash
pnpm test
pnpm typecheck
```
