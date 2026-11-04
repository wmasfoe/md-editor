/**
 * @file mouse-selection.test.ts
 * @description 验证 createRobustMouseSelectionExtension 针对行内标记首次点击展开时的选区行为。
 */
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  createRobustMouseSelectionExtension,
  DRAG_THRESHOLD_PX,
  type MouseSelectionViewContext,
} from "../../src/wysiwyg/input/mouse-selection.ts";

describe("createRobustMouseSelectionExtension", () => {
  it("无位移单击时，即使 DOM 发生重排或坐标偏移，依然保持单一折叠光标而不产生范围选中", () => {
    let mockPosAtCoordsCall = 0;
    const state = EditorState.create({
      doc: "等了一下 **7.15** 的节点",
      selection: EditorSelection.cursor(0),
      extensions: [createRobustMouseSelectionExtension()],
    });

    const mockView: MouseSelectionViewContext = {
      state,
      // 模拟视图坐标查询：第一次查询（mousedown）返回 14，第二次查询（mouseup 前 DOM 发生展开排版偏移）返回 12
      posAndSideAtCoords: () => {
        mockPosAtCoordsCall++;
        return { pos: mockPosAtCoordsCall === 1 ? 14 : 12, assoc: 1 };
      },
    };

    const mouseStyleFacet = state.facet(EditorView.mouseSelectionStyle);
    expect(mouseStyleFacet.length).toBeGreaterThan(0);

    const mousedownEvent = {
      button: 0,
      clientX: 100,
      clientY: 100,
      detail: 1, // 单击
    } as MouseEvent;

    const style = mouseStyleFacet[0](mockView as unknown as EditorView, mousedownEvent);
    expect(style).not.toBeNull();

    // 模拟纯单击完成（mouseup，无物理位移）
    const mouseupEvent = {
      button: 0,
      clientX: 100,
      clientY: 100,
      detail: 1,
    } as MouseEvent;

    const result = style!.get(mouseupEvent, false, false);
    // 关键断言：即使 posAndSideAtCoords 发生了 14 -> 12 的 DOM 排版偏移，因为没有真实拖拽，
    // 依然维持在按下的位置 14，决不会形成 12..14 的意外选区！
    expect(result.main.empty).toBe(true);
    expect(result.main.from).toBe(14);
    expect(result.main.to).toBe(14);
  });

  it("真实鼠标拖拽（位移 >= 阈值）时正常产生范围选区", () => {
    let mockCoords = 14;
    const state = EditorState.create({
      doc: "等了一下 **7.15** 的节点",
      selection: EditorSelection.cursor(0),
      extensions: [createRobustMouseSelectionExtension()],
    });

    const mockView: MouseSelectionViewContext = {
      state,
      posAndSideAtCoords: () => ({ pos: mockCoords, assoc: 1 }),
    };

    const mouseStyleFacet = state.facet(EditorView.mouseSelectionStyle);
    const mousedownEvent = {
      button: 0,
      clientX: 100,
      clientY: 100,
      detail: 1,
    } as MouseEvent;

    const style = mouseStyleFacet[0](mockView as unknown as EditorView, mousedownEvent);
    expect(style).not.toBeNull();

    // 拖拽位移达到 10px >= DRAG_THRESHOLD_PX，且光标移动到 20
    mockCoords = 20;
    const dragEvent = {
      button: 0,
      clientX: 100 + DRAG_THRESHOLD_PX + 5,
      clientY: 100,
      detail: 1,
    } as MouseEvent;

    const result = style!.get(dragEvent, false, false);
    expect(result.main.empty).toBe(false);
    expect(result.main.from).toBe(14);
    expect(result.main.to).toBe(20);
    expect(result.main.anchor).toBe(14);
    expect(result.main.head).toBe(20);
    expect(result.main.anchor).toBeLessThan(result.main.head); // 正向拖拽

    // 反向拖拽：光标从 14 移动到 5
    mockCoords = 5;
    const reverseDragEvent = {
      button: 0,
      clientX: 100 - (DRAG_THRESHOLD_PX + 5),
      clientY: 100,
      detail: 1,
    } as MouseEvent;
    const reverseResult = style!.get(reverseDragEvent, false, false);
    expect(reverseResult.main.empty).toBe(false);
    expect(reverseResult.main.from).toBe(5);
    expect(reverseResult.main.to).toBe(14);
    expect(reverseResult.main.anchor).toBe(14);
    expect(reverseResult.main.head).toBe(5);
    expect(reverseResult.main.anchor).toBeGreaterThan(reverseResult.main.head); // 反向拖拽方向性严格保留
  });

  it("双击选词与三击选行在无拖拽下正确执行", () => {
    const state = EditorState.create({
      doc: "hello world\nsecond line",
      selection: EditorSelection.cursor(0),
      extensions: [createRobustMouseSelectionExtension()],
    });

    const mockView: MouseSelectionViewContext = {
      state,
      posAndSideAtCoords: () => ({ pos: 2, assoc: 1 }), // "hello" 内
    };

    const mouseStyleFacet = state.facet(EditorView.mouseSelectionStyle);
    const doubleClickEvent = {
      button: 0,
      clientX: 50,
      clientY: 50,
      detail: 2, // 双击
    } as MouseEvent;

    const doubleStyle = mouseStyleFacet[0](mockView as unknown as EditorView, doubleClickEvent);
    const doubleResult = doubleStyle!.get(doubleClickEvent, false, false);
    // 选中整个单词 "hello" (0..5)
    expect(doubleResult.main.from).toBe(0);
    expect(doubleResult.main.to).toBe(5);

    const tripleClickEvent = {
      button: 0,
      clientX: 50,
      clientY: 50,
      detail: 3, // 三击
    } as MouseEvent;

    const tripleStyle = mouseStyleFacet[0](mockView as unknown as EditorView, tripleClickEvent);
    const tripleResult = tripleStyle!.get(tripleClickEvent, false, false);
    // 选中第一整行含换行符 (0..12)
    expect(tripleResult.main.from).toBe(0);
    expect(tripleResult.main.to).toBe(12);
  });
});
