/**
 * 渲染性能护栏（防「每帧全量重算」回归）
 *
 * 背景：终端宽度截断 `truncateToWidth` 需要解析 ANSI 才能算显示宽度，实测 800 行文档
 * 里它独占 17.8ms/帧（整帧 21ms）——这是打字发黏的根因。修复靠两层内容键缓存
 * （md-view 的块上下文/行样式缓存 + 编辑器的截断结果缓存）。
 *
 * 断言方式：用「冷渲染 vs 复用缓存」的**比值**而不是绝对毫秒，避免 CI 机器快慢造成抖动。
 * 本机（2vCPU ARM）2000 行实测：冷 ~96ms、复用缓存 ~3.5ms、顶部编辑后 ~4.8ms。
 */
import { describe, expect, it } from "vitest";
import { MdEditor } from "../src/editor/md-editor.ts";

function makeDoc(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    if (i % 7 === 0) out.push(`## 小节 ${i}`);
    else if (i % 11 === 0) out.push("```ts\nconst a = 1;\n```");
    else out.push(`第 ${i} 行：**加粗** 与 \`代码\` 以及一段中文说明文字。`);
  }
  return out.join("\n");
}

function timeIt(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe("渲染性能护栏", () => {
  it("复用缓存的帧远快于冷渲染（比值护栏）", () => {
    const editor = new MdEditor({ initialText: makeDoc(2000) });
    const cold = timeIt(() => editor.render(100));
    const warm = timeIt(() => editor.render(100));
    expect(editor.render(100).length).toBeGreaterThan(2000);
    expect(warm).toBeLessThan(Math.max(5, cold / 5));
  });

  it("顶部编辑（块上下文需从第 0 行续扫）后一帧仍远快于冷渲染", () => {
    const editor = new MdEditor({ initialText: makeDoc(2000) });
    const cold = timeIt(() => editor.render(100));
    editor.handleInput("i");
    editor.handleInput("x"); // 在最顶部插入字符：最坏情况
    const afterEdit = timeIt(() => editor.render(100));
    expect(afterEdit).toBeLessThan(Math.max(8, cold / 3));
  });

  it("底部连续输入不随文档规模退化", () => {
    const editor = new MdEditor({ initialText: makeDoc(2000) });
    const cold = timeIt(() => editor.render(100));
    editor.handleInput("G");
    editor.handleInput("o"); // 末尾新起一行进入 insert
    const keystrokes: number[] = [];
    for (let i = 0; i < 20; i++) {
      keystrokes.push(
        timeIt(() => {
          editor.handleInput("x");
          editor.render(100);
        }),
      );
    }
    const avg = keystrokes.reduce((a, b) => a + b, 0) / keystrokes.length;
    expect(avg).toBeLessThan(Math.max(8, cold / 3));
  });

  it("行数增长不会让单帧退化为 O(全文重算)", () => {
    const small = new MdEditor({ initialText: makeDoc(200) });
    timeIt(() => small.render(100)); // 预热小文档
    const smallFrame = timeIt(() => {
      small.handleInput("i");
      small.handleInput("x");
      small.render(100);
    });

    const large = new MdEditor({ initialText: makeDoc(2000) });
    timeIt(() => large.render(100)); // 预热大文档
    const largeFrame = timeIt(() => {
      large.handleInput("i");
      large.handleInput("x");
      large.render(100);
    });

    // 文档大 10 倍，单帧不应超过小文档的 5 倍（全量重算会到 ~10 倍）
    expect(largeFrame).toBeLessThan(Math.max(10, smallFrame * 5));
  });
});
