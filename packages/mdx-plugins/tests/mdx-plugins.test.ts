import { describe, expect, it } from "vitest";
import { Callout, officialMdxComponents } from "../src";
import { calloutPlugin, officialMdxPlugins } from "../src/metadata.ts";

describe("@md-editor/mdx-plugins", () => {
  it("exports official plugin metadata for editor registration", () => {
    expect(officialMdxPlugins).toEqual([calloutPlugin]);
    expect(calloutPlugin).toMatchObject({
      id: "mdx.callout",
      component: {
        name: "Callout",
        packageName: "@md-editor/mdx-plugins",
      },
    });
    expect(calloutPlugin.insert?.createSnippet()).toBe(
      '<Callout type="info" title="提示">\n  内容\n</Callout>',
    );
  });

  it("exports React components for blog MDX renderers", () => {
    expect(officialMdxComponents.Callout).toBe(Callout);
  });
});
