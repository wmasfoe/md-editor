import { describe, expect, it } from "vitest";
import { headingMarkerEdit } from "../../src/../src/wysiwyg/head-level-control.ts";

describe("headingMarkerEdit(标题 H 控件 marker 重写)", () => {
  it("提升级别:## -> ####", () => {
    const edit = headingMarkerEdit("## 标题", 4);
    expect(edit).toEqual({ from: 0, to: 3, insert: "#### " });
  });

  it("降级级别:# -> ##", () => {
    const edit = headingMarkerEdit("# 标题", 2);
    expect(edit).toEqual({ from: 0, to: 2, insert: "## " });
  });

  it("转段落:删除 marker 与分隔空白", () => {
    const edit = headingMarkerEdit("### 标题", null);
    expect(edit).toEqual({ from: 0, to: 4, insert: "" });
  });

  it("保留行首缩进", () => {
    const edit = headingMarkerEdit("  # 标题", 3);
    // from 跳过缩进(2),to 覆盖 marker(1)+ 分隔空白(1)
    expect(edit).toEqual({ from: 2, to: 4, insert: "### " });
  });

  it("多个空格分隔也完整替换", () => {
    const edit = headingMarkerEdit("#  标题", 1);
    expect(edit).toEqual({ from: 0, to: 3, insert: "# " });
  });

  it("非标题行返回 null", () => {
    expect(headingMarkerEdit("普通段落", 2)).toBeNull();
    expect(headingMarkerEdit("```js", 2)).toBeNull();
    expect(headingMarkerEdit("", 2)).toBeNull();
  });
});
