# @md-editor/mdx-component-registry

MDX 交互组件协议规范与运行时元数据注册表。负责为 Inkpoint 提供标准化的 MDX 组件声明、属性模式（Prop Schema）校验及代码片段插入协议。

---

## 1. 架构定位

- **纯静态元数据管理**：本子包**只登记静态 Metadata，不引入或执行任何真实的 React 组件代码**，实现完全 Headless 设计。
- **与组件实现解耦**：真实的 React 组件由 `@md-editor/mdx-plugins` 或第三方业务插件导出，本包只提供契约定义与注册表容器。
- **驱动编辑器交互**：为斜杠命令（`/`）、组件自动补全及属性检查提供统一的数据源支持。

---

## 2. 核心协议模型

### 2.1 属性描述符 (`MdxPropDescriptor`)
支持声明属性类型（`string`、`number`、`boolean`、`enum`、`markdown`）、必填状态及枚举可用值集合。

### 2.2 组件描述符 (`MdxComponentDescriptor`)
- `name`: JSX 标签名称（如 `Alert`、`Tabs`）。
- `displayName`: 界面展示的人类可读名称。
- `props`: 属性约束列表。
- `acceptsChildren`: 是否支持子节点与嵌套正文。
- `version`: 协议版本。

### 2.3 插入定义 (`MdxInsertDefinition`)
- `createSnippet()`: 生成标准 MDX 代码片段字符串；
- `keywords`: 搜索联想关键词；
- `group`: 组件面板分类。

---

## 3. 主要 API 与使用

```typescript
import {
  createMdxComponentRegistry,
  type MdxComponentPlugin,
} from "@md-editor/mdx-component-registry";

// 创建注册表实例
const registry = createMdxComponentRegistry();

// 注册自定义 MDX 组件契约
const customCardPlugin: MdxComponentPlugin = {
  id: "my-card",
  component: {
    name: "Card",
    displayName: "卡片组件",
    version: "1.0.0",
    acceptsChildren: true,
    props: [
      { name: "title", type: "string", required: true },
      { name: "variant", type: "enum", values: ["flat", "bordered"] },
    ],
  },
  insert: {
    label: "插入卡片",
    keywords: ["card", "kapian"],
    createSnippet: () => `<Card title="标题">\n  正文内容\n</Card>`,
  },
};

registry.register(customCardPlugin);

// 查询可插入的 MDX 组件列表
const insertables = registry.listInsertable();
```

---

## 4. 开发与测试

```bash
pnpm test
pnpm typecheck
```
