/**
 * 渲染性能护栏（防「每帧全量重算」回归）
 *
 * 背景：终端宽度截断 `truncateToWidth` 需要解析 ANSI 才能算显示宽度，实测 800 行文档
 * 里它独占 17.8ms/帧（整帧 21ms）——这是打字发黏的根因。修复靠两层内容键缓存
 * （md-view 的块上下文/行样式缓存 + 编辑器的截断结果缓存）。
 *
 * 断言方式：
 * - 用**同进程内比值**（冷渲染 vs 缓存命中）而不是绝对毫秒。共享 runner 上并发跑全仓
 *   测试时，GC / 调度尖峰能把单次读数抬高 5~10 倍（实测同一个 2000 行帧中位 ~2ms、
 *   单次采样读到 22ms），绝对上限会因此误报，比值则不受机器快慢影响。
 * - 量级较小的帧耗时一律连采多次取最小值（见 `bestOf`）：尖峰只影响单次采样，
 *   算法性回归会让每一次采样都变慢，所以最小值既抗抖动、又不削弱护栏强度。
 * 本机（2vCPU ARM）2000 行实测：冷 ~90ms、复用缓存 ~2ms、顶部编辑后 ~2.2ms。
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

/** 连采 `samples` 次取最小值：剔除 GC / 调度尖峰，同时保留算法性回归的信号 */
function bestOf(samples: number, fn: () => void): number {
  let best = Infinity;
  for (let i = 0; i < samples; i++) best = Math.min(best, timeIt(fn));
  return best;
}

describe("渲染性能护栏", () => {
  it("复用缓存的帧远快于冷渲染（比值护栏）", () => {
    const editor = new MdEditor({ initialText: makeDoc(2000) });
    const cold = timeIt(() => editor.render(100));
    const warm = bestOf(5, () => editor.render(100));
    expect(editor.render(100).length).toBeGreaterThan(2000);
    expect(warm).toBeLessThan(Math.max(5, cold / 5));
  });

  it("顶部编辑（块上下文需从第 0 行续扫）后一帧仍远快于冷渲染", () => {
    const editor = new MdEditor({ initialText: makeDoc(2000) });
    const cold = timeIt(() => editor.render(100));
    const afterEdit = bestOf(5, () => {
      editor.handleInput("i");
      editor.handleInput("x"); // 在最顶部插入字符：最坏情况
      editor.render(100);
    });
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
    // 注意：`render()` 本身按文档行数遍历（缓存只让「每行」变便宜），所以「帧耗时与
    // 文档行数无关」不成立；而「大文档帧 / 小文档帧」的比值也判别不了回归——去掉缓存时
    // 两份文档会一起变慢，比值几乎不变。真正能判别的是同一份文档里
    // 「冷渲染（全量重算）」与「编辑后一帧（命中缓存）」的量级差：
    // 实测 2000 行冷渲染 ~90ms、缓存帧 ~2ms，差 40 倍以上；缓存退化时比值会趋近 1。
    const editor = new MdEditor({ initialText: makeDoc(2000) });
    const cold = timeIt(() => editor.render(100));
    const frame = bestOf(5, () => {
      editor.handleInput("i");
      editor.handleInput("x"); // 顶部编辑：块上下文必须从第 0 行续扫（最坏情况）
      editor.render(100);
    });
    expect(frame).toBeLessThan(cold / 5);
  });
});
