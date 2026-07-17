# v0.1 打磨改进记录

记录日期：2026-06-18

> 状态：迁移前实现记录。本文中的已完成项和当时验证命令保留为事实；Milkdown 专用快捷键和实现说明不再作为 CM6 后续设计依据。

本轮打磨完成了三个 v0.1 优化功能：

## 1. 扩展代码块语言覆盖 ✅

### 新增语言支持

在 `packages/editor-ui/src/utils/code-highlight.ts` 中添加了以下语言的关键字高亮：

- **Python**: def, class, async, await, import, from, if, for, while 等
- **Rust**: fn, let, mut, impl, trait, struct, enum, match 等
- **Java**: class, public, private, static, void, new, extends 等
- **C++**: class, template, namespace, virtual, const, auto 等
- **PHP**: function, class, public, private, echo, require 等
- **SQL**: SELECT, FROM, WHERE, JOIN, INSERT, UPDATE, DELETE 等
- **GraphQL**: type, query, mutation, fragment, interface 等
- **Dockerfile**: FROM, RUN, COPY, CMD, ENTRYPOINT, EXPOSE 等
- **Nginx**: server, location, proxy_pass, listen, root 等

### 语言别名映射

添加了常见语言别名支持：
- `py` → `python`
- `rs` → `rust`
- `cpp`, `c++`, `cc` → `cpp`
- `docker` → `dockerfile`
- `gql` → `graphql`

### 测试覆盖

在 `packages/editor-ui/src/tests/code-highlight.test.ts` 中添加了新语言的测试用例：
- Python 关键字识别
- Rust fn/let 关键字
- SQL 大小写不敏感关键字
- Dockerfile 大写命令关键字

所有测试通过 ✓

---

## 2. 键盘快捷键优化 ✅

### 快捷键现状说明

**重要发现：** Milkdown 的 commonmark 和 gfm presets 已经内置了大部分 Markdown 格式化快捷键，这些快捷键一直在正常工作：

#### Milkdown 内置快捷键（已可用）
- `Cmd+B` - 加粗
- `Cmd+I` - 斜体
- `Cmd+K` - 插入链接
- `Cmd+Shift+X` - 删除线
- `Cmd+\`` - 行内代码
- `Cmd+Shift+8` - 无序列表
- `Cmd+Shift+7` - 有序列表
- `Cmd+Shift+.` - 引用块
- `Cmd+Alt+1/2/3/4/5/6` - 标题

### 新增 Markdown 格式化命令框架

虽然快捷键已经内置，我们仍然创建了命令框架，为未来扩展做准备：

在 `packages/editor-core/src/markdown-format-commands.ts` 中创建了新的 feature，包含以下命令：

#### 文本格式化
- `format.bold` - 加粗 (`Cmd+B`) - 由 Milkdown 处理
- `format.italic` - 斜体 (`Cmd+I`) - 由 Milkdown 处理
- `format.code` - 行内代码 (`Cmd+E`) - 需要改为 `Cmd+\``
- `format.strikethrough` - 删除线 (`Cmd+Shift+X`) - 由 Milkdown 处理

#### 插入元素
- `format.link` - 插入链接 (`Cmd+K`) - 由 Milkdown 处理
- `format.codeBlock` - 插入代码块 (`Cmd+Shift+C`) - 可以自定义实现
- `format.blockquote` - 插入引用块 (`Cmd+Shift+.`) - 由 Milkdown 处理
- `format.bulletList` - 插入无序列表 (`Cmd+Shift+8`) - 由 Milkdown 处理
- `format.orderedList` - 插入有序列表 (`Cmd+Shift+7`) - 由 Milkdown 处理

#### 标题
- `format.heading1/2/3` - 标题 (`Cmd+Alt+1/2/3`) - 由 Milkdown 处理

### Feature 激活

在 `apps/desktop/src/app/editor-runtime.ts` 中注册了 `createMarkdownFormatFeature()`。

### 技术说明

Milkdown 在 ProseMirror 层处理快捷键，这些快捷键不会冒泡到我们的 window.addEventListener。这是正常行为，因为：

1. Milkdown 的快捷键优先级更高（在编辑器内部处理）
2. 它们直接操作 ProseMirror 状态，性能更好
3. 我们的命令框架保留用于：
   - 未来自定义快捷键
   - 菜单项触发的命令
   - 扩展 Milkdown 未提供的功能

### 后续工作

1. **移除重复的快捷键注册**：某些快捷键（如 Cmd+B, Cmd+I）已由 Milkdown 处理，无需重复注册
2. **自定义命令实现**：实现 Milkdown 未提供的功能（如自定义代码块插入）
3. **快捷键帮助面板**：创建帮助面板展示所有可用快捷键

---

## 3. 最近文件功能 ✅

### 数据层

在 `packages/editor-core/src/recent-files.ts` 中实现了最近文件存储：

#### RecentFilesStore API
- `add(file)` - 添加文件到最近列表（自动移到顶部）
- `remove(path)` - 从列表中移除文件
- `list()` - 获取最近文件列表
- `clear()` - 清空列表

#### 特性
- 最多保存 10 个最近文件
- 使用 localStorage 持久化
- 重复打开的文件会移到列表顶部
- 记录最后打开时间戳

### 集成到桌面应用

在 `apps/desktop/src/app/useDesktopEditorController.ts` 中：

1. **自动记录**：`replaceDocument()` 函数在打开文件时自动添加到最近列表
2. **打开最近文件**：`openRecentFile(path)` 方法支持从路径打开文件
3. **错误处理**：如果文件已被删除或移动，自动从最近列表中移除
4. **获取列表**：`getRecentFiles()` 方法返回最近文件列表供 UI 使用

### 测试覆盖

在 `packages/editor-core/tests/recent-files.test.ts` 中添加了完整测试：
- 添加文件到列表
- 重复文件移到顶部
- 限制最大数量
- 删除和清空功能
- 跨实例持久化

所有测试通过 ✓

### 后续 UI 工作

数据层和 API 已完成，需要在 UI 中添加：
- 菜单栏中显示"最近文件"子菜单
- 点击快速打开对应文件
- 显示相对时间（如"2小时前"）

---

## 验证状态

- ✅ 类型检查通过
- ✅ 所有单元测试通过
- ✅ 代码高亮新语言测试通过
- ✅ 最近文件存储测试通过

## 下一步建议

1. **快捷键命令实现**：将格式化命令连接到 Milkdown 的实际 API
2. **最近文件 UI**：在菜单栏或文件面板中添加最近文件入口
3. **快捷键帮助面板**：创建一个帮助面板显示所有可用快捷键
4. **代码块主题化**：基于当前高亮添加更多主题色彩变量
