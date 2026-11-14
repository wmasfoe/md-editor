import { expect, test } from "@playwright/test";

const markdown = ":::tip 快捷键体验提示\n按下快捷键 **Mod-/** 即可切换模式。\n:::\n\n后续段落";

for (const fontSize of [16, 20]) {
  test(`directive header keeps one line of height during disclosure at ${fontSize}px`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#welcome-title")).toBeVisible();
    await page.evaluate(() => window.__MD_EDITOR_E2E__?.createNewDocument());
    await expect(page.locator(".cm-editor")).toHaveCount(1);
    await page.evaluate((source) => {
      window.__MD_EDITOR_E2E__?.replaceDocument(source, "/fixtures/directive.md", "wysiwyg");
    }, markdown);
    await expect
      .poll(() =>
        page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics().renderer?.markdown),
      )
      .toBe(markdown);
    await page.evaluate(
      (position) => window.__MD_EDITOR_E2E__?.setSelection(position, position),
      markdown.indexOf("按下"),
    );
    await page.locator(".cm-content").evaluate((element, size) => {
      (element as HTMLElement).style.fontSize = `${size}px`;
    }, fontSize);

    const header = page.locator(".cm-md-directive-line--first");
    const widget = header.locator(".cm-md-directive__header-content");
    await expect(widget).toBeVisible();
    const measure = () =>
      header.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        bodyTop: element.nextElementSibling!.getBoundingClientRect().top,
        lineHeight: parseFloat(getComputedStyle(element).lineHeight),
        padding: parseFloat(getComputedStyle(element).paddingTop),
        gap: parseFloat(getComputedStyle(element).paddingBottom),
      }));
    const rendered = await measure();
    // A header widget must not introduce anonymous block line boxes in a CM line.
    expect(rendered.height).toBeLessThanOrEqual(
      rendered.lineHeight + rendered.padding + rendered.gap + 1,
    );

    const footer = page.locator(".cm-md-directive-line--last");
    const footerBox = await footer.boundingBox();
    // The hidden closing fence contributes only the inset, matching the top.
    expect(Math.abs(footerBox!.height - rendered.padding)).toBeLessThanOrEqual(1);
    expect(rendered.gap).toBeLessThan(rendered.padding);
    const headerBox = await header.boundingBox();
    await page.screenshot({
      path: `/tmp/md-editor-callout-${fontSize}.png`,
      clip: {
        x: headerBox!.x,
        y: headerBox!.y,
        width: headerBox!.width,
        height: footerBox!.y + footerBox!.height - headerBox!.y,
      },
    });

    await widget.click();
    await expect(widget).toHaveCount(0);
    await expect(header).toHaveText(":::tip 快捷键体验提示");
    const source = await measure();
    expect(Math.abs(source.height - rendered.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(source.bodyTop - rendered.bodyTop)).toBeLessThanOrEqual(1);

    await page.evaluate(
      (position) => window.__MD_EDITOR_E2E__?.setSelection(position, position),
      markdown.indexOf("按下"),
    );
    await expect(widget).toBeVisible();
    const restored = await measure();
    expect(Math.abs(restored.bodyTop - rendered.bodyTop)).toBeLessThanOrEqual(1);
    // Exercise the visible bottom inset, not only programmatic selection.
    await footer.click();
    await expect(footer).toHaveText(":::");
    expect(
      await footer.evaluate((element) => element.getBoundingClientRect().height),
    ).toBeGreaterThan(footerBox!.height);
  });
}

for (const body of [
  "",
  "\n> 编辑器原生支持 GitHub Flavored Markdown 警示块（`> [!NOTE]`、`> [!TIP]`、`> [!IMPORTANT]`、`> [!WARNING]`、`> [!CAUTION]`），与 GitHub、Obsidian 的写法一致。",
]) {
  test(`GFM alert header reveals editable source with ${body ? "wrapped body" : "no body"}`, async ({
    page,
  }) => {
    const heading = "> [!NOTE] GFM 官方 Alert 警示块";
    const source = `上方段落\n${heading}${body}\n\n后续段落`;
    await page.goto("/");
    await expect(page.locator("#welcome-title")).toBeVisible();
    await page.evaluate(() => window.__MD_EDITOR_E2E__?.createNewDocument());
    await expect(page.locator(".cm-editor")).toHaveCount(1);
    await page.evaluate(
      (text) => window.__MD_EDITOR_E2E__?.replaceDocument(text, "/fixtures/alert.md", "wysiwyg"),
      source,
    );
    await expect
      .poll(() =>
        page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics().renderer?.markdown),
      )
      .toBe(source);
    await page.locator(".cm-content").evaluate((element) => {
      (element as HTMLElement).style.maxWidth = "640px";
    });
    await page.evaluate(
      (position) => window.__MD_EDITOR_E2E__?.setSelection(position, position),
      source.length,
    );
    const widget = page.locator(".cm-md-directive__header-content");
    const header = page.locator(".cm-md-alert--first");
    await expect(widget).toBeVisible();
    if (body) {
      const geometry = await page
        .locator(".cm-md-alert")
        .nth(1)
        .evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          lineHeight: parseFloat(getComputedStyle(element).lineHeight),
          padding: parseFloat(getComputedStyle(element).paddingBottom),
        }));
      expect(geometry.height - geometry.padding).toBeGreaterThan(geometry.lineHeight + 1);
    }
    await widget.click();
    await expect(widget).toHaveCount(0);
    await expect(header).toHaveText(heading);
    // Typing must pass through the source protection/atomic-range pipeline.
    await page.keyboard.type(" updated");
    const edited = source.replace(heading, `${heading} updated`);
    await expect
      .poll(() =>
        page.evaluate(() => window.__MD_EDITOR_E2E__?.getDiagnostics().renderer?.markdown),
      )
      .toBe(edited);
    await page.evaluate(
      (position) => window.__MD_EDITOR_E2E__?.setSelection(position, position),
      edited.length,
    );
    await expect(widget).toHaveText("GFM 官方 Alert 警示块 updated");
    // ArrowDown enters the header from above; it must not skip to body content.
    await page.evaluate(() => window.__MD_EDITOR_E2E__?.setSelection(0, 0));
    await page.keyboard.press("ArrowDown");
    await expect(widget).toHaveCount(0);
    await expect(header).toHaveText(`${heading} updated`);
    // A GFM Alert has no closing fence; never synthesize directive syntax.
    expect(edited).not.toContain(":::");
    if (body) {
      await page.evaluate(
        (position) => window.__MD_EDITOR_E2E__?.setSelection(position, position),
        edited.indexOf("编辑器"),
      );
      await expect(widget).toBeVisible();
      await page.keyboard.press("ArrowUp");
      await expect(widget).toHaveCount(0);
    }
  });
}
