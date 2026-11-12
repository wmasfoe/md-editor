# @md-editor/plugin-host

Runtime helpers for validating and hosting Inkpoint plugins. Plugin authors can
use `@md-editor/plugin-sdk` for the plugin contract; applications use this package
to manage plugins and their contributions.

```bash
npm install @md-editor/plugin-host
```

## Validate a catalog

`validateCatalog` checks an unknown value and returns a typed catalog. It throws
if the value has an invalid schema, duplicate entries or exceeds the size limit.

```ts
import { validateCatalog } from "@md-editor/plugin-host";

const catalog = validateCatalog({ schemaVersion: 1, plugins: [] });
console.log(catalog.plugins);
```

## Entry points

The package ships ESM and TypeScript declarations:

- `@md-editor/plugin-host`: plugin host and package/catalog validation.
- `@md-editor/plugin-host/mdx`: MDX component metadata registry.
- `@md-editor/plugin-host/github`: GitHub release catalog and plugin fetching.

See the [plugin SDK](https://github.com/wmasfoe/md-editor/tree/main/packages/plugin-sdk)
for plugin contracts and authoring guidance. Hosts provide the editor and runtime
services required by their plugins.
