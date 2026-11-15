import {
  MermaidWysiwygEditor,
  parse as parseVisimer,
  type EditorOp,
  type FlowGraph,
  type Origin,
  type SequenceGraph,
} from "@visimer/core";
import { MermaidCanvasView } from "@visimer/dom";
import type {
  GraphicalCodeBlockEditorProvider,
  GraphicalCodeBlockEditorHandle,
} from "@md-editor/plugin-sdk/syntax";
import { parseMermaid, runMermaidOperation } from "./mermaid-loader.ts";

const DIAGRAM_TYPES = Object.freeze([
  { id: "flowchart", label: "流程图", initialSource: "flowchart TD" },
  { id: "sequence", label: "时序图", initialSource: "sequenceDiagram" },
]);
const styledDocuments = new WeakSet<Document>();
const GRAPHICAL_EDITOR_CSS = `
.mw-canvas { position: relative; }
.mw-canvas .cm-md-mermaid-graphical-toolbar {
  position: absolute; inset: 0.5rem auto auto 0.5rem; z-index: 20;
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem;
  max-width: calc(100% - 1rem); padding: 0.35rem;
  border: 1px solid var(--theme-border, #d8dee4); border-radius: 0.5rem;
  background: var(--theme-surface, #fff); color: var(--theme-text, #24292f);
  box-shadow: var(--theme-shadow, 0 2px 8px rgba(0, 0, 0, 0.12));
}
.mw-canvas .cm-md-mermaid-graphical-toolbar button {
  min-height: 2rem; padding: 0.3rem 0.55rem; border: 1px solid var(--theme-border, #d8dee4);
  border-radius: 0.35rem; background: transparent; color: inherit; cursor: pointer;
  font: inherit; font-size: 0.78rem;
}
.mw-canvas .cm-md-mermaid-graphical-toolbar button:hover:not(:disabled),
.mw-canvas .cm-md-mermaid-graphical-toolbar button:focus-visible {
  border-color: var(--theme-primary, #0969da); outline: 2px solid var(--theme-primary, #0969da);
  outline-offset: 1px;
}
.mw-canvas .cm-md-mermaid-graphical-toolbar button:disabled { cursor: not-allowed; opacity: 0.55; }
.mw-canvas .cm-md-mermaid-graphical-toolbar output { flex-basis: 100%; font-size: 0.75rem; }
.mw-canvas .cm-md-mermaid-graphical-input { display: flex; flex-basis: 100%; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
.mw-canvas .cm-md-mermaid-graphical-input label { flex-basis: 100%; font-size: 0.78rem; }
.mw-canvas .cm-md-mermaid-graphical-input input, .mw-canvas .cm-md-mermaid-graphical-input select { min-width: 12rem; min-height: 2rem; flex: 1; padding: 0.3rem 0.45rem; border: 1px solid var(--theme-border, #d8dee4); border-radius: 0.35rem; background: var(--theme-surface, #fff); color: inherit; font: inherit; }
`;

type Inspection = { readonly supported: boolean; readonly reason?: string };

function unsupported(reason: string): Inspection {
  return Object.freeze({ supported: false, reason });
}

function isSimpleFlowchart(graph: FlowGraph): string | null {
  if (graph.subgraphs.length > 0) return "子图尚不支持图形编辑";
  if (graph.nodes.some((node) => node.refs.filter((ref) => ref.ref.labelSpan).length > 1)) {
    return "节点存在重复主声明，请使用源码编辑";
  }
  for (const statement of graph.statements.values()) {
    if (
      !new Set(["chain", "direction", "classDef", "classAssign", "style", "linkStyle"]).has(
        statement.kind,
      )
    ) {
      return "包含无法安全编辑的流程图语法";
    }
  }
  return null;
}

function isSimpleSequence(graph: SequenceGraph): string | null {
  const supportedKinds = new Set(["participant", "message", "end"]);
  for (const statement of graph.statements.values()) {
    if (!supportedKinds.has(statement.kind))
      return "循环、注释块或其他复杂时序语法尚不支持图形编辑";
  }
  const aliases = graph.participants.flatMap((participant) =>
    participant.decl?.alias ? [participant.decl.alias.toLocaleLowerCase()] : [],
  );
  if (new Set(aliases).size !== aliases.length) return "参与者别名重复，无法安全映射身份";
  return null;
}

async function inspectSource(source: string): Promise<Inspection> {
  let parsed: ReturnType<typeof parseVisimer>;
  try {
    parsed = parseVisimer(source);
  } catch {
    return unsupported("无法安全识别此 Mermaid 源码");
  }
  if (parsed.typeInfo?.id !== "flowchart" && parsed.typeInfo?.id !== "sequence") {
    return unsupported("仅支持 Mermaid 流程图和时序图");
  }
  try {
    await parseMermaid(source);
  } catch (error) {
    return unsupported(error instanceof Error ? error.message : "Mermaid 源码无效");
  }
  if (parsed.flowchart) {
    const reason = isSimpleFlowchart(parsed.flowchart);
    return reason ? unsupported(reason) : Object.freeze({ supported: true });
  }
  if (parsed.sequence) {
    const reason = isSimpleSequence(parsed.sequence);
    return reason ? unsupported(reason) : Object.freeze({ supported: true });
  }
  return unsupported("无法识别此 Mermaid 图表结构");
}

function safeLabel(value: string): boolean {
  // Restrict labels to a predictable single-line alphabet before semantic patching.
  return /^[-\p{L}\p{N}\p{M} _.,!?;:()/+]*$/u.test(value);
}

function safeIdentifier(value: string): boolean {
  return /^[\p{L}\p{N}_.-]+$/u.test(value);
}

function flowNodeIsReferenced(graph: FlowGraph, id: string): boolean {
  return (
    graph.edges.some((edge) => edge.source === id || edge.target === id) ||
    [...graph.statements.values()].some(
      (statement) => statement.kind !== "chain" && "ids" in statement && statement.ids.includes(id),
    )
  );
}

function sequenceParticipantIsReferenced(graph: SequenceGraph, id: string): boolean {
  return graph.events.some((event) =>
    event.kind === "message"
      ? event.stmt.source === id || event.stmt.target === id
      : event.stmt.targets.includes(id),
  );
}

/** Guard every Visimer deletion path, including its built-in popover and multi-selection delete. */
class ProtectedMermaidEditor extends MermaidWysiwygEditor {
  constructor(
    private readonly onDeleteBlocked: (message: string) => void,
    code: string,
  ) {
    super({ code });
  }

  override dispatch(op: EditorOp, origin?: Origin) {
    const reason = this.deletionBlockReason(op);
    if (reason) {
      this.onDeleteBlocked(reason);
      return null;
    }
    return super.dispatch(op, origin);
  }

  override deleteEntities(entityIds: string[], origin?: Origin): void {
    for (const entityId of entityIds) {
      const reason = this.entityDeletionBlockReason(entityId);
      if (reason) {
        this.onDeleteBlocked(reason);
        return;
      }
    }
    super.deleteEntities(entityIds, origin);
  }

  private deletionBlockReason(op: EditorOp): string | null {
    if (op.type === "deleteNode") return this.entityDeletionBlockReason(`node:${op.id}`);
    if (op.type === "seq.deleteParticipant") {
      return this.entityDeletionBlockReason(`participant:${op.id}`);
    }
    return null;
  }

  private entityDeletionBlockReason(entityId: string): string | null {
    if (entityId.startsWith("node:")) {
      const id = entityId.slice(5);
      const graph = this.result.flowchart;
      return graph && flowNodeIsReferenced(graph, id) ? "请先删除引用此节点的关系或样式。" : null;
    }
    if (entityId.startsWith("participant:")) {
      const id = entityId.slice(12);
      const graph = this.result.sequence;
      return graph && sequenceParticipantIsReferenced(graph, id)
        ? "请先删除引用此参与者的消息或注释。"
        : null;
    }
    return null;
  }
}

function labelsAreSafe(
  before: ReturnType<typeof parseVisimer>,
  after: ReturnType<typeof parseVisimer>,
): boolean {
  const prior = new Map<string, string>();
  const next = new Map<string, string>();
  for (const node of before.flowchart?.nodes ?? []) prior.set(node.entityId, node.label);
  for (const edge of before.flowchart?.edges ?? []) prior.set(edge.entityId, edge.label ?? "");
  for (const participant of before.sequence?.participants ?? [])
    prior.set(participant.entityId, participant.label);
  for (const event of before.sequence?.events ?? []) {
    if (event.kind === "message") prior.set(event.entityId, event.stmt.text);
  }
  for (const node of after.flowchart?.nodes ?? []) next.set(node.entityId, node.label);
  for (const edge of after.flowchart?.edges ?? []) next.set(edge.entityId, edge.label ?? "");
  for (const participant of after.sequence?.participants ?? [])
    next.set(participant.entityId, participant.label);
  for (const event of after.sequence?.events ?? []) {
    if (event.kind === "message") next.set(event.entityId, event.stmt.text);
  }
  for (const [entity, label] of next) {
    if (prior.get(entity) !== label && !safeLabel(label)) return false;
  }
  return true;
}

function selected(editor: MermaidWysiwygEditor, kind: string): string | null {
  return editor.selection.find((id) => id.startsWith(`${kind}:`)) ?? null;
}

function appendToolbar(
  parent: HTMLElement,
  editor: MermaidWysiwygEditor,
  view: MermaidCanvasView,
  sourceKind: "flowchart" | "sequence",
  reportError: (message: string) => void,
  onInputBusyChange: (busy: boolean) => void,
): () => void {
  const doc = parent.ownerDocument;
  const toolbar = doc.createElement("nav");
  toolbar.className = "cm-md-mermaid-graphical-toolbar";
  toolbar.setAttribute(
    "aria-label",
    sourceKind === "flowchart" ? "流程图编辑工具" : "时序图编辑工具",
  );
  const status = doc.createElement("output");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  toolbar.append(status);
  const controls = new Map<HTMLButtonElement, () => string | null>();
  let cancelPendingInput: (() => void) | undefined;
  let pendingInputCount = 0;
  const add = (
    label: string,
    action: () => void | Promise<void>,
    disabledReason?: () => string | null,
  ): void => {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    if (disabledReason) controls.set(button, disabledReason);
    toolbar.append(button);
  };
  const ask = (
    label: string,
    initial = "",
    choices?: readonly { readonly value: string; readonly label: string }[],
  ): Promise<string | null> =>
    new Promise((resolve) => {
      pendingInputCount++;
      onInputBusyChange(true);
      const panel = doc.createElement("div");
      panel.className = "cm-md-mermaid-graphical-input";
      const inputId = `mermaid-graphical-input-${Math.random().toString(36).slice(2)}`;
      const inputLabel = doc.createElement("label");
      inputLabel.htmlFor = inputId;
      inputLabel.textContent = label;
      const field = choices ? doc.createElement("select") : doc.createElement("input");
      field.id = inputId;
      if (field.tagName === "INPUT") {
        const textField = field as HTMLInputElement;
        textField.type = "text";
        textField.value = initial;
      } else {
        for (const choice of choices ?? []) {
          const option = doc.createElement("option");
          option.value = choice.value;
          option.textContent = choice.label;
          field.append(option);
        }
      }
      const confirm = doc.createElement("button");
      confirm.type = "button";
      confirm.textContent = "确定";
      const cancel = doc.createElement("button");
      cancel.type = "button";
      cancel.textContent = "取消";
      const returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
      const previousDisabled = [...toolbar.querySelectorAll("button")].map(
        (button) => button.disabled,
      );
      for (const button of toolbar.querySelectorAll("button")) button.disabled = true;
      let settled = false;
      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        cancelPendingInput = undefined;
        pendingInputCount--;
        [...toolbar.querySelectorAll("button")]
          .filter((button) => button !== confirm && button !== cancel)
          .forEach((button, index) => {
            button.disabled = previousDisabled[index] ?? false;
          });
        panel.remove();
        if (returnFocus?.isConnected) returnFocus.focus();
        resolve(value);
        // Promise continuation runs first; it may dispatch an edit that starts
        // async validation before the pending-input flag is cleared.
        queueMicrotask(() => onInputBusyChange(pendingInputCount > 0));
      };
      cancelPendingInput = () => finish(null);
      const submit = (): void => {
        const value = field.value;
        if (choices && choices.length === 0) {
          status.textContent = "请先添加可选择的图表元素。";
          reportError(status.textContent);
          return;
        }
        if (!choices && !safeLabel(value)) {
          status.textContent = "文字包含不支持的符号或换行，请使用单行文字和常规标点。";
          reportError(status.textContent);
          field.focus();
          return;
        }
        status.textContent = "";
        finish(value);
      };
      confirm.addEventListener("click", submit);
      cancel.addEventListener("click", () => finish(null));
      field.addEventListener("keydown", (event) => {
        const keyEvent = event as KeyboardEvent;
        if (keyEvent.key === "Enter") {
          if (keyEvent.isComposing || keyEvent.keyCode === 229) {
            keyEvent.stopPropagation();
            return;
          }
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          submit();
        } else if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          finish(null);
        }
      });
      panel.append(inputLabel, field, confirm, cancel);
      toolbar.append(panel);
      field.focus();
    });

  if (sourceKind === "flowchart") {
    add("添加节点", async () => {
      const label = await ask("节点文字");
      if (label !== null) editor.dispatch({ type: "addNode", label });
    });
    add(
      "连接节点",
      async () => {
        const choices = (editor.result.flowchart?.nodes ?? []).map((node) => ({
          value: node.id,
          label: node.label,
        }));
        const source = await ask("起点节点", "", choices);
        const target = source !== null ? await ask("终点节点", "", choices) : null;
        if (source && target) editor.dispatch({ type: "connect", source, target });
      },
      () => ((editor.result.flowchart?.nodes.length ?? 0) === 0 ? "请先添加节点" : null),
    );
    add("修改节点文字", async () => {
      const id = selected(editor, "node");
      const node = id && editor.result.flowchart?.nodeById.get(id.slice(5));
      const label = node ? await ask("节点文字", node.label) : null;
      if (id && label !== null) editor.dispatch({ type: "renameNode", id: id.slice(5), label });
    });
    add("修改关系文字", async () => {
      const id = selected(editor, "edge");
      const edge = id && editor.result.flowchart?.edges.find((item) => item.entityId === id);
      const label = edge ? await ask("关系文字", edge.label ?? "") : null;
      if (id && label !== null) editor.dispatch({ type: "setEdgeLabel", edgeId: id, label });
    });
    add(
      "删除关系",
      () => {
        const id = selected(editor, "edge");
        if (id) editor.dispatch({ type: "deleteEdge", edgeId: id });
      },
      () => (selected(editor, "edge") ? null : "先选择一条关系"),
    );
    add(
      "删除节点",
      () => {
        const id = selected(editor, "node");
        const nodeId = id?.slice(5);
        const graph = editor.result.flowchart;
        if (nodeId && graph && !flowNodeIsReferenced(graph, nodeId)) {
          editor.dispatch({ type: "deleteNode", id: nodeId });
        }
      },
      () => {
        const id = selected(editor, "node")?.slice(5);
        const graph = editor.result.flowchart;
        if (!id || !graph) return "先选择一个节点";
        return flowNodeIsReferenced(graph, id) ? "请先删除引用此节点的关系或样式" : null;
      },
    );
  } else {
    add("添加参与者", async () => {
      const name = await ask("参与者名称");
      if (name !== null) editor.dispatch({ type: "seq.addParticipant", name });
    });
    add(
      "添加消息",
      async () => {
        const choices = (editor.result.sequence?.participants ?? []).map((participant) => ({
          value: participant.id,
          label: participant.label,
        }));
        const source = await ask("发送方", "", choices);
        const target = source !== null ? await ask("接收方", "", choices) : null;
        const text = target !== null ? await ask("消息文字") : null;
        if (source !== null && target !== null && text !== null) {
          editor.dispatch({ type: "seq.addMessage", source, target, text });
        }
      },
      () => ((editor.result.sequence?.participants.length ?? 0) < 2 ? "请先添加两个参与者" : null),
    );
    add("修改参与者名称", async () => {
      const id = selected(editor, "participant");
      const person = id ? editor.result.sequence?.participantById.get(id.slice(12)) : undefined;
      const name = person ? await ask("参与者名称", person.label) : null;
      if (id && person && name !== null) {
        if (!person?.decl?.alias && !safeIdentifier(name)) {
          status.textContent = "无别名参与者的 ID 只能使用字母、数字、点、下划线或短横线。";
          reportError(status.textContent);
          return;
        }
        if (
          !person?.decl?.alias &&
          editor.result.sequence?.participantById.has(name) &&
          name !== person.id
        ) {
          status.textContent = "该参与者 ID 已被使用。";
          reportError(status.textContent);
          return;
        }
        editor.dispatch({ type: "seq.renameParticipant", id: id.slice(12), name });
      }
    });
    add("修改消息文字", async () => {
      const id = selected(editor, "event");
      const event = id
        ? editor.result.sequence?.events.find((item) => item.entityId === id)
        : undefined;
      if (id && event?.kind === "message") {
        const text = await ask("消息文字", event.stmt.text);
        if (text !== null) editor.dispatch({ type: "seq.setEventText", eventId: id, text });
      }
    });
    add(
      "删除消息",
      () => {
        const id = selected(editor, "event");
        const event = id
          ? editor.result.sequence?.events.find((item) => item.entityId === id)
          : undefined;
        if (id && event?.kind === "message")
          editor.dispatch({ type: "seq.deleteEvent", eventId: id });
      },
      () => {
        const id = selected(editor, "event");
        const event = id
          ? editor.result.sequence?.events.find((item) => item.entityId === id)
          : undefined;
        return event?.kind === "message" ? null : "先选择一条消息";
      },
    );
    add(
      "删除参与者",
      () => {
        const id = selected(editor, "participant");
        const person = id && editor.result.sequence?.participantById.get(id.slice(12));
        const graph = editor.result.sequence;
        if (person && graph && !sequenceParticipantIsReferenced(graph, person.id)) {
          editor.dispatch({ type: "seq.deleteParticipant", id: person.id });
        }
      },
      () => {
        const id = selected(editor, "participant")?.slice(12);
        const person = id && editor.result.sequence?.participantById.get(id);
        if (!person) return "先选择一个参与者";
        return sequenceParticipantIsReferenced(editor.result.sequence!, person.id)
          ? "请先删除引用此参与者的消息或注释"
          : null;
      },
    );
  }
  const refresh = (): void => {
    for (const [button, reasonFor] of controls) {
      const reason = reasonFor();
      button.disabled = Boolean(reason);
      button.title = reason ?? "";
    }
  };
  const offSelection = editor.on("selectionChange", refresh);
  const offChange = editor.on("change", refresh);
  toolbar.addEventListener("keydown", (event) => {
    if (event.key === "Escape") view.setTool("select");
  });
  refresh();
  parent.prepend(toolbar);
  const destroyToolbar = (): void => {
    cancelPendingInput?.();
    offSelection();
    offChange();
    toolbar.remove();
  };
  return destroyToolbar;
}

/** Mermaid SVG loading and graphical edits share a serialized strict runtime. */
export const mermaidGraphicalEditor: GraphicalCodeBlockEditorProvider = Object.freeze({
  id: "mermaid.graphical.default-layout",
  diagramTypes: DIAGRAM_TYPES,
  inspect: inspectSource,
  async mount(
    input: Parameters<GraphicalCodeBlockEditorProvider["mount"]>[0],
  ): Promise<GraphicalCodeBlockEditorHandle> {
    const inertHandle: GraphicalCodeBlockEditorHandle = {
      destroy: () => undefined,
    };
    if (input.signal?.aborted) return inertHandle;
    const inspection = await inspectSource(input.source);
    if (input.signal?.aborted) return inertHandle;
    if (!inspection.supported) throw new Error(inspection.reason ?? "此图表不支持图形编辑");
    const initial = parseVisimer(input.source);
    const sourceKind = initial.flowchart ? "flowchart" : "sequence";
    const editor = new ProtectedMermaidEditor(
      (message) => input.onError?.(new Error(message)),
      input.source,
    );
    const ownerDocument = input.container.ownerDocument;
    if (!styledDocuments.has(ownerDocument)) {
      const style = ownerDocument.createElement("style");
      style.dataset.mdMermaidGraphicalEditor = "";
      style.textContent = GRAPHICAL_EDITOR_CSS;
      ownerDocument.head.append(style);
      styledDocuments.add(ownerDocument);
    }
    let acceptedSource = input.source;
    let currentTheme = input.isDark;
    let changeSequence = 0;
    let destroyed = false;
    let inputBusy = false;
    let validationBusy = false;
    const notifyBusy = (): void => input.onBusyChange?.(inputBusy || validationBusy);
    const mermaidFacade = {
      initialize: (_config: Record<string, unknown>) => undefined,
      render: (id: string, code: string) =>
        runMermaidOperation(currentTheme, (mermaid) => mermaid.render(id, code)),
      parse: (code: string) => parseMermaid(code, currentTheme),
    };
    const view = new MermaidCanvasView({
      editor,
      container: input.container,
      mermaid: mermaidFacade,
      mermaidConfig: {
        securityLevel: "strict",
        startOnLoad: false,
        theme: input.isDark ? "dark" : "default",
      },
      panZoom: true,
      hooks: {
        onEntityClick: () => undefined,
        // Participants without aliases have their ID rendered as editable text; the toolbar
        // performs a collision-checked rename instead of letting the upstream inline editor merge IDs.
        onEntityDoubleClick: (entityId) => entityId.startsWith("participant:"),
      },
    });
    const destroyToolbar = appendToolbar(
      input.container,
      editor,
      view,
      sourceKind,
      (message) => input.onError?.(new Error(message)),
      (busy) => {
        inputBusy = busy;
        notifyBusy();
      },
    );
    const guardNativeDelete = (event: KeyboardEvent): void => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement)
      )
        return;
      const selection = editor.selection;
      const flow = editor.result.flowchart;
      const sequence = editor.result.sequence;
      const referencesUnsafeDelete = selection.some((entityId) => {
        if (entityId.startsWith("node:")) {
          const id = entityId.slice(5);
          return Boolean(flow && flowNodeIsReferenced(flow, id));
        }
        if (entityId.startsWith("participant:")) {
          const id = entityId.slice(12);
          return Boolean(sequence && sequenceParticipantIsReferenced(sequence, id));
        }
        return false;
      });
      if (referencesUnsafeDelete) {
        event.preventDefault();
        event.stopImmediatePropagation();
        input.onError?.(new Error("请先删除引用所选实体的关系或消息。"));
      }
    };
    input.container.addEventListener("keydown", guardNativeDelete, true);
    const onEditorChange = editor.on("change", ({ code }) => {
      const sequence = ++changeSequence;
      validationBusy = true;
      notifyBusy();
      void (async () => {
        const changedLines = code.split("\n");
        if (
          changedLines.some(
            (line) => line.includes(String.fromCharCode(0)) || /^\s*(?:%%\{|click\b)/iu.test(line),
          )
        ) {
          editor.setCode(acceptedSource, "external");
          return;
        }
        const nextParsed = parseVisimer(code);
        if (!labelsAreSafe(parseVisimer(acceptedSource), nextParsed)) {
          editor.setCode(acceptedSource, "external");
          input.onError?.(new Error("文字包含 Mermaid 特殊语法，无法安全地作为单个标签写入。"));
          return;
        }
        const result = await inspectSource(code);
        if (destroyed || sequence !== changeSequence) return;
        if (!result.supported) {
          editor.setCode(acceptedSource, "external");
          input.onError?.(new Error(result.reason ?? "此更改不支持图形编辑"));
          return;
        }
        acceptedSource = code;
        input.onChange(code);
      })()
        .catch((error: unknown) => {
          if (destroyed || sequence !== changeSequence) return;
          editor.setCode(acceptedSource, "external");
          input.onError?.(error instanceof Error ? error : new Error(String(error)));
        })
        .finally(() => {
          if (sequence === changeSequence) {
            validationBusy = false;
            notifyBusy();
          }
        });
    });
    const handle: GraphicalCodeBlockEditorHandle = {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        changeSequence++;
        validationBusy = false;
        input.signal?.removeEventListener("abort", abortHandle);
        destroyToolbar();
        inputBusy = false;
        notifyBusy();
        onEditorChange();
        input.container.removeEventListener("keydown", guardNativeDelete, true);
        view.destroy();
      },
      setTheme(isDark: boolean) {
        if (destroyed) return;
        currentTheme = isDark;
        view.setMermaidConfig({
          securityLevel: "strict",
          startOnLoad: false,
          theme: isDark ? "dark" : "default",
        });
      },
    };
    const abortHandle = (): void => handle.destroy();
    input.signal?.addEventListener("abort", abortHandle, { once: true });
    if (input.signal?.aborted) handle.destroy();
    return handle;
  },
});
