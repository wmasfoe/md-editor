import {
  inspectRendererForTesting,
  installCodeBlockLineNumberGeometryFixture,
} from "@md-editor/editor/testing";
import { getRendererForTesting, type CodeMirrorEditorPorts } from "@md-editor/editor";

export function inspectCodeMirrorEditorForTesting(ports: CodeMirrorEditorPorts) {
  return inspectRendererForTesting(getRendererForTesting(ports));
}

export type { RendererTestingProbe as CodeMirrorEditorTestingProbe } from "@md-editor/editor/testing";
export { installCodeBlockLineNumberGeometryFixture };
