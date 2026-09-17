# @md-editor/shared

Inkpoint 跨包通用的基础工具函数库与全局核心类型定义。为所有上层 packages 与 apps 提供零外部重型依赖的纯工具集合。

---

## 1. 核心导出

- **函数式错误处理 (`Result<T, E>`)**：提供无异常抛出风味的 `ok(value)` 与 `err(error, message)`，提升状态流转的严谨性；
- **文本标准化 (`normalizeLineEndings`)**：统一跨平台换行符（`\r\n` ⇄ `\n`）；
- **官方全域常量**：集中收敛官方站点域名（`OFFICIAL_SITE_DOMAIN`）与资源基地址。

---

## 2. 主要 API 与使用

```typescript
import { ok, err, type Result, normalizeLineEndings } from "@md-editor/shared";

function parseDocument(raw: string): Result<string, "EMPTY_DOC"> {
  const normalized = normalizeLineEndings(raw).trim();
  if (!normalized) {
    return err("EMPTY_DOC", "文档内容为空");
  }
  return ok(normalized);
}
```

---

## 3. 开发与测试

```bash
pnpm test
pnpm typecheck
```
