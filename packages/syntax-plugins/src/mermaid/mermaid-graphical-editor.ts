import type { FlowGraph, MermaidWysiwygEditor, SequenceGraph } from "@visimer/core";
// Type-only namespace: `import type` is fully erased, so it does not defeat the lazy loading below.
import type * as VisimerCore from "@visimer/core";
import type { MermaidCanvasView } from "@visimer/dom";
import type {
  GraphicalCodeBlockEditorProvider,
  GraphicalCodeBlockEditorHandle,
} from "@md-editor/plugin-sdk/syntax";
import { parseMermaid, runMermaidOperation } from "./mermaid-loader.ts";
import { installConnectHandles } from "./mermaid-connect-handles.ts";
import { installInlineNodeCreation } from "./mermaid-inline-node-creation.ts";
import { mermaidGraphicalEditorCss } from "./mermaid-graphical-editor-css.ts";

/**
 * Visimer is imported on demand rather than at module scope.
 *
 * `mermaidPlugin` is re-exported from the package root, so this module sits in the
 * host's eagerly loaded chunk. Static imports of `@visimer/core` + `@visimer/dom`
 * (~53 KB gzip) would then ship to every host, including hosts that never render a
 * diagram. Both entry points below are async already, so the loader cost is paid
 * only when a diagram actually exists.
 */
type VisimerCoreModule = {
  MermaidWysiwygEditor: typeof MermaidWysiwygEditor;
  parse: typeof VisimerCore.parse;
};
type VisimerDomModule = { MermaidCanvasView: typeof MermaidCanvasView };
type ParsedMermaid = ReturnType<typeof VisimerCore.parse>;

let corePromise: Promise<VisimerCoreModule> | null = null;
let domPromise: Promise<VisimerDomModule> | null = null;

function loadVisimerCore(): Promise<VisimerCoreModule> {
  corePromise ??= import("@visimer/core").catch((error: unknown) => {
    // A rejected import must stay retryable; a cached rejection would poison the session.
    corePromise = null;
    throw error;
  });
  return corePromise;
}

function loadVisimerDom(): Promise<VisimerDomModule> {
  domPromise ??= import("@visimer/dom").catch((error: unknown) => {
    domPromise = null;
    throw error;
  });
  return domPromise;
}

/**
 * Preload the canvas module once a diagram is known to be graphically editable.
 *
 * The editor chunk is otherwise fetched on the first edit, which breaks offline
 * use: a host that is already offline cannot resolve a chunk it never downloaded,
 * so an existing diagram becomes uneditable and a new one cannot be created
 * (test spec H3 requires offline preview/create/edit). Warming here keeps the
 * startup chunk free of Visimer for documents without diagrams, while a document
 * that does contain one has the module cached before any network loss.
 */
function warmEditorModules(): void {
  void loadVisimerDom().catch(() => {
    // A failed preload must not fail the capability check; `mount` reports it.
  });
}

const DIAGRAM_TYPES = Object.freeze([
  { id: "flowchart", label: "流程图", initialSource: "flowchart TD" },
  { id: "sequence", label: "时序图", initialSource: "sequenceDiagram" },
]);
const styledDocuments = new WeakSet<Document>();

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
  const { parse: parseVisimer } = await loadVisimerCore();
  let parsed: ParsedMermaid;
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
    if (reason) return unsupported(reason);
    warmEditorModules();
    return Object.freeze({ supported: true });
  }
  if (parsed.sequence) {
    const reason = isSimpleSequence(parsed.sequence);
    if (reason) return unsupported(reason);
    warmEditorModules();
    return Object.freeze({ supported: true });
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

function labelsAreSafe(before: ParsedMermaid, after: ParsedMermaid): boolean {
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

/** Toolbar surface handed back to the mount layer so canvas gestures can reuse it. */
interface ToolbarHandle {
  destroy(): void;
  /** Open the validated "node label" form and append the node. */
  requestAddNode(): Promise<void>;
}

function appendToolbar(
  parent: HTMLElement,
  editor: MermaidWysiwygEditor,
  view: MermaidCanvasView,
  sourceKind: "flowchart" | "sequence",
  reportError: (message: string) => void,
  onInputBusyChange: (busy: boolean) => void,
): ToolbarHandle {
  const doc = parent.ownerDocument;
  const toolbar = doc.createElement("nav");
  toolbar.className = "cm-md-mermaid-graphical-toolbar";
  toolbar.setAttribute(
    "aria-label",
    sourceKind === "flowchart" ? "流程图编辑工具" : "时序图编辑工具",
  );
  const status = doc.createElement("output");
  const actions = doc.createElement("div");
  actions.className = "cm-md-mermaid-graphical-toolbar__actions";
  const hint = doc.createElement("span");
  hint.className = "cm-md-mermaid-graphical-toolbar__hint";
  hint.textContent = "选择图中元素以编辑";
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
    context?: string,
  ): HTMLButtonElement => {
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    if (context) button.dataset.context = context;
    if (disabledReason) controls.set(button, disabledReason);
    actions.append(button);
    return button;
  };
  const askFields = (
    specs: readonly {
      readonly label: string;
      readonly initial?: string;
      readonly choices?: readonly { readonly value: string; readonly label: string }[];
    }[],
  ): Promise<string[] | null> =>
    new Promise((resolve) => {
      pendingInputCount++;
      onInputBusyChange(true);
      const panel = doc.createElement("div");
      panel.className = "cm-md-mermaid-graphical-input";
      const fields = specs.map(({ label, initial = "", choices }) => {
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
          if (initial) field.value = initial;
        }
        const fieldGroup = doc.createElement("div");
        fieldGroup.className = "cm-md-mermaid-graphical-input__field";
        fieldGroup.append(inputLabel, field);
        panel.append(fieldGroup);
        return field;
      });
      const confirm = doc.createElement("button");
      confirm.type = "button";
      confirm.textContent = "确定";
      const cancel = doc.createElement("button");
      cancel.type = "button";
      cancel.textContent = "取消";
      const returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
      for (const button of toolbar.querySelectorAll("button")) button.disabled = true;
      let settled = false;
      const finish = (value: string[] | null): void => {
        if (settled) return;
        settled = true;
        cancelPendingInput = undefined;
        pendingInputCount--;
        panel.remove();
        refresh();
        if (returnFocus?.isConnected) returnFocus.focus();
        resolve(value);
        // Promise continuation runs first; it may dispatch an edit that starts
        // async validation before the pending-input flag is cleared.
        queueMicrotask(() => onInputBusyChange(pendingInputCount > 0));
      };
      cancelPendingInput = () => finish(null);
      const submit = (): void => {
        if (specs.some((spec) => spec.choices?.length === 0)) {
          status.textContent = "请先添加可选择的图表元素。";
          reportError(status.textContent);
          return;
        }
        const invalidField = fields.find(
          (field, index) => !specs[index]?.choices && !safeLabel(field.value),
        );
        if (invalidField) {
          status.textContent = "文字包含不支持的符号或换行，请使用单行文字和常规标点。";
          reportError(status.textContent);
          invalidField.focus();
          return;
        }
        status.textContent = "";
        finish(fields.map((field) => field.value));
      };
      confirm.addEventListener("click", submit);
      cancel.addEventListener("click", () => finish(null));
      panel.addEventListener("keydown", (event) => {
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
      panel.append(confirm, cancel);
      toolbar.append(panel);
      fields[0]?.focus();
    });
  /**
   * Prompt for a node label and append the node.
   *
   * Shared by the toolbar button and the canvas double-click gesture so both
   * paths go through one validated form (busy locking, IME handling, label
   * alphabet check) instead of duplicating them.
   */
  const requestAddNode = async (): Promise<void> => {
    if (sourceKind !== "flowchart" || pendingInputCount > 0) return;
    const label = (await askFields([{ label: "节点文字" }]))?.[0] ?? null;
    if (label !== null) editor.dispatch({ type: "addNode", label });
  };
  if (sourceKind === "flowchart") {
    // Connecting no longer needs a toolbar mode: selecting a node reveals drag
    // handles on its edges (see mermaid-connect-handles.ts).
    add("添加节点", () => requestAddNode());
    add(
      "修改节点文字",
      async () => {
        const id = selected(editor, "node");
        const node = id && editor.result.flowchart?.nodeById.get(id.slice(5));
        const label = node
          ? ((await askFields([{ label: "节点文字", initial: node.label }]))?.[0] ?? null)
          : null;
        if (id && label !== null) editor.dispatch({ type: "renameNode", id: id.slice(5), label });
      },
      undefined,
      "node",
    );
    add(
      "修改关系文字",
      async () => {
        const id = selected(editor, "edge");
        const edge = id && editor.result.flowchart?.edges.find((item) => item.entityId === id);
        const label = edge
          ? ((await askFields([{ label: "关系文字", initial: edge.label ?? "" }]))?.[0] ?? null)
          : null;
        if (id && label !== null) editor.dispatch({ type: "setEdgeLabel", edgeId: id, label });
      },
      undefined,
      "edge",
    );
    add(
      "删除关系",
      () => {
        const id = selected(editor, "edge");
        if (id) editor.dispatch({ type: "deleteEdge", edgeId: id });
      },
      () => (selected(editor, "edge") ? null : "先选择一条关系"),
      "edge",
    );
    add(
      "删除节点",
      () => {
        const id = selected(editor, "node");
        const nodeId = id?.slice(5);
        const graph = editor.result.flowchart;
        if (nodeId && graph) {
          editor.dispatch({ type: "deleteNode", id: nodeId });
        }
      },
      () => {
        const id = selected(editor, "node")?.slice(5);
        const graph = editor.result.flowchart;
        if (!id || !graph) return "先选择一个节点";
        return null;
      },
      "node",
    );
  } else {
    add("添加参与者", async () => {
      const name = (await askFields([{ label: "参与者名称" }]))?.[0] ?? null;
      if (name !== null) editor.dispatch({ type: "seq.addParticipant", name });
    });
    add(
      "添加消息",
      async () => {
        const choices = (editor.result.sequence?.participants ?? []).map((participant) => ({
          value: participant.id,
          label: participant.label,
        }));
        const values = await askFields([
          { label: "发送方", initial: selected(editor, "participant")?.slice(12), choices },
          { label: "接收方", initial: choices[1]?.value, choices },
          { label: "消息文字" },
        ]);
        if (values) {
          const [source, target, text] = values as [string, string, string];
          editor.dispatch({ type: "seq.addMessage", source, target, text });
        }
      },
      () => ((editor.result.sequence?.participants.length ?? 0) < 2 ? "请先添加两个参与者" : null),
    );
    add(
      "修改参与者名称",
      async () => {
        const id = selected(editor, "participant");
        const person = id ? editor.result.sequence?.participantById.get(id.slice(12)) : undefined;
        const name = person
          ? ((await askFields([{ label: "参与者名称", initial: person.label }]))?.[0] ?? null)
          : null;
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
      },
      undefined,
      "participant",
    );
    add(
      "修改消息文字",
      async () => {
        const id = selected(editor, "event");
        const event = id
          ? editor.result.sequence?.events.find((item) => item.entityId === id)
          : undefined;
        if (id && event?.kind === "message") {
          const text =
            (await askFields([{ label: "消息文字", initial: event.stmt.text }]))?.[0] ?? null;
          if (text !== null) editor.dispatch({ type: "seq.setEventText", eventId: id, text });
        }
      },
      undefined,
      "event",
    );
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
      "event",
    );
    add(
      "删除参与者",
      () => {
        const id = selected(editor, "participant");
        const person = id && editor.result.sequence?.participantById.get(id.slice(12));
        const graph = editor.result.sequence;
        if (person && graph) {
          editor.dispatch({ type: "seq.deleteParticipant", id: person.id });
        }
      },
      () => {
        const id = selected(editor, "participant")?.slice(12);
        const person = id && editor.result.sequence?.participantById.get(id);
        if (!person) return "先选择一个参与者";
        return null;
      },
      "participant",
    );
  }
  const refresh = (): void => {
    // Selection can change while a form is open; it must not unlock a second operation.
    for (const button of actions.querySelectorAll("button"))
      button.disabled = pendingInputCount > 0;
    for (const button of actions.querySelectorAll<HTMLButtonElement>("button[data-context]")) {
      button.hidden = !selected(editor, button.dataset.context!);
    }
    hint.hidden = editor.selection.length > 0;
    for (const [button, reasonFor] of controls) {
      const reason = reasonFor();
      button.disabled = pendingInputCount > 0 || Boolean(reason);
      button.title = reason ?? "";
    }
  };
  const offSelection = editor.on("selectionChange", refresh);
  const offChange = editor.on("change", refresh);
  refresh();
  actions.append(hint);
  toolbar.prepend(actions, status);
  parent.prepend(toolbar);

  const destroyToolbar = (): void => {
    cancelPendingInput?.();
    offSelection();
    offChange();
    toolbar.remove();
  };
  return { destroy: destroyToolbar, requestAddNode };
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
    const [{ MermaidWysiwygEditor, parse: parseVisimer }, { MermaidCanvasView }] =
      await Promise.all([loadVisimerCore(), loadVisimerDom()]);
    if (input.signal?.aborted) return inertHandle;
    const initial = parseVisimer(input.source);
    const sourceKind = initial.flowchart ? "flowchart" : "sequence";
    // Visimer removes incident edges/messages and their style references in one semantic edit.
    const editor = new MermaidWysiwygEditor({ code: input.source });
    const ownerDocument = input.container.ownerDocument;
    if (!styledDocuments.has(ownerDocument)) {
      const style = ownerDocument.createElement("style");
      style.dataset.mdMermaidGraphicalEditor = "";
      style.textContent = mermaidGraphicalEditorCss;
      ownerDocument.head.append(style);
      styledDocuments.add(ownerDocument);
    }
    let acceptedSource = input.source;
    let currentTheme = input.isDark;
    let changeSequence = 0;
    let destroyed = false;
    let inputBusy = false;
    let validationBusy = false;
    // `setReadOnly` is a single boolean shared by several owners (toolbar forms and
    // the inline placeholder). Tracking the lock sources instead of overwriting a
    // flag keeps one owner's release from unlocking another owner's lock.
    const readOnlyLocks = new Set<string>();
    const setReadOnlyLock = (owner: string, locked: boolean): void => {
      if (locked) readOnlyLocks.add(owner);
      else readOnlyLocks.delete(owner);
      view.setReadOnly(readOnlyLocks.size > 0);
    };
    const notifyBusy = (): void => input.onBusyChange?.(inputBusy || validationBusy);
    const mermaidFacade = {
      initialize: (_config: Record<string, unknown>) => undefined,
      render: (id: string, code: string) =>
        runMermaidOperation(currentTheme, (mermaid) => mermaid.render(id, code)),
      parse: (code: string) => parseMermaid(code, currentTheme),
    };
    input.container.classList.add("cm-md-mermaid-graphical-editor");
    const canvas = ownerDocument.createElement("div");
    input.container.append(canvas);
    const view = new MermaidCanvasView({
      editor,
      container: canvas,
      // Controls share selection ownership, but not the viewport used by fit/pan/zoom.
      interactionRoot: input.container,
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
    const toolbar = appendToolbar(
      input.container,
      editor,
      view,
      sourceKind,
      (message) => input.onError?.(new Error(message)),
      (busy) => {
        // Pending forms keep selection available but suspend competing canvas mutations.
        setReadOnlyLock("toolbar-form", busy);
        inputBusy = busy;
        notifyBusy();
      },
    );
    // Selecting a node reveals drag handles on its four edges; dragging one onto
    // another node connects them without a toolbar mode or a pick-two form.
    const connectHandles =
      sourceKind === "flowchart"
        ? installConnectHandles({ view, editor, container: canvas })
        : null;
    // Double-clicking empty canvas drops a dashed placeholder that takes a label
    // in place; committing appends the node (its position comes from the layout).
    // Nodes and edges keep their own double-click behaviour.
    const inlineNode =
      sourceKind === "flowchart"
        ? installInlineNodeCreation({
            editor,
            container: canvas,
            onError: (message) => input.onError?.(new Error(message)),
            // The placeholder owns its own lock. Sharing the mount-level
            // `inputBusy` flag let an async validation callback clear it while
            // the canvas was still meant to be read-only, which left the view
            // permanently non-editable after committing a node.
            onBusyChange: (busy) => {
              setReadOnlyLock("inline-node", busy);
              notifyBusy();
            },
          })
        : null;
    const onCanvasDoubleClick = (event: MouseEvent): void => {
      if (sourceKind !== "flowchart" || destroyed || !inlineNode) return;
      const target = event.target as Element | null;
      if (target?.closest?.("[data-mw-entity]")) return;
      event.preventDefault();
      inlineNode.open(event.clientX, event.clientY);
    };
    canvas.addEventListener("dblclick", onCanvasDoubleClick);
    const onEditorChange = editor.on("change", ({ code }) => {
      const sequence = ++changeSequence;
      validationBusy = true;
      notifyBusy();
      void (async () => {
        // Reuse the module the session already loaded instead of re-resolving it per edit.
        const { parse: parseForValidation } = await loadVisimerCore();
        const changedLines = code.split("\n");
        if (
          changedLines.some(
            (line) => line.includes(String.fromCharCode(0)) || /^\s*(?:%%\{|click\b)/iu.test(line),
          )
        ) {
          editor.setCode(acceptedSource, "external");
          return;
        }
        const nextParsed = parseForValidation(code);
        if (!labelsAreSafe(parseForValidation(acceptedSource), nextParsed)) {
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
        canvas.removeEventListener("dblclick", onCanvasDoubleClick);
        inlineNode?.destroy();
        connectHandles?.destroy();
        toolbar.destroy();
        inputBusy = false;
        notifyBusy();
        onEditorChange();
        view.destroy();
        canvas.remove();
        input.container.classList.remove("cm-md-mermaid-graphical-editor");
      },
      setTheme(isDark: boolean) {
        // Hosts repeat the initial theme after mount; replacing the SVG would interrupt a drag.
        if (destroyed || currentTheme === isDark) return;
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
