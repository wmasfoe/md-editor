import type { MdxComponentPlugin } from "@md-editor/mdx-component-registry";

export const calloutPlugin: MdxComponentPlugin = {
  id: "mdx.callout",
  component: {
    name: "Callout",
    displayName: "Callout",
    importName: "Callout",
    packageName: "@md-editor/mdx-plugins",
    props: [
      {
        name: "type",
        type: "enum",
        required: false,
        values: ["info", "warning", "success", "danger"],
      },
      {
        name: "title",
        type: "string",
        required: false,
      },
    ],
    acceptsChildren: true,
    version: "0.1",
  },
  insert: {
    label: "Callout",
    description: "提示、警告或说明块",
    keywords: ["callout", "alert", "note", "tip", "warning"],
    group: "内容组件",
    createSnippet: () => '<Callout type="info" title="提示">\n  内容\n</Callout>',
  },
};
