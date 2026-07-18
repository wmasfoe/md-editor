import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

const FIXTURE_PATH = "/fixtures/m1-s2-media.md";
const FIXTURE_MARKDOWN = [
  "# Media",
  "",
  'Before [label](https://example.com "title") after.',
  "",
  '![failed preview](missing-image.png "Caption")',
  "",
  "---",
  "",
  "Setext visual",
  "=============",
  "",
  "Default <https://explicit.example> and https://bare.example/path.",
  "",
  "[reference label][ref]",
  "",
  '[ref]: https://reference.example "Reference"',
  "",
  "[^note]",
  "",
  "[^note]: Footnote body",
  "",
  "```md",
  "https://raw.example [^raw]",
  "```",
  "",
  "| value |",
  "| --- |",
  "| [^table] |",
  "",
  "<div>[^html]</div>",
  "",
  '<Component value="[^mdx]" />',
  "",
  "Tail",
  "",
].join("\n");
const CORE_MARKDOWN = [
  "---",
  "title: Core matrix",
  "---",
  "# Heading",
  "Paragraph with **bold**, *italic*, ~~strike~~, and `code`.",
  "> Quote",
  "- First item",
  "  - Nested item",
  "1. Ordered",
  "- [ ] Todo",
  "",
  'Before [label](https://example.com "title") after.',
  "",
  '![failed preview](missing-image.png "Caption")',
  "",
  "---",
  "",
  "Setext visual",
  "=============",
  "",
  "Default <https://explicit.example>.",
  "",
  "Tail",
  "",
].join("\n");
const IMAGE_SOURCE = '![failed preview](missing-image.png "Caption")';
const FOOTNOTE_SOURCE = "[^note]";
const EDITED_FOOTNOTE_SOURCE = "[^edited]";
const COPY_KEY = process.platform === "darwin" ? "Meta+c" : "Control+c";
const PASTE_KEY = process.platform === "darwin" ? "Meta+v" : "Control+v";
const SELECT_ALL_KEY = process.platform === "darwin" ? "Meta+a" : "Control+a";
const ADD_SELECTION_MODIFIER = process.platform === "darwin" ? "Meta" : "Control";
const UNDO_KEY = process.platform === "darwin" ? "Meta+z" : "Control+z";

test.describe("CodeMirror M1/S2 link, image, and thematic-break surface", () => {
  test.beforeEach(async ({ context, page }) => {
    await grantClipboard(context);
    await openFixture(page);
  });

  test("E01-E02: initial projection and line activity preserve exact visible syntax policy", async ({
    page,
  }) => {
    await loadMarkdown(page, CORE_MARKDOWN);
    await expect(page.locator(".cm-editor")).toHaveCount(1);
    await expect(page.locator(".cm-md-frontmatter-header")).toBeHidden();
    await expect(page.locator(".cm-md-marker--bold")).toHaveCount(2);
    await expect(page.locator(".cm-md-marker--italic")).toHaveCount(2);
    await expect(page.locator(".cm-md-marker--strikethrough")).toHaveCount(2);
    await expect(page.locator(".cm-md-marker--inline-code")).toHaveCount(2);
    await expect(page.locator(".cm-md-heading--level-1")).toContainText("Heading");
    await expect(page.locator(".cm-md-marker--heading-atx")).toHaveCount(0);
    await expect(page.locator(".cm-md-block-marker--quote")).toHaveCount(1);
    await expect(page.locator(".cm-md-block-marker--list-item-unordered")).toHaveCount(3);
    await expect(page.locator(".cm-md-block-marker--list-item-ordered")).toHaveCount(1);
    await expect(page.locator(".cm-md-task-checkbox")).toHaveCount(1);
    await expect(page.locator(".cm-md-link-label")).toHaveText("label");
    await expect(page.locator(".cm-md-image-widget")).toHaveCount(1);
    await expect(page.locator(".cm-md-thematic-break-widget")).toHaveCount(1);
    await expect(page.locator(".cm-md-default-atom")).toHaveCount(2);

    await clickLineText(page, lineWithText(page, "Heading"), "Heading");
    const headingSelection = (await diagnostics(page)).renderer!;
    const headingFrom = CORE_MARKDOWN.indexOf("Heading");
    expect(headingSelection.selectionAnchor).toBeGreaterThanOrEqual(headingFrom);
    expect(headingSelection.selectionAnchor).toBeLessThanOrEqual(headingFrom + "Heading".length);
    await expect(page.locator(".cm-md-marker--heading-atx")).toHaveText("#");
    await clickLineText(page, lineWithText(page, "Paragraph with"), "Paragraph");
    await expect(page.locator(".cm-md-marker--heading-atx")).toHaveCount(0);
    expect((await diagnostics(page)).renderer).toMatchObject({
      markdown: CORE_MARKDOWN,
      viewCreationCount: 1,
      stateReplacementCount: 1,
    });
  });

  test("E02b: long lines wrap without horizontal editor scrolling in both modes", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 620, height: 520 });
    const markdown = `Wrapped paragraph ${"x".repeat(500)} end.\n`;
    await loadMarkdown(page, markdown);

    for (const mode of ["wysiwyg", "source"] as const) {
      await page.evaluate((nextMode) => window.__MD_EDITOR_E2E__!.setMode(nextMode), mode);
      const geometry = await page.locator(".cm-editor").evaluate((editor) => {
        const content = editor.querySelector<HTMLElement>(".cm-content");
        const line = editor.querySelector<HTMLElement>(".cm-line");
        const scroller = editor.querySelector<HTMLElement>(".cm-scroller");
        if (!content || !line || !scroller) {
          throw new Error("CodeMirror wrapping geometry is unavailable.");
        }
        return {
          contentClass: content.className,
          lineHeight: line.getBoundingClientRect().height,
          singleVisualLineHeight: Number.parseFloat(getComputedStyle(line).lineHeight),
          horizontalOverflow: scroller.scrollWidth - scroller.clientWidth,
          whiteSpace: getComputedStyle(content).whiteSpace,
        };
      });

      expect(geometry.contentClass).toContain("cm-lineWrapping");
      expect(geometry.whiteSpace).not.toBe("pre");
      expect(geometry.lineHeight).toBeGreaterThan(geometry.singleVisualLineHeight * 2);
      expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
    }
  });

  test("E03: list and task pointer/keyboard edits are structured and undoable", async ({
    page,
  }) => {
    await loadMarkdown(page, CORE_MARKDOWN);
    const content = page.locator(".cm-content");
    const checkbox = page.locator(".cm-md-task-checkbox");
    await expect(checkbox).toHaveAttribute("aria-checked", "false");
    await checkbox.click();
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(CORE_MARKDOWN.replace("- [ ] Todo", "- [x] Todo"));
    await content.press(UNDO_KEY);
    await expect.poll(async () => (await diagnostics(page)).renderer!.markdown).toBe(CORE_MARKDOWN);

    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setMode("source"));
    await clickLineText(page, lineWithText(page, "[ ] Todo"), "[ ] Todo");
    await content.press("Home");
    await content.press("ArrowRight");
    await content.press("ArrowRight");
    for (let index = 0; index < 3; index += 1) {
      await content.press("Shift+ArrowRight");
    }
    const taskFrom = CORE_MARKDOWN.indexOf("[ ] Todo");
    expect((await diagnostics(page)).renderer).toMatchObject({
      selectionAnchor: taskFrom,
      selectionHead: taskFrom + 3,
    });
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setMode("wysiwyg"));
    await content.press("Space");
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(CORE_MARKDOWN.replace("- [ ] Todo", "- [x] Todo"));
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await content.press(UNDO_KEY);

    await clickLineText(page, lineWithText(page, "First item"), "First item");
    const firstItemSelection = (await diagnostics(page)).renderer!;
    const firstItemFrom = CORE_MARKDOWN.indexOf("First item");
    expect(firstItemSelection.selectionAnchor).toBeGreaterThanOrEqual(firstItemFrom);
    expect(firstItemSelection.selectionAnchor).toBeLessThanOrEqual(
      firstItemFrom + "First item".length,
    );
    await content.press("Tab");
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toContain("  - First item");
    await content.press("Shift+Tab");
    await expect.poll(async () => (await diagnostics(page)).renderer!.markdown).toBe(CORE_MARKDOWN);

    await clickLineText(page, lineWithText(page, "First item"), "First item");
    await content.press("End");
    await content.press("Enter");
    await content.pressSequentially("Added");
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toContain("- First item\n- Added\n  - Nested item");
    await content.press(UNDO_KEY);
    await content.press(UNDO_KEY);
    await expect.poll(async () => (await diagnostics(page)).renderer!.markdown).toBe(CORE_MARKDOWN);

    await clickLineText(page, lineWithText(page, "First item"), "First item");
    await content.press("Home");
    await content.press("Backspace");
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toContain("First item\n  - Nested item");
    await content.press(UNDO_KEY);
    await expect.poll(async () => (await diagnostics(page)).renderer!.markdown).toBe(CORE_MARKDOWN);
  });

  test("E04: inactive links show only labels and reveal exact source when touched", async ({
    page,
  }) => {
    const before = await diagnostics(page);
    const label = page.locator(".cm-md-link-label");
    await expect(label).toHaveText("label");
    await expect(page.locator(".cm-content")).not.toContainText("https://example.com");

    await label.click();
    await expect(label).toHaveCount(0);
    await expect(page.locator(".cm-content")).toContainText('[label](https://example.com "title")');
    const active = await diagnostics(page);
    expect(active.renderer).toMatchObject({
      viewId: before.renderer!.viewId,
      stateEpochId: before.renderer!.stateEpochId,
      markdown: FIXTURE_MARKDOWN,
    });

    await page.locator(".cm-content").press("ArrowDown");
    await expect(page.locator(".cm-md-link-label")).toHaveText("label");
    await expect(page.locator(".cm-content")).not.toContainText("https://example.com");

    const twoLinks =
      "[first](https://one.example) and [second](https://two.example) remain exact.\n";
    await loadMarkdown(page, twoLinks);
    await page.locator(".cm-md-link-label").filter({ hasText: "first" }).click();
    await page
      .locator(".cm-md-link-label")
      .filter({ hasText: "second" })
      .click({ modifiers: [ADD_SELECTION_MODIFIER] });
    await expect(page.locator(".cm-md-link-label")).toHaveCount(0);
    await expect(page.locator(".cm-content")).toContainText("https://one.example");
    await expect(page.locator(".cm-content")).toContainText("https://two.example");
    expect((await diagnostics(page)).renderer).toMatchObject({
      markdown: twoLinks,
      selectionRangeCount: 2,
    });
  });

  test("E05: failed images remain selectable, source-faithful, and atom-deletable", async ({
    page,
  }) => {
    const image = page.locator(".cm-md-image-widget");
    await expect(image).toHaveCount(1);
    await expect(image).toHaveAttribute("role", "img");
    await expect(image).toHaveAttribute("aria-label", /preview unavailable/u);
    await expect(image).toHaveClass(/cm-md-image-widget--failed/u);
    await expect(image.locator(".cm-md-image-widget__placeholder-title")).toHaveText(
      "Image unavailable",
    );
    await expect(image.locator(".cm-md-image-widget__placeholder-alt")).toHaveText(
      "failed preview",
    );
    await expect(image.locator(".cm-md-image-widget__placeholder-source")).toHaveText(
      "missing-image.png",
    );
    await expect(image).toHaveCSS("border-top-width", "0px");
    await expect(image).toHaveCSS("border-radius", "0px");
    await expect(image).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    await image.click();
    await expect(image).toHaveCount(1);
    await expect(image).toHaveClass(/cm-md-image-widget--active/u);
    await expect(image).toHaveClass(/cm-md-image-widget--selected/u);
    await expect(image).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".cm-content")).toContainText(IMAGE_SOURCE);
    const selected = await diagnostics(page);
    const imageFrom = FIXTURE_MARKDOWN.indexOf(IMAGE_SOURCE);
    expect(selected.renderer).toMatchObject({
      markdown: FIXTURE_MARKDOWN,
      selectionAnchor: imageFrom,
      selectionHead: imageFrom + IMAGE_SOURCE.length,
    });
    await page.locator(".cm-content").press(COPY_KEY);
    await expect.poll(() => readClipboard(page)).toBe(IMAGE_SOURCE);

    await page.locator(".cm-content").press("Backspace");
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(FIXTURE_MARKDOWN.replace(IMAGE_SOURCE, ""));
    await page.locator(".cm-content").press(UNDO_KEY);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(FIXTURE_MARKDOWN);

    await page.locator(".cm-content").press("ArrowRight");
    expect((await diagnostics(page)).renderer).toMatchObject({
      selectionAnchor: imageFrom + IMAGE_SOURCE.length,
      selectionHead: imageFrom + IMAGE_SOURCE.length,
    });
    await expect(image).toHaveCount(1);
    await page.locator(".cm-content").press("ArrowLeft");
    expect((await diagnostics(page)).renderer).toMatchObject({
      selectionAnchor: imageFrom + IMAGE_SOURCE.length - 1,
      selectionHead: imageFrom + IMAGE_SOURCE.length - 1,
    });
    await expect(image).toHaveClass(/cm-md-image-widget--active/u);
    await expect(page.locator(".cm-content")).toContainText(IMAGE_SOURCE);
    await page.locator(".cm-content").press("ArrowRight");
    expect((await diagnostics(page)).renderer).toMatchObject({
      selectionAnchor: imageFrom + IMAGE_SOURCE.length,
      selectionHead: imageFrom + IMAGE_SOURCE.length,
    });
  });

  test("E05b: an active image keeps its rendered preview while source updates live", async ({
    page,
  }) => {
    const markdown = "![Application icon](/favicon.svg)\n";
    const edited = "![Application icon](/favicon.svg?revision=2)\n";
    await loadMarkdown(page, markdown);
    const image = page.locator(".cm-md-image-widget");
    const renderedImage = image.locator("img");
    await expect(renderedImage).toBeVisible();

    await image.click();
    await expect(page.locator(".cm-content")).toContainText(markdown.trim());
    await expect(image).toHaveClass(/cm-md-image-widget--active/u);
    await expect(renderedImage).toBeVisible();

    const result = await page.evaluate((nextMarkdown) => {
      return window.__MD_EDITOR_E2E__!.applyExternalEdit(nextMarkdown);
    }, edited);
    expect(result.status).toBe("applied");
    await expect(page.locator(".cm-content")).toContainText(edited.trim());
    await expect(image).toHaveClass(/cm-md-image-widget--active/u);
    await expect(renderedImage).toBeVisible();
    await expect(renderedImage).toHaveAttribute("src", "/favicon.svg?revision=2");
    expect((await diagnostics(page)).renderer).toMatchObject({
      markdown: edited,
      viewCreationCount: 1,
    });
  });

  test("E05c: vertical keyboard entry reveals image source without losing the caret or preview", async ({
    page,
  }) => {
    const scenarios = [
      { source: "![Failed preview](missing-keyboard-image.png)", failed: true },
      { source: "![Application icon](/favicon.svg)", failed: false },
    ] as const;

    for (const scenario of scenarios) {
      for (const direction of ["forward", "backward"] as const) {
        const markdown = `Before\n${scenario.source}\nAfter\n`;
        const imageFrom = markdown.indexOf(scenario.source);
        await loadMarkdown(page, markdown);
        const image = page.locator(".cm-md-image-widget");
        await expect(image).toHaveCount(1);
        if (scenario.failed) {
          await expect(image).toHaveClass(/cm-md-image-widget--failed/u);
        } else {
          await expect(image.locator("img")).toBeVisible();
        }

        const startingText = direction === "forward" ? "Before" : "After";
        await clickLineText(page, lineWithText(page, startingText), startingText);
        const content = page.locator(".cm-content");
        await content.press(direction === "forward" ? "End" : "Home");
        await content.press(direction === "forward" ? "ArrowDown" : "ArrowUp");

        await expect(content).toContainText(scenario.source);
        await expect(image).toHaveClass(/cm-md-image-widget--active/u);
        if (scenario.failed) {
          await expect(image.locator(".cm-md-image-widget__placeholder")).toBeVisible();
        } else {
          await expect(image.locator("img")).toBeVisible();
        }
        const renderer = (await diagnostics(page)).renderer!;
        expect(renderer.selectionAnchor).toBe(renderer.selectionHead);
        expect(renderer.selectionHead).toBeGreaterThan(imageFrom);
        expect(renderer.selectionHead).toBeLessThan(imageFrom + scenario.source.length);
        expect(
          await page.evaluate(() => document.activeElement?.classList.contains("cm-content")),
        ).toBe(true);
      }
    }
  });

  test("E06: thematic breaks stay visual, expose selection state, and delete exactly", async ({
    page,
  }) => {
    const thematicBreak = page.locator(".cm-md-thematic-break-widget");
    await expect(thematicBreak).toHaveCount(1);
    await expect(thematicBreak).toHaveAttribute("role", "separator");
    await expect(thematicBreak).toHaveAttribute("aria-selected", "false");

    await thematicBreak.click();
    await expect(thematicBreak).toHaveAttribute("aria-selected", "true");
    await expect(thematicBreak).toHaveClass(/cm-md-thematic-break-widget--selected/u);
    await page.locator(".cm-content").press(COPY_KEY);
    await expect.poll(() => readClipboard(page)).toBe("---");

    await page.locator(".cm-content").press("Delete");
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(FIXTURE_MARKDOWN.replace("---", ""));
    await page.locator(".cm-content").press(UNDO_KEY);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(FIXTURE_MARKDOWN);
    await expect(page.locator(".cm-md-thematic-break-widget")).toHaveCount(1);

    await thematicBreak.click();
    const from = FIXTURE_MARKDOWN.indexOf("---");
    await page.locator(".cm-content").press("ArrowRight");
    await page.locator(".cm-content").press("ArrowLeft");
    expect((await diagnostics(page)).renderer).toMatchObject({
      selectionAnchor: from + 3,
      selectionHead: from,
    });
  });

  test("E06b: vertical keyboard movement selects every thematic-break variant", async ({
    page,
  }) => {
    for (const marker of ["---", "***", "___"] as const) {
      for (const direction of ["forward", "backward"] as const) {
        const markdown = `Before\n\n${marker}\nAfter\n`;
        const from = markdown.indexOf(marker);
        await loadMarkdown(page, markdown);
        const thematicBreak = page.locator(".cm-md-thematic-break-widget");
        const startingText = direction === "forward" ? "Before" : "After";
        await clickLineText(page, lineWithText(page, startingText), startingText);
        const content = page.locator(".cm-content");
        await content.press(direction === "forward" ? "End" : "Home");
        await content.press(direction === "forward" ? "ArrowDown" : "ArrowUp");
        if (direction === "forward") {
          await content.press("ArrowDown");
        }

        await expect(thematicBreak).toHaveAttribute("aria-selected", "true");
        await expect(thematicBreak).toHaveClass(/cm-md-thematic-break-widget--selected/u);
        expect((await diagnostics(page)).renderer).toMatchObject(
          direction === "forward"
            ? { selectionAnchor: from, selectionHead: from + marker.length }
            : { selectionAnchor: from + marker.length, selectionHead: from },
        );
        expect(
          await page.evaluate(() => document.activeElement?.classList.contains("cm-content")),
        ).toBe(true);
      }
    }
  });

  test("E07-E08: forward/reverse cross-block drag copies and replaces underlying Markdown", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await loadMarkdown(page, CORE_MARKDOWN);
    const content = page.locator(".cm-content");
    const quote = lineWithText(page, "Quote");
    const tail = lineWithText(page, "Tail");

    const forward = await dragSelection(page, quote, tail, "forward");
    expect(forward.anchor).toBeLessThan(forward.head);
    expect(CORE_MARKDOWN.slice(forward.from, forward.to)).toContain(IMAGE_SOURCE);
    expect(CORE_MARKDOWN.slice(forward.from, forward.to)).toContain("\n---\n");
    await content.press(COPY_KEY);
    await expect
      .poll(() => readClipboard(page))
      .toBe(CORE_MARKDOWN.slice(forward.from, forward.to));

    await clickLineText(page, lineWithText(page, "Tail"), "Tail");
    const reverse = await dragSelection(page, quote, tail, "reverse");
    expect(reverse.anchor).toBeGreaterThan(reverse.head);
    await content.press(COPY_KEY);
    await expect
      .poll(() => readClipboard(page))
      .toBe(CORE_MARKDOWN.slice(reverse.from, reverse.to));

    await writeClipboard(page, "replacement");
    await content.press(PASTE_KEY);
    const replaced =
      CORE_MARKDOWN.slice(0, reverse.from) + "replacement" + CORE_MARKDOWN.slice(reverse.to);
    await expect.poll(async () => (await diagnostics(page)).renderer!.markdown).toBe(replaced);
    await content.press(UNDO_KEY);
    await expect.poll(async () => (await diagnostics(page)).renderer!.markdown).toBe(CORE_MARKDOWN);

    await clickLineText(page, lineWithText(page, "Tail"), "Tail");
    const frontmatter = await dragSelection(
      page,
      lineWithText(page, "title: Core matrix"),
      lineWithText(page, "Paragraph with"),
      "forward",
    );
    expect(CORE_MARKDOWN.slice(frontmatter.from, frontmatter.to)).toContain("\n---\n# Heading");
    await content.press(COPY_KEY);
    await expect
      .poll(() => readClipboard(page))
      .toBe(CORE_MARKDOWN.slice(frontmatter.from, frontmatter.to));

    await clickLineText(page, lineWithText(page, "Tail"), "Tail");
    const reverseFrontmatter = await dragSelection(
      page,
      lineWithText(page, "title: Core matrix"),
      lineWithText(page, "Paragraph with"),
      "reverse",
    );
    expect(reverseFrontmatter.anchor).toBeGreaterThan(reverseFrontmatter.head);
    await content.press(COPY_KEY);
    await expect
      .poll(() => readClipboard(page))
      .toBe(CORE_MARKDOWN.slice(reverseFrontmatter.from, reverseFrontmatter.to));
  });

  test("E09-E10: disjoint directional ranges survive modes, rerenders, preview, and scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    const longMarkdown = `${CORE_MARKDOWN}${Array.from(
      { length: 50 },
      (_, index) => `Filler line ${index + 1}\n`,
    ).join("")}`;
    await loadMarkdown(page, longMarkdown);
    const content = page.locator(".cm-content");
    await dragWithinLine(page, lineWithText(page, "Paragraph with"), "reverse");
    await page.keyboard.down(ADD_SELECTION_MODIFIER);
    await dragWithinLine(page, lineWithText(page, "Tail"), "forward");
    await page.keyboard.up(ADD_SELECTION_MODIFIER);

    const before = await diagnostics(page);
    expect(before.renderer!.selectionRangeCount).toBe(2);
    expect(before.renderer!.selectionRanges.map((range) => range.anchor > range.head)).toEqual([
      true,
      false,
    ]);
    await page.locator(".cm-scroller").evaluate((scroller) => {
      scroller.scrollTop = 500;
      scroller.dispatchEvent(new Event("scroll"));
    });
    const scrolled = await diagnostics(page);
    expect(scrolled.renderer!.scrollTop).toBeGreaterThan(0);

    await page.evaluate(async () => {
      await window.__MD_EDITOR_E2E__!.setMode("source");
      await window.__MD_EDITOR_E2E__!.setMode("wysiwyg");
      window.__MD_EDITOR_E2E__!.triggerParentRerender();
    });
    await expect(page.getByRole("alert")).toContainText("E2E rerender");
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setAssetPreviewVisible(true));
    await expect(
      page.getByLabel("Markdown 编辑器").locator(".code-mirror-editor-host"),
    ).toHaveAttribute("aria-hidden", "true");
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setAssetPreviewVisible(false));
    const after = await diagnostics(page);
    expect(after.renderer).toMatchObject({
      viewId: before.renderer!.viewId,
      stateEpochId: before.renderer!.stateEpochId,
      markdown: before.renderer!.markdown,
      selectionRangeCount: 2,
      selectionRanges: before.renderer!.selectionRanges,
      undoDepth: before.renderer!.undoDepth,
      redoDepth: before.renderer!.redoDepth,
      focused: true,
    });
    await expect
      .poll(async () => {
        const restored = await diagnostics(page);
        return Math.abs(restored.renderer!.scrollTop - scrolled.renderer!.scrollTop);
      })
      .toBeLessThanOrEqual(1);
    await content.press("x");
    const edited = await diagnostics(page);
    expect(edited.renderer!.selectionRangeCount).toBe(2);
    expect(edited.renderer!.undoDepth).toBe(before.renderer!.undoDepth + 1);
    await content.press(UNDO_KEY);
    await expect.poll(async () => (await diagnostics(page)).renderer!.markdown).toBe(longMarkdown);
  });

  test("E11: malformed syntax stays raw and a same-document repair restores projection", async ({
    page,
  }) => {
    const malformed = "# Broken\n\nBefore [label](unterminated\n\n![image](missing.png\n\nTail\n";
    await loadMarkdown(page, malformed);
    const initial = await diagnostics(page);
    expect(initial.renderer!.markdown).toBe(malformed);
    await expect(page.locator(".cm-content")).toContainText("[label](unterminated");
    await expect(page.locator(".cm-content")).toContainText("[image](missing.png");
    await expect(page.locator(".cm-md-link-label")).toHaveCount(0);
    await expect(page.locator(".cm-md-image-widget")).toHaveCount(0);

    const repaired =
      '# Repaired\n\nBefore [label](https://example.com "title")\n\n![image](missing.png)\n\nTail\n';
    const result = await page.evaluate(
      (markdown) => window.__MD_EDITOR_E2E__!.applyExternalEdit(markdown),
      repaired,
    );
    expect(result.status).toBe("applied");
    await expect(page.locator(".cm-md-link-label")).toHaveText("label");
    await expect(page.locator(".cm-md-image-widget")).toHaveCount(1);
    const after = await diagnostics(page);
    expect(after.renderer).toMatchObject({
      viewId: initial.renderer!.viewId,
      stateEpochId: initial.renderer!.stateEpochId,
      markdown: repaired,
    });
    expect(after.renderer!.wysiwyg.dirtyBlockRebuildCount).toBeGreaterThan(
      initial.renderer!.wysiwyg.dirtyBlockRebuildCount,
    );
  });

  test("E13: projected controls expose roles, names, state, and editor-owned focus", async ({
    page,
  }) => {
    await loadMarkdown(page, CORE_MARKDOWN);
    const content = page.locator(".cm-content");
    const task = page.getByRole("checkbox", { name: "Toggle task" });
    await expect(task).toHaveAttribute("tabindex", "-1");
    await expect(task).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("img", { name: /failed preview/u })).toHaveCount(1);
    await expect(page.getByRole("separator", { name: "Thematic break" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await expect(page.locator(".cm-md-frontmatter-header")).toBeHidden();
    await expect(
      page.locator(".cm-md-frontmatter-header input, .cm-md-frontmatter-header textarea"),
    ).toHaveCount(0);

    await content.click();
    await expect(content).toBeFocused();
    await task.click();
    await expect(task).toHaveAttribute("aria-checked", "true");
    await expect(content).toBeFocused();
    await content.press(UNDO_KEY);

    const defaultAtom = page.locator('.cm-md-default-atom[data-syntax-kind="autolink"]');
    await defaultAtom.click();
    await expect(defaultAtom).toHaveAttribute("aria-selected", "true");
    await content.press("Delete");
    await expect(page.locator(".cm-announced")).toContainText(
      "This Markdown syntax can only be edited in source mode.",
    );
  });

  test("E07-E08: broad selection preserves source clipboard and defers native deletion", async ({
    page,
  }) => {
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setMode("source"));
    const content = page.locator(".cm-content");
    await content.click();
    await content.press(SELECT_ALL_KEY);
    const selected = await diagnostics(page);
    expect(selected.renderer).toMatchObject({
      selectionAnchor: 0,
      selectionHead: FIXTURE_MARKDOWN.length,
    });

    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setMode("wysiwyg"));
    const wysiwyg = await diagnostics(page);
    expect(wysiwyg.renderer).toMatchObject({
      viewId: selected.renderer!.viewId,
      stateEpochId: selected.renderer!.stateEpochId,
      selectionAnchor: 0,
      selectionHead: FIXTURE_MARKDOWN.length,
      markdown: FIXTURE_MARKDOWN,
    });
    await content.press(COPY_KEY);
    await expect.poll(() => readClipboard(page)).toBe(FIXTURE_MARKDOWN);

    await content.press("Backspace");
    await expect.poll(async () => (await diagnostics(page)).renderer!.markdown).toBe("");
    await content.press(UNDO_KEY);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(FIXTURE_MARKDOWN);
  });

  test("E01-AC14: supported defaults visualize while deferred syntax remains raw", async ({
    page,
  }) => {
    const defaults = page.locator(".cm-md-default-atom");
    await expect(defaults).toHaveCount(7);
    await expect(page.locator('.cm-md-default-atom[data-syntax-kind="heading-setext"]')).toHaveText(
      "Setext visual",
    );
    await expect(page.locator('.cm-md-default-atom[data-syntax-kind="autolink"]')).toHaveCount(2);
    await expect(
      page.locator('.cm-md-default-atom[data-syntax-kind="reference-link"]'),
    ).toContainText("reference label");
    await expect(
      page.locator('.cm-md-default-atom[data-syntax-kind="reference-definition"]'),
    ).toContainText("https://reference.example");
    await expect(page.locator('.cm-md-default-atom[data-syntax-kind="footnote"]')).toHaveCount(2);

    const content = page.locator(".cm-content");
    await expect(content).toContainText("```md");
    await expect(content).toContainText("https://raw.example [^raw]");
    await expect(content).toContainText("| [^table] |");
    await page.locator(".cm-scroller").evaluate((scroller) => {
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event("scroll"));
    });
    await expect(content).toContainText("<div>[^html]</div>");
    await expect(content).toContainText('<Component value="[^mdx]" />');
  });

  test("AC14: exact default edits are announced and source mode remains editable and undoable", async ({
    page,
  }) => {
    const footnote = page
      .locator('.cm-md-default-atom[data-syntax-kind="footnote"]')
      .filter({ hasText: /^note$/u });
    await footnote.click();
    const from = FIXTURE_MARKDOWN.indexOf(FOOTNOTE_SOURCE);
    await expect(footnote).toHaveAttribute("aria-selected", "true");
    expect((await diagnostics(page)).renderer).toMatchObject({
      selectionAnchor: from,
      selectionHead: from + FOOTNOTE_SOURCE.length,
      markdown: FIXTURE_MARKDOWN,
    });
    await page.locator(".cm-content").press(COPY_KEY);
    await expect.poll(() => readClipboard(page)).toBe(FOOTNOTE_SOURCE);

    await page.locator(".cm-content").press("Delete");
    expect((await diagnostics(page)).renderer).toMatchObject({
      selectionAnchor: from,
      selectionHead: from + FOOTNOTE_SOURCE.length,
      markdown: FIXTURE_MARKDOWN,
    });
    await expect(page.locator(".cm-announced")).toContainText(
      "This Markdown syntax can only be edited in source mode.",
    );

    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setMode("source"));
    await page.locator(".cm-content").pressSequentially(EDITED_FOOTNOTE_SOURCE);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(FIXTURE_MARKDOWN.replace(FOOTNOTE_SOURCE, EDITED_FOOTNOTE_SOURCE));
    await page.locator(".cm-content").press(UNDO_KEY);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(FIXTURE_MARKDOWN);
  });
});

async function openFixture(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从一篇文档开始" })).toBeVisible();
  await page.evaluate((path) => window.__MD_EDITOR_E2E__!.openFixture(path), FIXTURE_PATH);
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  await expect
    .poll(async () => (await diagnostics(page)).renderer?.markdown)
    .toBe(FIXTURE_MARKDOWN);
}

async function grantClipboard(context: BrowserContext): Promise<void> {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:4173",
  });
}

async function diagnostics(page: Page) {
  return page.evaluate(() => window.__MD_EDITOR_E2E__!.getDiagnostics());
}

async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

async function writeClipboard(page: Page, value: string): Promise<void> {
  await page.evaluate((text) => navigator.clipboard.writeText(text), value);
}

async function loadMarkdown(page: Page, markdown: string): Promise<void> {
  await page.evaluate(
    (source) => window.__MD_EDITOR_E2E__!.replaceDocument(source, "/fixtures/m1-core-matrix.md"),
    markdown,
  );
  await expect.poll(async () => (await diagnostics(page)).renderer?.markdown).toBe(markdown);
  await expect(page.locator(".cm-editor")).toHaveCount(1);
}

function lineWithText(page: Page, text: string): Locator {
  return page.locator(".cm-line").filter({ hasText: text }).first();
}

async function clickLineText(page: Page, line: Locator, text: string): Promise<void> {
  const point = await line.evaluate((element, target) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const content = node.textContent ?? "";
      const index = content.indexOf(target);
      if (index >= 0) {
        const range = document.createRange();
        const offset = index + Math.floor(target.length / 2);
        range.setStart(node, offset);
        range.setEnd(node, Math.min(offset + 1, content.length));
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      node = walker.nextNode();
    }
    return null;
  }, text);
  if (!point) {
    throw new Error(`Editable text must be rendered before clicking: ${text}`);
  }
  await page.mouse.click(point.x, point.y);
}

async function dragSelection(
  page: Page,
  first: Locator,
  second: Locator,
  direction: "forward" | "reverse",
): Promise<{
  readonly anchor: number;
  readonly head: number;
  readonly from: number;
  readonly to: number;
}> {
  const start = direction === "forward" ? first : second;
  const end = direction === "forward" ? second : first;
  const startBox = await start.boundingBox();
  const endBox = await end.boundingBox();
  if (!startBox || !endBox) {
    throw new Error("Cross-block drag endpoints must be rendered.");
  }
  await page.mouse.move(startBox.x + startBox.width * 0.2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width * 0.8, endBox.y + endBox.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  const probe = (await diagnostics(page)).renderer!;
  return {
    anchor: probe.selectionAnchor,
    head: probe.selectionHead,
    from: Math.min(probe.selectionAnchor, probe.selectionHead),
    to: Math.max(probe.selectionAnchor, probe.selectionHead),
  };
}

async function dragWithinLine(
  page: Page,
  line: Locator,
  direction: "forward" | "reverse",
): Promise<void> {
  const box = await line.boundingBox();
  if (!box) {
    throw new Error("Directional selection line must be rendered.");
  }
  const left = box.x + Math.min(24, box.width * 0.15);
  const right = box.x + Math.max(box.width - 4, box.width * 0.85);
  const startX = direction === "forward" ? left : right;
  const endX = direction === "forward" ? right : left;
  await page.mouse.move(startX, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(endX, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}
