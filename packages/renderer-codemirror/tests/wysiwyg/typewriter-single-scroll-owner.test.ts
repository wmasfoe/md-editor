import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 结构护栏（审计指出的缺口）：**单滚动所有权**。
 *
 * 验收要求「遵守单滚动所有权」（一个 EditorView / 一个 scroller，禁止第二个滚动容器）。
 * 此前只有行为级验证（E29/E30 在 `.cm-scroller` 上观察），**无结构级断言** ——
 * 本测试从源码锁定：打字机模块**只写 CM 自己的 `scrollDOM.scrollTop`**，
 * 不得创建/插入任何 DOM 容器，也不得使用其它滚动 API（`scrollTo/scrollBy/window.scroll`）。
 */
const SOURCE = readFileSync(
  fileURLToPath(new URL("../../src/wysiwyg/typewriter-mode.ts", import.meta.url)),
  "utf-8",
);

/** renderer 级扫描根（架构师终审驱动项 3：不变量不能只管一个模块） */
const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));

/** 允许写 scrollTop 的文件（白名单，每条写明理由） */
const SCROLLTOP_WRITERS: Record<string, string> = {
  "renderer.ts": "renderer 适配层：自身 scroller 的读写与 setScrollTop 端口",
  "typewriter-mode.ts": "打字机模式自身（本文件即其结构护栏）",
  "code-block-selection.ts": "代码块选区层读取（非写入其它容器）",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("打字机模式：单滚动所有权（结构级护栏）", () => {
  it("只写 scrollDOM.scrollTop；不创建/插入 DOM 容器；不用其它滚动 API", () => {
    expect(SOURCE, "不得创建 DOM 元素（第二滚动容器的唯一来源）").not.toMatch(
      /createElement\(|innerHTML\s*=/,
    );
    expect(SOURCE, "不得插入 DOM").not.toMatch(/appendChild|insertBefore|append\(/);
    expect(SOURCE, "不得使用其它滚动 API").not.toMatch(
      /window\.scroll|\.scrollTo\(|\.scrollBy\(|document\.scrollingElement/,
    );
    const writes = SOURCE.match(/scrollDOM\.scrollTop\s*=/g) ?? [];
    expect(writes.length, "滚动写入必须且只能落在 CM 自己的 scrollDOM.scrollTop").toBeGreaterThan(
      0,
    );
  });

  it("AC-S6-b：光标移动走 animateTo（缓动），输入走即时写 —— 删除动画会让本测试变红", () => {
    // 行为级时序断言在本环境不可靠（CM 自身 nearest 滚动 + CDP 采样时序），
    // 故以**结构级**锁取代：`recenter` 必须在 immediate 分支直接写、
    // 其余分支调用 animateTo，且 animateTo 必须按 rAF 帧推进。
    expect(SOURCE, "必须保留 animateTo（缓动居中）").toMatch(/this\.animateTo\(view, target\)/);
    expect(SOURCE, "immediate 分支必须直接写（打字即时，AC W3）").toMatch(
      /this\.writeScrollTop\(view, target\)/,
    );
    expect(SOURCE, "animateTo 必须按 rAF 帧推进").toMatch(/animationFrame = scheduleFrame\(step\)/);
  });
  it("renderer 级：除白名单外不得出现任何 `.scrollTop =` 写入（防第二滚动容器）", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const name = file.split("/").pop() ?? file;
      if (SCROLLTOP_WRITERS[name] !== undefined) continue;
      const text = readFileSync(file, "utf-8");
      if (/\.scrollTop\s*=/.test(text)) offenders.push(name);
    }
    expect(
      offenders,
      "新增文件写 scrollTop 即意味着可能出现第二个滚动所有者；请加入白名单并写明理由，或改用统一滚动端口",
    ).toEqual([]);
  });

  it("白名单依据非空（防无声扩张）", () => {
    for (const [name, reason] of Object.entries(SCROLLTOP_WRITERS)) {
      expect(reason.length, `${name} 的白名单依据必须非空`).toBeGreaterThan(10);
    }
  });
});
