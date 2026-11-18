import type { FlowGraph, MermaidWysiwygEditor, SequenceGraph } from "@visimer/core";
// Type-only namespace: `import type` is fully erased, so it does not defeat the lazy loading below.
import type * as VisimerCore from "@visimer/core";
import type { MermaidCanvasView } from "@visimer/dom";
import type {
  EditorMessageTranslator,
  GraphicalCodeBlockEditorProvider,
  GraphicalCodeBlockEditorHandle,
} from "@md-editor/plugin-sdk/syntax";
import { parseMermaid, runMermaidOperation } from "./mermaid-loader.ts";
import { installConnectHandles } from "./mermaid-connect-handles.ts";
import { installInlineNodeCreation } from "./mermaid-inline-node-creation.ts";
import { createMermaidDraftEditor, isMermaidLabel } from "./mermaid-draft-editor.ts";
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

function isSimpleFlowchart(graph: FlowGraph, text: EditorMessageTranslator): string | null {
  if (graph.subgraphs.length > 0)
    return text("editor.mermaid.subgraphUnsupported", "子图尚不支持图形编辑");
  if (graph.nodes.some((node) => node.refs.filter((ref) => ref.ref.labelSpan).length > 1)) {
    return text("editor.mermaid.duplicateNode", "节点存在重复主声明，请使用源码编辑");
  }
  for (const statement of graph.statements.values()) {
    if (
      !new Set(["chain", "direction", "classDef", "classAssign", "style", "linkStyle"]).has(
        statement.kind,
      )
    ) {
      return text("editor.mermaid.unsupportedFlowchart", "包含无法安全编辑的流程图语法");
    }
  }
  return null;
}

function isSimpleSequence(graph: SequenceGraph, text: EditorMessageTranslator): string | null {
  const supportedKinds = new Set(["participant", "message", "end"]);
  for (const statement of graph.statements.values()) {
    if (!supportedKinds.has(statement.kind))
      return text(
        "editor.mermaid.unsupportedSequence",
        "循环、注释块或其他复杂时序语法尚不支持图形编辑",
      );
  }
  const aliases = graph.participants.flatMap((participant) =>
    participant.decl?.alias ? [participant.decl.alias.toLocaleLowerCase()] : [],
  );
  if (new Set(aliases).size !== aliases.length)
    return text("editor.mermaid.duplicateAlias", "参与者别名重复，无法安全映射身份");
  return null;
}

const fallbackText: EditorMessageTranslator = (_key, fallback) => fallback;

async function inspectSource(
  source: string,
  translate?: EditorMessageTranslator,
): Promise<Inspection> {
  const text = typeof translate === "function" ? translate : fallbackText;
  const { parse: parseVisimer } = await loadVisimerCore();
  let parsed: ParsedMermaid;
  try {
    parsed = parseVisimer(source);
  } catch {
    return unsupported(text("editor.mermaid.unrecognizedSource", "无法安全识别此 Mermaid 源码"));
  }
  if (parsed.typeInfo?.id !== "flowchart" && parsed.typeInfo?.id !== "sequence") {
    return unsupported(text("editor.mermaid.unsupportedType", "仅支持 Mermaid 流程图和时序图"));
  }
  try {
    await parseMermaid(source);
  } catch {
    return unsupported(text("editor.mermaid.invalidSource", "Mermaid 源码无效"));
  }
  if (parsed.flowchart) {
    const reason = isSimpleFlowchart(parsed.flowchart, text);
    if (reason) return unsupported(reason);
    warmEditorModules();
    return Object.freeze({ supported: true });
  }
  if (parsed.sequence) {
    const reason = isSimpleSequence(parsed.sequence, text);
    if (reason) return unsupported(reason);
    warmEditorModules();
    return Object.freeze({ supported: true });
  }
  return unsupported(text("editor.mermaid.unknownStructure", "无法识别此 Mermaid 图表结构"));
}

function safeIdentifier(value: string): boolean {
  return /^[\p{L}\p{N}_.-]+$/u.test(value);
}

function selected(editor: MermaidWysiwygEditor, kind: string): string | null {
  return editor.selection.find((id) => id.startsWith(`${kind}:`)) ?? null;
}

/** Toolbar surface handed back to the mount layer so canvas gestures can reuse it. */
interface ToolbarHandle {
  destroy(): void;
  setMutationBusy(busy: boolean): void;
}

function appendToolbar(
  parent: HTMLElement,
  editor: MermaidWysiwygEditor,
  sourceKind: "flowchart" | "sequence",
  text: EditorMessageTranslator,
  reportError: (message: string) => void,
  onInputBusyChange: (busy: boolean) => void,
): ToolbarHandle {
  const doc = parent.ownerDocument;
  const toolbar = doc.createElement("nav");
  toolbar.className = "cm-md-mermaid-graphical-toolbar";
  toolbar.setAttribute(
    "aria-label",
    sourceKind === "flowchart"
      ? text("editor.mermaid.flowchartTools", "流程图编辑工具")
      : text("editor.mermaid.sequenceTools", "时序图编辑工具"),
  );
  const status = doc.createElement("output");
  const actions = doc.createElement("div");
  actions.className = "cm-md-mermaid-graphical-toolbar__actions";
  const hint = doc.createElement("span");
  hint.className = "cm-md-mermaid-graphical-toolbar__hint";
  hint.textContent = text("editor.mermaid.selectElement", "选择图中元素以编辑");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  toolbar.append(status);
  const controls = new Map<HTMLButtonElement, () => string | null>();
  let cancelPendingInput: (() => void) | undefined;
  let pendingInputCount = 0;
  let mutationBusy = false;
  let mutationFocus: HTMLButtonElement | null = null;
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
    validate?: (values: readonly string[]) => string | null,
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
      confirm.textContent = text("editor.mermaid.confirm", "确定");
      const cancel = doc.createElement("button");
      cancel.type = "button";
      cancel.textContent = text("editor.mermaid.cancel", "取消");
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
          status.textContent = text(
            "editor.mermaid.addElementsFirst",
            "请先添加可选择的图表元素。",
          );
          reportError(status.textContent);
          return;
        }
        const invalidField = fields.find(
          (field, index) => !specs[index]?.choices && !isMermaidLabel(field.value),
        );
        if (invalidField) {
          status.textContent = text(
            "editor.mermaid.invalidLabel",
            "文字包含不支持的符号或换行，请使用单行文字和常规标点。",
          );
          reportError(status.textContent);
          invalidField.focus();
          return;
        }
        const values = fields.map((field) => field.value);
        const error = validate?.(values);
        status.textContent = error ?? "";
        if (!error) finish(values);
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
          if (!(keyEvent.target instanceof HTMLElement) || keyEvent.target.tagName !== "INPUT")
            return;
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
    const label =
      (await askFields([{ label: text("editor.mermaid.nodeText", "节点文字") }]))?.[0] ?? null;
    if (label !== null) editor.dispatch({ type: "addNode", label });
  };
  if (sourceKind === "flowchart") {
    add(text("editor.mermaid.addNode", "添加节点"), () => requestAddNode());
    add(
      text("editor.mermaid.connectNodes", "连接节点"),
      async () => {
        const choices = (editor.result.flowchart?.nodes ?? []).map(({ id, label }) => ({
          value: id,
          label: label || id,
        }));
        const source = selected(editor, "node")?.slice(5) ?? choices[0]?.value;
        const values = await askFields(
          [
            { label: text("editor.mermaid.edgeSource", "起点"), initial: source, choices },
            {
              label: text("editor.mermaid.edgeTarget", "终点"),
              initial: choices.find(({ value }) => value !== source)?.value,
              choices,
            },
          ],
          ([from, to]) =>
            from === to
              ? text("editor.mermaid.distinctEndpoints", "请选择不同的起点和终点。")
              : null,
        );
        if (values) editor.dispatch({ type: "connect", source: values[0]!, target: values[1]! });
      },
      () =>
        (editor.result.flowchart?.nodes.length ?? 0) < 2
          ? text("editor.mermaid.addTwoNodes", "请先添加两个节点")
          : null,
    );
    add(
      text("editor.mermaid.editNode", "修改节点文字"),
      async () => {
        const id = selected(editor, "node");
        const node = id && editor.result.flowchart?.nodeById.get(id.slice(5));
        const label = node
          ? ((
              await askFields([
                { label: text("editor.mermaid.nodeText", "节点文字"), initial: node.label },
              ])
            )?.[0] ?? null)
          : null;
        if (id && label !== null) editor.dispatch({ type: "renameNode", id: id.slice(5), label });
      },
      undefined,
      "node",
    );
    add(
      text("editor.mermaid.editEdge", "修改关系文字"),
      async () => {
        const id = selected(editor, "edge");
        const edge = id && editor.result.flowchart?.edges.find((item) => item.entityId === id);
        const label = edge
          ? ((
              await askFields([
                { label: text("editor.mermaid.edgeText", "关系文字"), initial: edge.label ?? "" },
              ])
            )?.[0] ?? null)
          : null;
        if (id && label !== null) editor.dispatch({ type: "setEdgeLabel", edgeId: id, label });
      },
      undefined,
      "edge",
    );
    add(
      text("editor.mermaid.deleteEdge", "删除关系"),
      () => {
        const id = selected(editor, "edge");
        if (id) editor.dispatch({ type: "deleteEdge", edgeId: id });
      },
      () => (selected(editor, "edge") ? null : text("editor.mermaid.selectEdge", "先选择一条关系")),
      "edge",
    );
    add(
      text("editor.mermaid.deleteNode", "删除节点"),
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
        if (!id || !graph) return text("editor.mermaid.selectNode", "先选择一个节点");
        return null;
      },
      "node",
    );
  } else {
    add(text("editor.mermaid.addParticipant", "添加参与者"), async () => {
      const name =
        (await askFields([{ label: text("editor.mermaid.participantName", "参与者名称") }]))?.[0] ??
        null;
      if (name !== null) editor.dispatch({ type: "seq.addParticipant", name });
    });
    add(
      text("editor.mermaid.addMessage", "添加消息"),
      async () => {
        const choices = (editor.result.sequence?.participants ?? []).map((participant) => ({
          value: participant.id,
          label: participant.label,
        }));
        const values = await askFields([
          {
            label: text("editor.mermaid.sender", "发送方"),
            initial: selected(editor, "participant")?.slice(12),
            choices,
          },
          { label: text("editor.mermaid.receiver", "接收方"), initial: choices[1]?.value, choices },
          { label: text("editor.mermaid.messageText", "消息文字") },
        ]);
        if (values) {
          const [source, target, message] = values as [string, string, string];
          editor.dispatch({ type: "seq.addMessage", source, target, text: message });
        }
      },
      () =>
        (editor.result.sequence?.participants.length ?? 0) < 2
          ? text("editor.mermaid.addTwoParticipants", "请先添加两个参与者")
          : null,
    );
    add(
      text("editor.mermaid.editParticipant", "修改参与者名称"),
      async () => {
        const id = selected(editor, "participant");
        const person = id ? editor.result.sequence?.participantById.get(id.slice(12)) : undefined;
        const name = person
          ? ((
              await askFields([
                {
                  label: text("editor.mermaid.participantName", "参与者名称"),
                  initial: person.label,
                },
              ])
            )?.[0] ?? null)
          : null;
        if (id && person && name !== null) {
          editor.dispatch({ type: "seq.renameParticipant", id: id.slice(12), name });
        }
      },
      undefined,
      "participant",
    );
    add(
      text("editor.mermaid.editMessage", "修改消息文字"),
      async () => {
        const id = selected(editor, "event");
        const event = id
          ? editor.result.sequence?.events.find((item) => item.entityId === id)
          : undefined;
        if (id && event?.kind === "message") {
          const message =
            (
              await askFields([
                { label: text("editor.mermaid.messageText", "消息文字"), initial: event.stmt.text },
              ])
            )?.[0] ?? null;
          if (message !== null)
            editor.dispatch({ type: "seq.setEventText", eventId: id, text: message });
        }
      },
      undefined,
      "event",
    );
    add(
      text("editor.mermaid.deleteMessage", "删除消息"),
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
        return event?.kind === "message"
          ? null
          : text("editor.mermaid.selectMessage", "先选择一条消息");
      },
      "event",
    );
    add(
      text("editor.mermaid.deleteParticipant", "删除参与者"),
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
        if (!person) return text("editor.mermaid.selectParticipant", "先选择一个参与者");
        return null;
      },
      "participant",
    );
  }
  const refresh = (): void => {
    // Selection can change while a form is open; it must not unlock a second operation.
    for (const button of actions.querySelectorAll("button"))
      button.disabled = pendingInputCount > 0 || mutationBusy;
    for (const button of actions.querySelectorAll<HTMLButtonElement>("button[data-context]")) {
      button.hidden = !selected(editor, button.dataset.context!);
    }
    hint.hidden = editor.selection.length > 0;
    for (const [button, reasonFor] of controls) {
      const reason = reasonFor();
      button.disabled = pendingInputCount > 0 || mutationBusy || Boolean(reason);
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
  return {
    destroy: destroyToolbar,
    setMutationBusy(busy) {
      const focused = doc.activeElement;
      if (busy) {
        mutationFocus =
          focused instanceof HTMLButtonElement && actions.contains(focused) ? focused : null;
      }
      mutationBusy = busy;
      refresh();
      // Disabling the action during validation can temporarily move browser focus to the body.
      if (!busy && mutationFocus) {
        if (focused === doc.body || focused === mutationFocus) {
          const next =
            mutationFocus.hidden || mutationFocus.disabled
              ? actions.querySelector<HTMLButtonElement>("button:not([hidden]):not([disabled])")
              : mutationFocus;
          next?.focus();
        }
        mutationFocus = null;
      }
    },
  };
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
    const text = input.translateEditorMessage ?? fallbackText;
    const inspection = await inspectSource(input.source, text);
    if (input.signal?.aborted) return inertHandle;
    if (!inspection.supported)
      throw new Error(
        inspection.reason ?? text("editor.mermaid.unsupported", "此图表不支持图形编辑"),
      );
    const [{ MermaidWysiwygEditor }, { MermaidCanvasView }] = await Promise.all([
      loadVisimerCore(),
      loadVisimerDom(),
    ]);
    if (input.signal?.aborted) return inertHandle;
    const ownerDocument = input.container.ownerDocument;
    if (!styledDocuments.has(ownerDocument)) {
      const style = ownerDocument.createElement("style");
      style.dataset.mdMermaidGraphicalEditor = "";
      style.textContent = mermaidGraphicalEditorCss;
      ownerDocument.head.append(style);
      styledDocuments.add(ownerDocument);
    }
    let currentTheme = input.isDark;
    let destroyed = false;
    // `setReadOnly` is a single boolean shared by several owners (toolbar forms and
    // the inline placeholder). Tracking the lock sources instead of overwriting a
    // flag keeps one owner's release from unlocking another owner's lock.
    const readOnlyLocks = new Set<string>();
    const setReadOnlyLock = (owner: string, locked: boolean): void => {
      if (locked) readOnlyLocks.add(owner);
      else readOnlyLocks.delete(owner);
      view.setReadOnly(readOnlyLocks.size > 0);
    };
    const notifyBusy = (): void => input.onBusyChange?.(readOnlyLocks.size > 0);
    const reportError = (message: string): void => input.onError?.(new Error(message));
    const editor = createMermaidDraftEditor(MermaidWysiwygEditor, {
      source: input.source,
      isClosed: () => destroyed || input.signal?.aborted === true,
      onError: reportError,
      onBusy: (busy) => {
        setReadOnlyLock("validation", busy);
        toolbar.setMutationBusy(busy);
        notifyBusy();
      },
      validate: async (code) => {
        if (code.includes(String.fromCharCode(0)) || /^\s*(?:%%\{|click\b)/imu.test(code)) {
          return text("editor.mermaid.unsafeSource", "此更改包含无法安全编辑的 Mermaid 语法");
        }
        const result = await inspectSource(code, text);
        return result.supported
          ? null
          : (result.reason ?? text("editor.mermaid.unsupportedChange", "此更改不支持图形编辑"));
      },
      validateOperation: (draft, operation) => {
        const label =
          "label" in operation
            ? operation.label
            : "name" in operation
              ? operation.name
              : "text" in operation
                ? operation.text
                : undefined;
        if (label !== undefined && !isMermaidLabel(label)) {
          return text(
            "editor.mermaid.invalidLabel",
            "文字包含不支持的符号或换行，请使用单行文字和常规标点。",
          );
        }
        if (operation.type === "seq.renameParticipant") {
          const participants = draft.result.sequence?.participantById;
          const person = participants?.get(operation.id);
          if (person && !person.decl?.alias) {
            if (!safeIdentifier(operation.name)) {
              return text(
                "editor.mermaid.invalidParticipantId",
                "无别名参与者的 ID 只能使用字母、数字、点、下划线或短横线。",
              );
            }
            if (operation.name !== operation.id && participants?.has(operation.name)) {
              return text("editor.mermaid.duplicateParticipantId", "该参与者 ID 已被使用。");
            }
          }
        }
        return null;
      },
    });
    const sourceKind = editor.result.flowchart ? "flowchart" : "sequence";
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
      sourceKind,
      text,
      reportError,
      (busy) => {
        // Pending forms keep selection available but suspend competing canvas mutations.
        setReadOnlyLock("toolbar-form", busy);
        notifyBusy();
      },
    );
    // Drag handles give pointer users a direct way to connect nodes on the canvas.
    const connectHandles =
      sourceKind === "flowchart"
        ? installConnectHandles({ view, editor, container: canvas, text })
        : null;
    // Double-clicking empty canvas drops a dashed placeholder that takes a label
    // in place; committing appends the node (its position comes from the layout).
    // Nodes and edges keep their own double-click behaviour.
    const inlineNode =
      sourceKind === "flowchart"
        ? installInlineNodeCreation({
            editor,
            container: canvas,
            text,
            onError: reportError,
            // Keep a pending placeholder independent of form and validation locks.
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
    const onEditorChange = editor.on("change", ({ code }) => input.onChange(code));
    const handle: GraphicalCodeBlockEditorHandle = {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        input.signal?.removeEventListener("abort", abortHandle);
        canvas.removeEventListener("dblclick", onCanvasDoubleClick);
        inlineNode?.destroy();
        connectHandles?.destroy();
        toolbar.destroy();
        readOnlyLocks.clear();
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
