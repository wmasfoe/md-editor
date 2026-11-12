# @md-editor/shared

Small utilities and types used by the other Inkpoint packages. It has no runtime dependencies.

## Install

```bash
npm install @md-editor/shared
```

## Exports

- `Result<T, E>`, `ok(value)` and `err(error, message)`: return an error as a value instead of throwing.
- `normalizeLineEndings(text)`: converts `\r\n` to `\n`.
- `OFFICIAL_SITE_DOMAIN` and the other shared site constants.

## Usage

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

## Development

```bash
pnpm test
pnpm typecheck
```
