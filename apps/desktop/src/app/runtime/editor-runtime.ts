import {
  createBuiltInEditorFeature,
  createAiWritingFeature,
  createDocumentState,
  createEditorRuntime,
  createFeatureRegistry,
  createMarkdownFormatFeature,
} from "@md-editor/editor-core";
import { createBuiltInMdxRegistry } from "@md-editor/mdx-component-registry";
import { officialMdxPlugins } from "@md-editor/mdx-plugins/metadata";

const featureRegistry = createFeatureRegistry();
featureRegistry.register(createBuiltInEditorFeature());
featureRegistry.register(createAiWritingFeature());
featureRegistry.register(createMarkdownFormatFeature());

// The desktop app owns one EditorRuntime for the whole window. React components
// subscribe to snapshots, while commands and file actions mutate this runtime.
export const runtime = createEditorRuntime({
  document: createDocumentState({
    markdown: "",
  }),
  mdxComponents: createBuiltInMdxRegistry(officialMdxPlugins),
  features: featureRegistry,
});
