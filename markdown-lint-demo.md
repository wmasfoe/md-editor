# Markdown Lint 测试示例文档

这是第一段说明文字。下面我们故意制造几种常见的 Markdown 规范与格式问题。

### 跳级标题（触发 MD001: heading-increment）
上一级是一级标题 `#`，这里直接跳到了三级标题 `###`，中间缺少二级标题。

# 第二个一级标题（触发 MD025: single-title）
一个标准文档通常只推荐拥有一个一级主标题。

#   标题与井号之间有多个空格（触发 MD019: no-multiple-space-atx）

#没有空格的标题（触发 MD018: no-missing-space-atx）

## 列表与规范

- 项目 1
- 项目 2



上面有多个多余连续空行（触发 MD012: no-multiple-blanks）。

## 重复小节标题（触发 MD024: no-duplicate-heading）
本小节内容。

## 重复小节标题（触发 MD024: no-duplicate-heading）
重复标题在生成目录或锚点跳转时容易造成歧义。

## 代码与链接格式

```
// 没有指定语言标识符的代码块（触发 MD040: fenced-code-language）
console.log("hello world");
```

空链接测试：[点击这里查看空链接]()（触发 MD042: no-empty-links）

裸露 URL 测试：https://github.com/wmasfoe/md-editor（触发 MD034: no-bare-urls，建议使用 `<https://...>` 或超链接语法）

失效相对文件链接（保存文档或按 Cmd+K 检查时触发）：[不存在的文件](./not-exist-doc.md)

失效锚点链接（保存文档或按 Cmd+K 检查时触发）：[不存在的锚点](#unknown-section)
