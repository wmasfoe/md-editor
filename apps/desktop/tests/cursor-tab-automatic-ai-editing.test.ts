import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const desktopEditorSource = readFileSync(
  new URL("../src/components/DesktopCodeMirrorEditor.tsx", import.meta.url),
  "utf8",
);

describe("apps/desktop: Cursor Tab 流式单焦点统一 AI 编辑与 CAS 护栏", () => {
  // Case I-4: 输入防抖与单次调用
  it("Case I-4: 彻底废除先 fixGrammar 再 continueWriting 的串行双请求，统一调用 predictUnifiedEdit", () => {
    // 确保 useAutomaticAiEditing 中不再调用 fixGrammar
    const hookStart = desktopEditorSource.indexOf("function useAutomaticAiEditing");
    expect(hookStart).toBeGreaterThan(0);
    const hookSlice = desktopEditorSource.slice(hookStart);

    expect(hookSlice).not.toContain("desktopAiService.fixGrammar(");
    expect(hookSlice).toContain("desktopAiService.predictUnifiedEdit(");
    // 验证防抖延迟收敛至 400ms (本地) / 600ms (云端)
    expect(hookSlice).toMatch(/settings\.ai\.provider === "local" \? 400 : 600/u);
  });

  // Case I-5: 打字中断在途请求
  it("Case I-5: 用户键盘键入时立即 abort 正在进行的推理并清除旧定时器", () => {
    const hookSlice = desktopEditorSource.slice(
      desktopEditorSource.indexOf("function useAutomaticAiEditing"),
    );

    expect(hookSlice).toMatch(
      /if \(event\.transition\.kind !== "content" \|\| event\.transition\.origin\.kind !== "renderer"\) \{\s*return;\s*\}[\s\S]{0,250}if \(abortControllerRef\.current\) \{\s*abortControllerRef\.current\.abort\(\);/u,
    );
  });

  // Case I-6: 文档切换与模式切换清理
  it("Case I-6: document-replace 与 mode 切换时立即中止推理与定时器，防跨文档泄漏", () => {
    const hookSlice = desktopEditorSource.slice(
      desktopEditorSource.indexOf("function useAutomaticAiEditing"),
    );

    // document-replace 分支清理
    expect(hookSlice).toMatch(
      /if \(event\.transition\.kind === "document-replace"\) \{[\s\S]{0,350}if \(abortControllerRef\.current\) \{\s*abortControllerRef\.current\.abort\(\);/u,
    );

    // mode 模式切换分支清理
    expect(hookSlice).toMatch(
      /if \(event\.transition\.kind === "mode"\) \{[\s\S]{0,150}if \(abortControllerRef\.current\) \{\s*abortControllerRef\.current\.abort\(\);/u,
    );
  });

  // Case I-7: CAS 文档版本一致性校验 (防坐标漂移)
  it("Case I-7: 严格进行 CAS 文档版本一致性比对，若推理期间用户变动文档则安全丢弃", () => {
    const hookSlice = desktopEditorSource.slice(
      desktopEditorSource.indexOf("function useAutomaticAiEditing"),
    );

    // 锁定初始文档快照
    expect(hookSlice).toContain("const initialMarkdown = markdown;");
    // 异步返回后核验 CAS
    expect(hookSlice).toMatch(
      /const latestSnap = runtime\.document\.getSnapshot\(\);[\s\S]{0,100}if \(latestSnap\.markdown !== initialMarkdown\) \{\s*[\s\S]{0,200}return;\s*\}/u,
    );
  });
});
