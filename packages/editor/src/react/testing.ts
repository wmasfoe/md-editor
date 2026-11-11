import {
  inspectRendererForTesting,
  installCodeBlockLineNumberGeometryFixture,
} from "../testing.ts";
import { getRendererForTesting, type CodeMirrorEditorPorts } from "../bridge.ts";

export function inspectCodeMirrorEditorForTesting(ports: CodeMirrorEditorPorts) {
  return inspectRendererForTesting(getRendererForTesting(ports));
}

export type { RendererTestingProbe as CodeMirrorEditorTestingProbe } from "../testing.ts";
export { installCodeBlockLineNumberGeometryFixture };
