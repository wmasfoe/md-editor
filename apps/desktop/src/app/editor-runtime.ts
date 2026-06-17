import {
  createBuiltInEditorFeature,
  createDocumentState,
  createEditorRuntime,
  createFeatureRegistry
} from "@md-editor/editor-core";
import { createBuiltInMdxRegistry } from "@md-editor/mdx-registry";

const featureRegistry = createFeatureRegistry();
featureRegistry.register(createBuiltInEditorFeature());

// The desktop app owns one EditorRuntime for the whole window. React components
// subscribe to snapshots, while commands and file actions mutate this runtime.
export const runtime = createEditorRuntime({
  document: createDocumentState({
    markdown: "# Untitled\n\nStart writing Markdown."
  }),
  mdxComponents: createBuiltInMdxRegistry(),
  features: featureRegistry
});
