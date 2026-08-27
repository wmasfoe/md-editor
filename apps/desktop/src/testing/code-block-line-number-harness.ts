import { installCodeBlockLineNumberGeometryFixture } from "@md-editor/editor-ui/CodeMirrorEditor/testing";

export function installCodeBlockLineNumberHarness(rootElement: HTMLElement): void {
  rootElement.style.width = "520px";
  rootElement.style.maxWidth = "100vw";
  rootElement.style.padding = "12px";
  rootElement.style.boxSizing = "border-box";
  installCodeBlockLineNumberGeometryFixture(rootElement);
}
