# @md-editor/mdx-plugins

Inkpoint 官方内置 MDX 交互组件库与对应元数据插件。包含面向 MDX 渲染与富文本排版的官方 React 组件实现（如 Callout 提示框等）。

---

## 1. 架构定位

- **标准 React 实现**：提供高质量、开箱即用且样式美观的官方交互式 MDX 组件；
- **自包含元数据**：每个内置组件均配对导出符合 `@md-editor/mdx-component-registry` 规范的插件元数据定义，支持直接向注册表注入；
- **全平台复用**：支持在桌面端、Web 端或静态构建环境中作为 MDX 渲染器的 component scope 注入。

---

## 2. 内置官方组件

### `Callout` 提示卡片
- **多色态支持 (`CalloutTone`)**：
  - `note` (中性/信息)
  - `tip` (成功/技巧)
  - `important` (核心/关注)
  - `warning` (警告/提醒)
  - `caution` (严重/危险)
- **自适应标题与图标**：支持自定义标题文本及内置标准 SVG 状态指示图标；
- **双色模式适配**：完美兼容明亮与暗黑主题。

---

## 3. 主要 API 与使用

```tsx
import React from "react";
import { Callout, officialMdxPlugins } from "@md-editor/mdx-plugins";
import { createMdxComponentRegistry } from "@md-editor/mdx-component-registry";

// 1. 批量向注册表注册官方 MDX 插件
const registry = createMdxComponentRegistry();
registry.registerMany(officialMdxPlugins);

// 2. 在 MDX 渲染中直接使用组件
export function Demo() {
  return (
    <Callout tone="tip" title="专业建议">
      使用快捷键 <code>Cmd + Shift + B</code> 可以快速折叠侧边栏！
    </Callout>
  );
}
```

---

## 4. 开发与测试

```bash
pnpm test
pnpm typecheck
```
