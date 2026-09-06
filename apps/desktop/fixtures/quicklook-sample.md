# Inkpoint macOS Quick Look 测试文档

> 欢迎使用 **Inkpoint Quick Look**！在 macOS 访达中选中 Markdown 文件按下**空格键**即可秒级弹出此预览。

---

## 1. 基础排版与任务清单 (GFM)

这里是正文段落，支持 **加粗**、*斜体*、~~删除线~~ 以及 `行内代码`。

### 待办任务
- [x] macOS 现代 App Extension 架构支持
- [x] 100% 离线自包含 GFM 渲染引擎
- [x] 代码语法高亮与主题自适应
- [ ] 后续迭代（如数学公式与图表扩展）

---

## 2. 表格排版 (GFM Tables)

| 功能特性 | 支持状态 | 渲染延迟 | 说明 |
| :--- | :---: | :---: | :--- |
| **标准 GFM** | ✅ 完美支持 | < 10ms | 标题、段落、列表、表格、引用 |
| **代码高亮** | ✅ 完美支持 | < 20ms | 支持 TS、Rust、Python、Bash 等 |
| **外观自适应** | ✅ 完美支持 | 实时 | 跟随系统深色/浅色模式切换 |
| **安全沙盒** | ✅ 完美保障 | - | 100% 离线，无网络请求与脚本漏洞 |

---

## 3. 代码语法着色测试 (Syntax Highlighting)

### TypeScript
```typescript
interface DocumentPreview {
  id: string;
  title: string;
  wordCount: number;
  tags: string[];
}

export function generatePreview(doc: DocumentPreview): string {
  console.log(`Rendering preview for ${doc.title}...`);
  return `<article>${doc.title}</article>`;
}
```

### Rust
```rust
#[derive(Debug, Clone)]
pub struct QuickLookPreview {
    pub file_name: String,
    pub byte_size: usize,
}

impl QuickLookPreview {
    pub fn is_fast(&self) -> bool {
        self.byte_size < 2 * 1024 * 1024
    }
}
```

---

## 4. 引用与说明

> 💡 **提示**：本预览窗口完全基于 WebKit 离线沙盒运行。按 `Esc` 或再次点击空格键即可关闭预览窗口；点击右上角的按钮可以在 Inkpoint 中直接打开编辑。
