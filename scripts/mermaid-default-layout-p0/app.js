import mermaid from "mermaid";
import { MermaidWysiwygEditor } from "@visimer/core";
import { MermaidCanvasView } from "@visimer/dom";

mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
const samples = {
  flow: "flowchart TD\n  %% keep this comment\n  A[Same]\n  B[Same]\n  A -->|first| B\n  A -->|second| B\n  classDef custom fill:#eef,stroke:#334155",
  seq: "sequenceDiagram\n  participant Alice\n  participant Bob\n  Alice->>Bob: identical\n  Alice->>Bob: identical\n  Bob-->>Alice: reply\n  %% keep tail",
};
const make = (id, code) => {
  const editor = new MermaidWysiwygEditor({ code });
  const container = document.querySelector(`#${id}`);
  const view = new MermaidCanvasView({ editor, container, mermaid, panZoom: true });
  view.on("render", ({ ok }) => {
    if (ok) requestAnimationFrame(() => view.fitView());
  });
  return { editor, view, container };
};
const flow = make("flow", samples.flow);
const seq = make("seq", samples.seq);
const duplicateAlias = make(
  "duplicate-alias",
  "sequenceDiagram\n  participant A as Same\n  participant B as Same\n  A->>B: target only",
);
const emptyFlow = make("empty-flow", "flowchart TD");
const emptySeq = make("empty-seq", "sequenceDiagram");

const mutationBlockReason = (editor, parseError) => {
  if (parseError) return "Mermaid source is invalid; use source editing";
  if (
    editor.result.flowchart?.nodes.some(
      (node) => node.refs.filter((ref) => ref.ref.labelSpan).length > 1,
    )
  ) {
    return "Repeated primary declarations are ambiguous; use source editing";
  }
  if (editor.result.flowchart?.subgraphs?.length)
    return "Subgraphs are not in the safe-edit capability set";
  if (
    editor.result.sequence &&
    /^\s*(?:loop|alt|par|critical|opt|break|end)\b/m.test(editor.code)
  ) {
    return "Sequence fragments are not in the safe-edit capability set";
  }
  if (!editor.result.flowchart && !editor.result.sequence)
    return "This diagram type has no graphical editing capability";
  return null;
};

// The finite probe toolbar calls only the pinned public semantic operations.
const button = (label, action) => {
  const el = document.createElement("button");
  el.textContent = label;
  el.addEventListener("click", action);
  return el;
};
const addToolbar = (target, entries) => {
  const bar = document.createElement("nav");
  bar.setAttribute("aria-label", `${target.container.id} probe controls`);
  bar.style.cssText =
    "position:absolute;inset:0 auto auto 0;z-index:50;background:white;padding:4px;display:flex;gap:4px;flex-wrap:wrap;max-width:100%";
  for (const [label, action, canRun] of entries) {
    const control = button(label, action);
    bar.append(control);
    if (canRun) {
      const status = document.createElement("output");
      status.setAttribute("aria-live", "polite");
      status.dataset.reasonFor = label;
      bar.append(status);
      const refresh = () => {
        const reason = canRun();
        control.disabled = Boolean(reason);
        control.title = reason ?? "";
        status.textContent = reason ?? "";
      };
      target.editor.on("selectionChange", refresh);
      refresh();
    }
  }
  target.container.prepend(bar);
  return bar;
};
const selectedId = (target, prefix) => target.editor.selection.find((id) => id.startsWith(prefix));
const connectedFlowNode = (target, id) =>
  target.editor.result.flowchart.edges.some((edge) => edge.source === id || edge.target === id);
addToolbar(flow, [
  [
    "rename selected node",
    () => {
      const id = selectedId(flow, "node:");
      if (!id) return;
      flow.editor.dispatch({ type: "renameNode", id: id.slice(5), label: "Changed" });
    },
  ],
  [
    "rename selected edge",
    () => {
      const id = selectedId(flow, "edge:");
      if (id) flow.editor.dispatch({ type: "setEdgeLabel", edgeId: id, label: "changed relation" });
    },
  ],
  [
    "delete selected node",
    () => {
      const id = selectedId(flow, "node:");
      if (!id) return;
      if (connectedFlowNode(flow, id.slice(5))) return;
      flow.editor.dispatch({ type: "deleteNode", id: id.slice(5) });
    },
    () => {
      const id = selectedId(flow, "node:");
      return id && connectedFlowNode(flow, id.slice(5)) ? "Delete connected edges first" : null;
    },
  ],
  [
    "delete selected edge",
    () => {
      const id = selectedId(flow, "edge:");
      if (id) flow.editor.dispatch({ type: "deleteEdge", edgeId: id });
    },
  ],
]);
addToolbar(seq, [
  [
    "rename selected participant",
    () => {
      const id = selectedId(seq, "participant:");
      if (id)
        seq.editor.dispatch({ type: "seq.renameParticipant", id: id.slice(12), name: "Renamed" });
    },
  ],
  [
    "delete selected participant",
    () => {
      const id = selectedId(seq, "participant:");
      if (!id) return;
      const p = seq.editor.result.sequence.participantById.get(id.slice(12));
      if (
        p?.refs?.length ||
        seq.editor.result.sequence.events.some(
          (event) =>
            event.kind === "message" && (event.stmt.source === p.id || event.stmt.target === p.id),
        )
      )
        return;
      seq.editor.dispatch({ type: "seq.deleteParticipant", id: p.id });
    },
    () => {
      const id = selectedId(seq, "participant:");
      const p = id && seq.editor.result.sequence.participantById.get(id.slice(12));
      return p &&
        seq.editor.result.sequence.events.some(
          (event) =>
            event.kind === "message" && (event.stmt.source === p.id || event.stmt.target === p.id),
        )
        ? "Delete messages first"
        : null;
    },
  ],
  [
    "rename selected participant to existing ID",
    () => {
      const id = selectedId(seq, "participant:");
      if (!id) return;
      const person = seq.editor.result.sequence.participantById.get(id.slice(12));
      const target = "Bob";
      if (
        !person?.decl?.alias &&
        seq.editor.result.sequence.participantById.has(target) &&
        target !== person.id
      )
        return;
      seq.editor.dispatch({ type: "seq.renameParticipant", id: person.id, name: target });
    },
    () => {
      const id = selectedId(seq, "participant:");
      const person = id && seq.editor.result.sequence.participantById.get(id.slice(12));
      return person &&
        !person.decl?.alias &&
        person.id !== "Bob" &&
        seq.editor.result.sequence.participantById.has("Bob")
        ? "That ID already belongs to another participant"
        : null;
    },
  ],
  [
    "rename selected message",
    () => {
      const id = selectedId(seq, "event:");
      if (id) seq.editor.dispatch({ type: "seq.setEventText", eventId: id, text: "changed" });
    },
  ],
  [
    "delete selected message",
    () => {
      const id = selectedId(seq, "event:");
      if (id) seq.editor.dispatch({ type: "seq.deleteEvent", eventId: id });
    },
  ],
]);
addToolbar(duplicateAlias, [
  [
    "rename selected duplicate-alias participant",
    () => {
      const id = selectedId(duplicateAlias, "participant:");
      if (id)
        duplicateAlias.editor.dispatch({
          type: "seq.renameParticipant",
          id: id.slice(12),
          name: "Unique",
        });
    },
  ],
]);
addToolbar(emptyFlow, [
  ["add node A", () => emptyFlow.editor.dispatch({ type: "addNode", id: "A", label: "开始" })],
  ["add node B", () => emptyFlow.editor.dispatch({ type: "addNode", id: "B", label: "结束" })],
  [
    "connect A to B",
    () => emptyFlow.editor.dispatch({ type: "connect", source: "A", target: "B", label: "继续" }),
  ],
]);
addToolbar(emptySeq, [
  [
    "add participant Alice",
    () => emptySeq.editor.dispatch({ type: "seq.addParticipant", name: "Alice" }),
  ],
  [
    "add participant Bob",
    () => emptySeq.editor.dispatch({ type: "seq.addParticipant", name: "Bob" }),
  ],
  [
    "add request",
    () =>
      emptySeq.editor.dispatch({
        type: "seq.addMessage",
        source: "Alice",
        target: "Bob",
        text: "request",
      }),
  ],
  [
    "add return",
    () =>
      emptySeq.editor.dispatch({
        type: "seq.addMessage",
        source: "Bob",
        target: "Alice",
        op: "-->>",
        text: "response",
      }),
  ],
]);
window.probe = {
  samples,
  flow,
  seq,
  duplicateAlias,
  emptyFlow,
  emptySeq,
  mermaid,
  MermaidWysiwygEditor,
  mutationBlockReason,
};
