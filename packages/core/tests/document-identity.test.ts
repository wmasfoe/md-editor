import { describe, expect, it } from "vitest";
import { resolveReplaceIntent } from "../src/document-identity.ts";

/**
 * U27 宿主共用路径规则：`resolveReplaceIntent`
 *
 * 该规则存在的理由（architect 终审残留）：移除渲染层身份推断后，未声明的宿主会
 * 回落 fail-safe `"different"` ⇒ 重开同一文件也会把视口归零（跨宿主回归）。
 * 三个宿主（desktop / web / utools）必须走同一条规则，避免各写一份而漂移。
 */
describe("U27 resolveReplaceIntent：宿主共用文档身份路径规则", () => {
  it("路径都非空且相同 ⇒ 同一篇文档（重开当前文件）", () => {
    expect(resolveReplaceIntent("/docs/a.md", "/docs/a.md")).toBe("same");
  });

  it("路径不同 ⇒ 换文档（即使内容可能相同）", () => {
    expect(resolveReplaceIntent("/docs/a.md", "/docs/b.md")).toBe("different");
  });

  it("当前文档未命名（null）⇒ 换文档（不允许把未命名文档当成同一篇）", () => {
    expect(resolveReplaceIntent(null, "/docs/a.md")).toBe("different");
  });

  it("即将装载的文档未命名（null）⇒ 换文档（新建/划词新建）", () => {
    expect(resolveReplaceIntent("/docs/a.md", null)).toBe("different");
    expect(resolveReplaceIntent(null, null)).toBe("different");
  });

  it("大小写/空白不做模糊匹配（路径比较必须是精确相等）", () => {
    expect(resolveReplaceIntent("/docs/a.md", "/docs/A.md")).toBe("different");
    expect(resolveReplaceIntent("/docs/a.md", "/docs/a.md ")).toBe("different");
  });
});
