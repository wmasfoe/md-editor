import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
  useUpdateNodeInternals,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { graphlib, layout as dagreLayout } from "@dagrejs/dagre";
import { MermaidWysiwygEditor } from "@visimer/core";
import mermaid from "mermaid";
import "./style.css";

const h = React.createElement;
mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
const FLOW =
  "flowchart TD\n  %% 保留注释\n  A[开始] -->|请求| B[处理]\n  B --> C[结束]\n  classDef custom fill:#eef,stroke:#334155";
const SEQUENCE =
  "sequenceDiagram\n  participant 客户端 as 用户\n  participant 服务端 as API\n  客户端->>服务端: 查询\n  服务端-->>客户端: 结果\n  客户端->>服务端: 查询";
const EMPTY_FLOW = "flowchart TD";
const EMPTY_SEQUENCE = "sequenceDiagram";
const fresh = (type, source) =>
  new MermaidWysiwygEditor({ code: source ?? (type === "flow" ? FLOW : SEQUENCE) });
const layoutKey = (type) => `mermaid-p0:${type}`;
function readSaved(type) {
  const raw = localStorage.getItem(layoutKey(type));
  if (!raw) return { value: null, error: null };
  try {
    const value = JSON.parse(raw);
    if (
      value?.version !== 1 ||
      typeof value.source !== "string" ||
      !value.layout ||
      typeof value.layout !== "object" ||
      Array.isArray(value.layout)
    )
      throw new Error("Expected version 1 source and layout object");
    for (const [id, point] of Object.entries(value.layout)) {
      if (!id || !Number.isFinite(point?.x) || !Number.isFinite(point?.y))
        throw new Error(`Invalid position for ${id}`);
    }
    return { value, error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function FlowNode({ data, selected }) {
  return h(
    "div",
    { className: `diagram-node ${selected ? "selected" : ""}`, "data-node-id": data.id },
    h(Handle, { type: "target", position: Position.Top }),
    h("small", null, data.id),
    h("input", {
      "aria-label": `label-${data.id}`,
      value: data.label,
      onChange: (e) => data.rename(e.target.value),
    }),
    h(Handle, { type: "source", position: Position.Bottom }),
  );
}
function ParticipantNode({ data }) {
  const updateNodeInternals = useUpdateNodeInternals();
  const rowSignature = data.eventRows
    .map((row) => `${row.index}:${row.source}:${row.target}`)
    .join("|");
  useEffect(() => {
    updateNodeInternals(data.id);
  }, [data.id, rowSignature, updateNodeInternals]);
  return h(
    "div",
    {
      className: "participant-node",
      "data-participant-id": data.id,
      style: { height: Math.max(180, 90 + data.eventRows.length * 42) },
    },
    data.eventRows.map((row) =>
      row.target === data.id
        ? h(Handle, {
            key: `t-${row.index}`,
            className: "seq-event-handle",
            id: `target-${row.index}`,
            type: "target",
            position: Position.Left,
            style: { top: 65 + row.index * 42 },
          })
        : null,
    ),
    data.eventRows.map((row) =>
      row.source === data.id
        ? h(Handle, {
            key: `s-${row.index}`,
            className: "seq-event-handle",
            id: `source-${row.index}`,
            type: "source",
            position: Position.Right,
            style: { top: 65 + row.index * 42 },
          })
        : null,
    ),
    h(Handle, {
      id: "new-target",
      type: "target",
      position: Position.Left,
      style: { top: 11, zIndex: 2 },
    }),
    h(
      "div",
      { className: "participant-drag-area", "data-testid": "participant-drag-area" },
      data.id,
    ),
    h("input", {
      "aria-label": `participant-${data.id}`,
      value: data.label,
      onChange: (e) => data.rename(e.target.value),
    }),
    h("div", { className: "lifeline" }),
    h(Handle, {
      id: "new-source",
      type: "source",
      position: Position.Right,
      style: { top: 11, zIndex: 2 },
    }),
  );
}
const nodeTypes = { diagram: FlowNode, participant: ParticipantNode };

function getFlowGraph(editor) {
  return editor.result.flowchart;
}
function flowLayout(editor) {
  const graph = getFlowGraph(editor);
  const g = new graphlib.Graph()
    .setGraph({ rankdir: "TB", nodesep: 70, ranksep: 90 })
    .setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach((n) => g.setNode(n.id, { width: 150, height: 72 }));
  graph.edges.forEach((e) => g.setEdge(e.source, e.target));
  dagreLayout(g);
  return Object.fromEntries(
    graph.nodes.map((n) => {
      const p = g.node(n.id);
      return [n.id, { x: p.x - 75, y: p.y - 36 }];
    }),
  );
}
function initialLayout(editor, type) {
  const saved = readSaved(type);
  if (saved.value?.source === editor.code) return saved.value.layout;
  return type === "flow"
    ? flowLayout(editor)
    : Object.fromEntries(
        editor.result.sequence.participants.map((p, i) => [p.id, { x: 80 + i * 250, y: 70 }]),
      );
}
function unsupportedStatements(editor, type) {
  const graph = type === "flow" ? editor.result.flowchart : editor.result.sequence;
  if (!graph) return ["Mermaid syntax was not recognized by the editing core"];
  const supported =
    type === "flow" ? new Set(["chain", "classDef"]) : new Set(["participant", "message"]);
  return [...graph.statements.values()]
    .filter((statement) => !supported.has(statement.kind))
    .map((statement) => statement.kind);
}

function App() {
  const [type, setType] = useState(() => localStorage.getItem("mermaid-p0:type") || "flow");
  const [theme, setTheme] = useState(false);
  const [messageOp, setMessageOp] = useState("->>");
  const [storageError, setStorageError] = useState(() => readSaved(type).error || "");
  // A source editor belongs to one diagram load; explicit loads replace it.
  const [editor, setEditor] = useState(() => fresh(type, readSaved(type).value?.source));
  useEffect(() => {
    const bridge = { editor, mermaid };
    window.__mermaidP0 = bridge;
    return () => {
      if (window.__mermaidP0 === bridge) delete window.__mermaidP0;
    };
  }, [editor]);
  const [code, setCode] = useState(editor.code);
  const [layout, setLayout] = useState(() => initialLayout(editor, type));
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const unsupported = unsupportedStatements(editor, type);
  useEffect(() => {
    setCode(editor.code);
    const off = editor.on("change", ({ code: next }) => setCode(next));
    return off;
  }, [editor]);
  useEffect(() => {
    setStorageError(readSaved(type).error || "");
  }, [editor, type]);
  useEffect(() => {
    const graph = type === "flow" ? getFlowGraph(editor) : editor.result.sequence;
    if (!graph || unsupportedStatements(editor, type).length) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const nextNodes =
      type === "flow"
        ? graph.nodes.map((n) => ({
            id: n.id,
            type: "diagram",
            width: 150,
            height: 72,
            position: (Object.hasOwn(layout, n.id) ? layout[n.id] : null) || {
              x: 80 + graph.nodes.indexOf(n) * 220,
              y: 100,
            },
            data: {
              id: n.id,
              label: n.label,
              rename: (label) => editor.dispatch({ type: "renameNode", id: n.id, label }),
            },
          }))
        : graph.participants.map((p) => ({
            id: p.id,
            type: "participant",
            width: 140,
            height: Math.max(
              180,
              90 + graph.events.filter((e) => e.kind === "message").length * 42,
            ),
            position: (Object.hasOwn(layout, p.id) ? layout[p.id] : null) || {
              x: 80 + p.order * 250,
              y: 70,
            },
            data: {
              id: p.id,
              label: p.label,
              eventRows: graph.events
                .filter((e) => e.kind === "message")
                .map((e, index) => ({ index, source: e.stmt.source, target: e.stmt.target })),
              rename: (label) =>
                editor.dispatch({ type: "seq.renameParticipant", id: p.id, name: label }),
            },
            draggable: true,
            dragHandle: ".participant-drag-area",
          }));
    // Keep measurements across source/layout projection; dimensions events must
    // never trigger another layout update and restart node measurement.
    setNodes((current) =>
      nextNodes.map((node) => ({ ...current.find((old) => old.id === node.id), ...node })),
    );
    const nextEdges =
      type === "flow"
        ? graph.edges.map((e) => ({
            id: e.entityId,
            source: e.source,
            target: e.target,
            label: e.label || "",
            markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b" },
            animated: false,
            data: { kind: "flow" },
          }))
        : graph.events
            .filter((e) => e.kind === "message")
            .map((e, i) => ({
              id: e.entityId,
              source: e.stmt.source,
              target: e.stmt.target,
              sourceHandle: `source-${i}`,
              targetHandle: `target-${i}`,
              label: e.stmt.text,
              type: "straight",
              markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b" },
              data: { kind: "sequence", index: i, op: e.stmt.op },
              style: { strokeDasharray: e.stmt.op.includes("--") ? "6 4" : undefined },
              labelStyle: { fill: "#333" },
            }));
    setEdges(nextEdges);
  }, [editor, type, code, layout]);
  const save = () =>
    localStorage.setItem(layoutKey(type), JSON.stringify({ version: 1, source: code, layout }));
  const reset = () => {
    localStorage.removeItem(layoutKey(type));
    const next =
      type === "flow"
        ? flowLayout(editor)
        : Object.fromEntries(
            editor.result.sequence.participants.map((p, i) => [p.id, { x: 80 + i * 250, y: 70 }]),
          );
    setLayout(next);
    setNodes((current) =>
      current.map((node) => ({ ...node, position: next[node.id] || node.position })),
    );
  };
  const onNodesChange = (changes) => {
    const safeChanges =
      type === "sequence"
        ? changes.map((c) =>
            c.type === "position" && c.position ? { ...c, position: { ...c.position, y: 70 } } : c,
          )
        : changes;
    setNodes((current) => applyNodeChanges(safeChanges, current));
    const positions = { ...layout };
    let changed = false;
    safeChanges
      .filter((c) => c.type === "position" && c.position && c.dragging === false)
      .forEach((c) => {
        const previous = positions[c.id];
        if (!previous || previous.x !== c.position.x || previous.y !== c.position.y) {
          Object.defineProperty(positions, c.id, {
            value: c.position,
            enumerable: true,
            configurable: true,
            writable: true,
          });
          changed = true;
        }
      });
    if (changed) setLayout(positions);
  };
  const onConnect = (connection) => {
    if (type === "flow")
      editor.dispatch({
        type: "connect",
        source: connection.source,
        target: connection.target,
        label: "",
      });
    else
      editor.dispatch({
        type: "seq.addMessage",
        source: connection.source,
        target: connection.target,
        text: "消息",
        op: messageOp,
      });
  };
  const add = () => {
    if (type === "flow") editor.dispatch({ type: "addNode", label: "新节点" });
    else editor.dispatch({ type: "seq.addParticipant" });
  };
  const blank = () => {
    localStorage.removeItem(layoutKey(type));
    setStorageError("");
    const next = fresh(type, type === "flow" ? EMPTY_FLOW : EMPTY_SEQUENCE);
    setEditor(next);
    setCode(next.code);
    setLayout({});
  };
  const reload = () => {
    save();
    const next = fresh(type, readSaved(type).value?.source);
    setEditor(next);
    setCode(next.code);
    setLayout(initialLayout(next, type));
  };
  const setDiagram = (nextType) => {
    localStorage.setItem("mermaid-p0:type", nextType);
    const next = fresh(nextType, readSaved(nextType).value?.source);
    setType(nextType);
    setEditor(next);
    setCode(next.code);
    setLayout(initialLayout(next, nextType));
  };
  return h(
    "main",
    { className: theme ? "app dark" : "app", "data-theme": theme ? "dark" : "light" },
    h(
      "header",
      null,
      h("strong", null, "Mermaid visual editing feasibility"),
      h("button", { onClick: () => setDiagram("flow") }, "Flowchart"),
      h("button", { onClick: () => setDiagram("sequence") }, "Sequence"),
      type === "sequence"
        ? h(
            "label",
            null,
            "Message type ",
            h(
              "select",
              {
                "data-testid": "message-op",
                value: messageOp,
                onChange: (e) => setMessageOp(e.target.value),
              },
              h("option", { value: "->>" }, "Request"),
              h("option", { value: "-->>" }, "Return"),
            ),
          )
        : null,
      h("button", { onClick: blank, "data-testid": "blank" }, "New blank"),
      h(
        "button",
        { onClick: add, disabled: unsupported.length > 0, "data-testid": "add" },
        type === "flow" ? "Add node" : "Add participant",
      ),
      h("button", { onClick: save, "data-testid": "save" }, "Save layout"),
      h("button", { onClick: reload, "data-testid": "reload" }, "Reopen"),
      h(
        "button",
        { onClick: reset, disabled: unsupported.length > 0, "data-testid": "reset" },
        "Reset layout",
      ),
      h("button", { onClick: () => setTheme((x) => !x), "data-testid": "theme" }, "Toggle theme"),
    ),
    unsupported.length
      ? h(
          "p",
          { role: "alert", "data-testid": "unsupported" },
          `Visual editing paused for unsupported Mermaid statements: ${unsupported.join(", ")}. Original source remains available below.`,
        )
      : h(
          "section",
          { className: "canvas", "data-testid": "canvas" },
          h(
            ReactFlow,
            {
              nodes,
              edges,
              nodeTypes,
              onNodesChange,
              onConnect,
              onEdgeDoubleClick: (_event, edge) => {
                const next = window.prompt("Edit diagram label", edge.label || "");
                if (next !== null && edge.data?.kind === "sequence")
                  editor.dispatch({ type: "seq.setEventText", eventId: edge.id, text: next });
                else if (next !== null && edge.data?.kind === "flow")
                  editor.dispatch({ type: "setEdgeLabel", edgeId: edge.id, label: next });
              },
              fitView: true,
              nodesConnectable: true,
              deleteKeyCode: null,
            },
            h(Background),
            h(Controls),
          ),
        ),
    h("label", { className: "source-label" }, "Mermaid source"),
    h("textarea", {
      "data-testid": "source",
      value: code,
      onChange: (e) => editor.setCode(e.target.value),
      spellCheck: false,
    }),
    storageError ? h("p", { role: "alert" }, `Saved layout ignored: ${storageError}`) : null,
    h(
      "output",
      { "data-testid": "summary" },
      JSON.stringify({
        type,
        layout,
        eventOrder:
          type === "sequence" ? editor.result.sequence?.events.map((e) => e.entityId) : undefined,
      }),
    ),
  );
}

createRoot(document.getElementById("root")).render(h(App));
