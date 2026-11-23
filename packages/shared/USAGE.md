# Using `@md-editor/shared`

Tiny utilities and types shared by the other Inkpoint packages: a `Result` shape, line-ending
normalization, and heading slugs. No runtime dependencies, safe everywhere (including the browser,
Node and tests).

- [Result](#result)
- [Line endings](#line-endings)
- [Heading slugs](#heading-slugs)
- [API map](#api-map)

## Result

A minimal discriminated union instead of exceptions at API boundaries.

<!-- readme-check -->
```ts
import { err, ok, type Result } from "@md-editor/shared";

function parse(value: string): Result<number, "not-a-number"> {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? ok(parsed) : err("not-a-number", `"${value}" is not a number`);
}

const result = parse("42");
if (result.ok) console.log(result.value);
else console.log(result.error, result.message);
```

`ResultOk<T>` carries `value`; `ResultErr<E>` carries `error` and `message`. Narrow with `if
(result.ok)` — the discriminant is `ok`, not `success`.

## Line endings

Markdown is stored with `\n` everywhere. Normalize at the boundary, not in the middle of your
pipeline:

<!-- readme-check -->
```ts
import { normalizeLineEndings } from "@md-editor/shared";

console.log(normalizeLineEndings("a\r\nb\rc")); // "a\nb\nc"
```

## Heading slugs

`@md-editor/markdown-fidelity` builds outlines from these; use them directly if you render your own
Markdown HTML and need anchors that match the editor.

<!-- readme-check -->
```ts
import { createHeadingSlugAllocator, EMPTY_HEADING_SLUG, headingSlugSource, slugifyHeading } from "@md-editor/shared";

const allocate = createHeadingSlugAllocator();

console.log(slugifyHeading("Hello, World!"), allocate(slugifyHeading("Hello, World!")));
console.log(headingSlugSource("### Details"), EMPTY_HEADING_SLUG);
```

The allocator keeps a `Set` per document, so repeats become `slug-1`, `slug-2`. Headings with no
letters or digits fall back to `EMPTY_HEADING_SLUG`.

## API map

| Export | Purpose |
| --- | --- |
| `ok`, `err` | Build a `Result`. |
| `Result`, `ResultOk`, `ResultErr` (types) | The union and its members. |
| `normalizeLineEndings` | `\r\n` / `\r` → `\n`. |
| `slugifyHeading`, `headingSlugSource`, `EMPTY_HEADING_SLUG` | Slug generation from heading text or Markdown source. |
| `createHeadingSlugAllocator` | Per-document de-duplication. |

`@md-editor/shared/mdx` holds MDX component registry types consumed by the editor and
`@md-editor/plugin-host/mdx`.

## Related packages

- [`@md-editor/markdown-fidelity`](../markdown-fidelity/USAGE.md) — headings, images, front matter.
- [`@md-editor/core`](../core/USAGE.md) — document state and the command runtime.
