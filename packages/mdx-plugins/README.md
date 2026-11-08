# @md-editor/mdx-plugins

The MDX components that ship with Inkpoint, plus the metadata the editor needs to list and insert them. Right now there is one component, `Callout`.

## Callout

```mdx
<Callout type="warning" title="Heads up">
  Back up the folder before you run the migration.
</Callout>
```

| Prop | Type | Default | Notes |
| :--- | :--- | :--- | :--- |
| `type` | `"info"`, `"warning"`, `"success"`, `"danger"` | `"info"` | Picks the color and the default title |
| `title` | `string` | the type name, for example `Info` | Shown in bold above the content |
| children | React nodes | none | The body of the callout |

The component renders an `<aside data-md-editor-callout="<type>">` with a bold title and the children. It carries no styles of its own, so the host page styles it through that attribute.

For `:::note` style blocks written without JSX, see the directive plugin in `@md-editor/syntax-plugins`.

## Registering it

Each component has a matching `MdxComponentPlugin` (the contract is in `@md-editor/plugin-sdk/mdx`) with its props, an insert snippet and search keywords. `officialMdxPlugins` lists them all.

```tsx
import { Callout, officialMdxPlugins } from "@md-editor/mdx-plugins";
import { createMdxComponentRegistry } from "@md-editor/plugin-host/mdx";

const registry = createMdxComponentRegistry();
registry.registerMany(officialMdxPlugins);

export function Demo() {
  return (
    <Callout type="success" title="Done">
      Saved to disk.
    </Callout>
  );
}
```

## Development

```bash
pnpm test
pnpm typecheck
```
