import { expect, test, type Page } from "@playwright/test";

const ACCESSIBILITY_FIXTURE = [
  "Before",
  "",
  "```ts meta=1",
  "const wrapped = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';",
  "const second = 2;",
  "```",
  "",
  "After",
  "",
].join("\n");

async function openCodeBlock(page: Page): Promise<void> {
  await page.goto("/?surface=codemirror-editor");
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  await page.evaluate((markdown) => {
    window.__CODEMIRROR_EDITOR_E2E__?.replaceDocument(markdown, "wysiwyg");
    window.__CODEMIRROR_EDITOR_E2E__?.setCodeBlockLineNumbers(true);
  }, ACCESSIBILITY_FIXTURE);
  await expect(page.getByRole("toolbar", { name: "fenced code block actions" })).toHaveCount(1);
}

test.describe("CodeMirror M2 code-block accessibility", () => {
  test("M2C-A01/A05 exposes keyboard-reachable actions without fence syntax", async ({ page }) => {
    await page.setViewportSize({ width: 620, height: 520 });
    await openCodeBlock(page);

    const toolbar = page.getByRole("toolbar", { name: "fenced code block actions" });
    const language = page.getByRole("combobox", { name: "Code language" });
    const select = page.getByRole("button", { name: "Select code block body" });
    const copy = page.getByRole("button", { name: "Copy code block body" });
    const status = toolbar.getByRole("status");

    await expect(language).toHaveValue("typescript");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(
      page.locator('.cm-md-code-structural-line-hidden[aria-hidden="true"]'),
    ).toHaveCount(2);
    await expect(page.locator(".cm-content")).not.toContainText("```ts meta=1");

    await page.keyboard.press("Tab");
    await expect(page.locator(".cm-content")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(language).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(select).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(copy).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".cm-content")).toBeFocused();

    const markdown = await page.evaluate(
      () => window.__CODEMIRROR_EDITOR_E2E__?.getDiagnostics().renderer?.markdown,
    );
    expect(markdown).toBe(ACCESSIBILITY_FIXTURE);
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`M2C-A02-A04 keeps ${colorScheme} line numbers legible and chrome clear`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width: 480, height: 520 });
      await openCodeBlock(page);

      const wrapped = page.locator(".cm-md-code-line-numbered").first();
      await wrapped.click();
      const geometry = await page.locator(".cm-editor").evaluate((editor) => {
        const toolbar = editor.querySelector<HTMLElement>(".cm-md-code-toolbar");
        const firstBodyLine = editor.querySelector<HTMLElement>(".cm-md-code-line-numbered");
        const scroller = editor.querySelector<HTMLElement>(".cm-scroller");
        if (!toolbar || !firstBodyLine || !scroller) {
          throw new Error("Code-block visual geometry is unavailable.");
        }
        const walker = document.createTreeWalker(firstBodyLine, NodeFilter.SHOW_TEXT);
        let firstText: Text | null = null;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.textContent?.trim()) {
            firstText = node as Text;
            break;
          }
        }
        if (!firstText) {
          throw new Error("Code-block text geometry is unavailable.");
        }

        const pseudo = getComputedStyle(firstBodyLine, "::before");
        const root = getComputedStyle(document.documentElement);
        const bodyRect = firstBodyLine.getBoundingClientRect();
        const firstGlyph = document.createRange();
        firstGlyph.setStart(firstText, 0);
        firstGlyph.setEnd(firstText, 1);
        return {
          toolbarBottom: toolbar.getBoundingClientRect().bottom,
          bodyTop: bodyRect.top,
          bodyHeight: bodyRect.height,
          lineHeight: Number.parseFloat(getComputedStyle(firstBodyLine).lineHeight),
          outlineWidth: Number.parseFloat(getComputedStyle(firstBodyLine).outlineWidth),
          numberContent: pseudo.content,
          numberColor: pseudo.color,
          numberRight:
            bodyRect.left +
            Number.parseFloat(pseudo.insetInlineStart) +
            Number.parseFloat(pseudo.width),
          firstTokenLeft: firstGlyph.getBoundingClientRect().left,
          backgroundColor: root.getPropertyValue("--theme-bg").trim(),
          horizontalOverflow: scroller.scrollWidth > scroller.clientWidth + 1,
        };
      });

      expect(geometry.toolbarBottom).toBeLessThanOrEqual(geometry.bodyTop + 1);
      expect(geometry.bodyHeight).toBeGreaterThan(geometry.lineHeight);
      expect(geometry.outlineWidth).toBe(1);
      expect(geometry.numberContent).toBe('"1"');
      expect(geometry.numberRight).toBeLessThanOrEqual(geometry.firstTokenLeft);
      expect(geometry.horizontalOverflow).toBe(false);
      expect(contrastRatio(geometry.numberColor, geometry.backgroundColor)).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  }
});

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(parseColor(foreground));
  const backgroundLuminance = relativeLuminance(parseColor(background));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseColor(color: string): readonly [number, number, number] {
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (hex) {
    return [
      Number.parseInt(hex[1]!, 16),
      Number.parseInt(hex[2]!, 16),
      Number.parseInt(hex[3]!, 16),
    ];
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!rgb) {
    throw new Error(`Unsupported computed color: ${color}`);
  }
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

function relativeLuminance(color: readonly [number, number, number]): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}
