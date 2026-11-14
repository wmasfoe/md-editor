import mermaid from "mermaid";
import { MermaidWysiwygEditor } from "@visimer/core";
import { MermaidCanvasView } from "@visimer/dom";

mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
const samples = {
  flow: "flowchart TD\n  %% 保留注释\n  A[开始] -->|请求| B[处理]\n  B --> C[结束]\n  classDef custom fill:#eef,stroke:#334155",
  sequence:
    "sequenceDiagram\n  participant 客户端 as 用户\n  participant 服务端 as API\n  客户端->>服务端: 查询\n  服务端-->>客户端: 结果\n  客户端->>服务端: 查询",
  emptyFlow: "flowchart TD",
  emptySequence: "sequenceDiagram",
};
const editors = {};
const views = {};
for (const [key, selector, code] of [
  ["flow", "#flow", samples.flow],
  ["sequence", "#sequence", samples.sequence],
]) {
  const editor = new MermaidWysiwygEditor({ code });
  const view = new MermaidCanvasView({
    editor,
    container: document.querySelector(selector),
    mermaid,
    panZoom: true,
  });
  view.on("render", ({ ok }) => {
    if (ok) requestAnimationFrame(() => view.fitView());
  });
  editors[key] = editor;
  views[key] = view;
}
// Source-level creation checks are kept separate from DOM gesture evidence.
const emptyFlow = new MermaidWysiwygEditor({ code: samples.emptyFlow });
emptyFlow.dispatch({ type: "addNode", id: "A", label: "开始" });
emptyFlow.dispatch({ type: "addNode", id: "B", label: "结束" });
emptyFlow.dispatch({ type: "connect", source: "A", target: "B", label: "继续" });
const emptySequence = new MermaidWysiwygEditor({ code: samples.emptySequence });
emptySequence.dispatch({ type: "seq.addParticipant", name: "用户" });
emptySequence.dispatch({ type: "seq.addParticipant", name: "API" });
emptySequence.dispatch({ type: "seq.addMessage", source: "用户", target: "API", text: "请求" });
window.probeEmpty = { flow: emptyFlow, sequence: emptySequence };
window.probe = { samples, editors, views };
