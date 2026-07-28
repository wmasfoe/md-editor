import { expect, test } from "@playwright/test";

test("numbers semantic code lines once when long source lines wrap", async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 520 });
  await page.goto("/?surface=code-block-line-numbers");
  await expect(page.locator(".cm-editor")).toHaveCount(1);

  const numberedLines = page.locator(".cm-line.cm-md-code-line-numbered");
  await expect(numberedLines).toHaveCount(5);
  await expect(page.locator(".cm-gutters, .cm-lineNumbers")).toHaveCount(0);

  const geometry = await page.locator(".cm-editor").evaluate((editor) => {
    const lines = [...editor.querySelectorAll<HTMLElement>(".cm-line")];
    const numbered = lines.filter((line) => line.dataset.mdCodeLineNumber);
    const ordinary = lines.filter((line) => !line.dataset.mdCodeLineNumber);
    const scroller = editor.querySelector<HTMLElement>(".cm-scroller")!;
    return {
      numbers: numbered.map((line) => line.dataset.mdCodeLineNumber),
      blockIds: numbered.map((line) => line.dataset.mdCodeBlockId),
      pseudoContent: numbered.map((line) => getComputedStyle(line, "::before").content),
      heights: numbered.map((line) => line.getBoundingClientRect().height),
      lineHeights: numbered.map((line) => Number.parseFloat(getComputedStyle(line).lineHeight)),
      ordinaryNumberAttributes: ordinary.filter((line) =>
        line.hasAttribute("data-md-code-line-number"),
      ).length,
      ordinaryPadding: ordinary.map((line) =>
        Number.parseFloat(getComputedStyle(line).paddingLeft),
      ),
      numberedPadding: numbered.map((line) =>
        Number.parseFloat(getComputedStyle(line).paddingLeft),
      ),
      horizontalOverflow: scroller.scrollWidth > scroller.clientWidth + 1,
    };
  });

  expect(geometry.numbers).toEqual(["1", "2", "3", "1", "2"]);
  expect(geometry.blockIds).toEqual(["typescript", "typescript", "typescript", "plain", "plain"]);
  expect(geometry.pseudoContent).toEqual(['"1"', '"2"', '"3"', '"1"', '"2"']);
  expect(geometry.heights[1]).toBeGreaterThan(geometry.lineHeights[1]! * 2);
  expect(geometry.heights[4]).toBeGreaterThan(geometry.lineHeights[4]! * 2);
  expect(geometry.ordinaryNumberAttributes).toBe(0);
  expect(Math.max(...geometry.ordinaryPadding)).toBeLessThan(Math.min(...geometry.numberedPadding));
  expect(geometry.horizontalOverflow).toBe(false);
});
