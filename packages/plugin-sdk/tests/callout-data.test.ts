import { describe, expect, it } from "vitest";

import { CALLOUT_SVG_ICONS } from "../src/callout-data.ts";

describe("callout icons", () => {
  it("keeps fill-rule evenodd on the x-circle icons", () => {
    // 少了 evenodd 时，这条路径会被填成实心圆，HTML 导出和编辑器都会错。
    expect(CALLOUT_SVG_ICONS.danger).toContain('fill-rule="evenodd"');
    expect(CALLOUT_SVG_ICONS.caution).toContain('fill-rule="evenodd"');
  });
});
