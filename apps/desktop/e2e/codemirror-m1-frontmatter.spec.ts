import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const FIXTURE_PATH = "/fixtures/m1-frontmatter.md";
const FIXTURE_MARKDOWN = [
  "---",
  "# exact source comment",
  'title: "Exact title"',
  "defaults: &defaults enabled",
  "copy: *defaults",
  "---",
  "# Body",
  "",
  "<div>HTML stays raw</div>",
  "",
  '<Component value="MDX stays raw" />',
  "",
].join("\n");
const COPY_KEY = process.platform === "darwin" ? "Meta+c" : "Control+c";
const SELECT_ALL_KEY = process.platform === "darwin" ? "Meta+a" : "Control+a";
const UNDO_KEY = process.platform === "darwin" ? "Meta+z" : "Control+z";

test.describe("CodeMirror M1 Frontmatter panel", () => {
  test.beforeEach(async ({ context, page }) => {
    await grantClipboard(context);
    await openFixture(page);
  });

  test("FM-E01: projects exact top Frontmatter inside the only CodeMirror editor", async ({
    page,
  }) => {
    const before = await diagnostics(page);
    const header = page.locator(".cm-md-frontmatter-header");
    await expect(page.locator(".cm-editor")).toHaveCount(1);
    await expect(header).toBeHidden();
    await expect(header.locator(".cm-md-frontmatter-header__title")).toHaveCount(0);
    await expect(header.locator(".cm-md-frontmatter-header__format")).toHaveCount(0);
    await expect(page.locator(".cm-md-frontmatter-line--body")).toHaveCount(4);
    await expect(page.locator(".cm-md-frontmatter-line--body").first()).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(page.locator(".cm-md-frontmatter-line--body").first()).toHaveCSS(
      "border-right-width",
      "0px",
    );
    await expect(page.locator(".cm-md-yaml-key")).toHaveCount(3);
    await expect(page.locator(".cm-md-yaml-comment")).toHaveText("# exact source comment");
    await expect(page.locator(".cm-md-yaml-anchor")).toHaveText("&defaults");
    await expect(page.locator(".cm-md-yaml-alias")).toHaveText("*defaults");
    await expect(
      header.locator("input, textarea, [contenteditable='true'], .cm-editor"),
    ).toHaveCount(0);
    await expect(page.locator(".cm-content")).not.toContainText("---");
    await expect(page.locator(".cm-content")).toContainText("<div>HTML stays raw</div>");
    await expect(page.locator(".cm-content")).toContainText('<Component value="MDX stays raw" />');
    expect(before.renderer).toMatchObject({
      markdown: FIXTURE_MARKDOWN,
      viewCreationCount: 1,
      stateReplacementCount: 0,
      mode: "wysiwyg",
    });
  });

  test("FM-E02: YAML body edits use native history while hidden fences remain exact", async ({
    page,
  }) => {
    const before = await diagnostics(page);
    const titleLine = page.locator(".cm-md-frontmatter-line--body").filter({
      hasText: 'title: "Exact title"',
    });
    await titleLine.click();
    await page.locator(".cm-content").press("End");
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setCompositionActive(true));
    await page.locator(".cm-content").pressSequentially("!");
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setCompositionActive(false));
    const editedMarkdown = FIXTURE_MARKDOWN.replace(
      'title: "Exact title"',
      'title: "Exact title"!',
    );
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(editedMarkdown);
    await expect(page.getByRole("status", { name: "YAML error" })).toBeVisible();
    const edited = await diagnostics(page);
    expect(edited.renderer).toMatchObject({
      viewId: before.renderer!.viewId,
      stateEpochId: before.renderer!.stateEpochId,
      viewCreationCount: 1,
    });
    expect(edited.renderer!.markdown.startsWith("---\n")).toBe(true);
    expect(edited.renderer!.markdown.includes("\n---\n# Body")).toBe(true);

    await page.locator(".cm-content").press(UNDO_KEY);
    await expect
      .poll(async () => (await diagnostics(page)).renderer!.markdown)
      .toBe(FIXTURE_MARKDOWN);
    await expect(page.locator(".cm-md-frontmatter-header")).toBeHidden();
  });

  test("FM-E03: source copy, mode changes, and malformed YAML preserve the same view and source", async ({
    page,
  }) => {
    const initial = await diagnostics(page);
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setMode("source"));
    const content = page.locator(".cm-content");
    await content.click();
    await content.press(SELECT_ALL_KEY);
    await page.evaluate(() => window.__MD_EDITOR_E2E__!.setMode("wysiwyg"));
    await content.press(COPY_KEY);
    await expect.poll(() => readClipboard(page)).toBe(FIXTURE_MARKDOWN);
    const projected = await diagnostics(page);
    expect(projected.renderer).toMatchObject({
      viewId: initial.renderer!.viewId,
      stateEpochId: initial.renderer!.stateEpochId,
      selectionAnchor: 0,
      selectionHead: FIXTURE_MARKDOWN.length,
      markdown: FIXTURE_MARKDOWN,
    });

    const invalid = "---\ntitle: [invalid\n---\n\n# Body\n";
    await page.evaluate(
      (markdown) =>
        window.__MD_EDITOR_E2E__!.replaceDocument(markdown, "/fixtures/invalid-frontmatter.md"),
      invalid,
    );
    await expect(page.getByRole("status", { name: "YAML error" })).toBeVisible();
    await expect(page.locator(".cm-md-yaml-error")).not.toHaveCount(0);
    expect((await diagnostics(page)).renderer).toMatchObject({
      viewId: initial.renderer!.viewId,
      markdown: invalid,
    });

    const unterminated = "---\ntitle: Missing fence\n";
    await page.evaluate(
      (markdown) =>
        window.__MD_EDITOR_E2E__!.replaceDocument(markdown, "/fixtures/unterminated.md"),
      unterminated,
    );
    await expect(page.locator(".cm-md-frontmatter-header")).toHaveAttribute(
      "aria-label",
      "Unterminated YAML",
    );
    await expect(page.locator(".cm-md-frontmatter-line--footer")).toHaveCount(0);
    expect((await diagnostics(page)).renderer).toMatchObject({
      viewId: initial.renderer!.viewId,
      markdown: unterminated,
    });
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
