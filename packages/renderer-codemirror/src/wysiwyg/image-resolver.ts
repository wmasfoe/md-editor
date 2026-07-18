import { Facet, type EditorState, type Extension } from "@codemirror/state";

export interface ImagePreviewResolveInput {
  readonly source: string;
  readonly alt: string;
  readonly title: string | null;
}

export type ImagePreviewResolver = (input: ImagePreviewResolveInput) => string;

const imagePreviewResolverFacet = Facet.define<ImagePreviewResolver, ImagePreviewResolver>({
  combine(values) {
    return values.at(-1) ?? ((input) => input.source);
  },
});

export function provideImagePreviewResolver(resolver: ImagePreviewResolver): Extension {
  return imagePreviewResolverFacet.of(resolver);
}

export function resolveImagePreview(state: EditorState, input: ImagePreviewResolveInput): string {
  return state.facet(imagePreviewResolverFacet)(input);
}
