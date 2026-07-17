import { inspectRendererForTesting } from "@md-editor/renderer-codemirror/testing";
import { getRendererForTesting, type CodeMirrorEditorPorts } from "./bridge";

export function inspectCodeMirrorEditorForTesting(ports: CodeMirrorEditorPorts) {
  return inspectRendererForTesting(getRendererForTesting(ports));
}

export type { RendererTestingProbe as CodeMirrorEditorTestingProbe } from "@md-editor/renderer-codemirror/testing";
