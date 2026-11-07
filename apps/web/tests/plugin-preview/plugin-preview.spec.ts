import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

const manifest = {
  id: "test.writer",
  name: "Writer",
  version: "1.0.0",
  description: "Trial writer",
  apiVersion: 1,
};
const pkg = {
  manifest,
  code: `export default { activate(ctx) { ctx.commands.register({ id: 'test.writer.insert', title: 'Insert', async run() { const s = ctx.editor.getSnapshot(); await ctx.editor.applyEdit({ markdown: s.markdown + (ctx.settings.get().loud ? '\\nLOUD' : '\\nadded'), expectedGeneration: s.documentGeneration, expectedContentRevision: s.contentRevision }); } }); ctx.keymaps.register({ id: 'test.writer.shortcut', key: 'Mod-Shift-Y', commandId: 'test.writer.insert' }); } }`,
  examples: [{ id: "sample", name: "Sample", markdown: "Hello" }],
  settings: { loud: { type: "boolean", label: "Loud", default: false } },
};
const bytes = JSON.stringify(pkg);
const digest = createHash("sha256").update(bytes).digest("hex");

test("only starts the selected verified plugin in the opaque guest", async ({ page }) => {
  const requests: string[] = [];
  await page.route("https://download.jiaqi.im/plugins/github/**", async (route) => {
    const url = route.request().url();
    requests.push(url);
    if (url.endsWith("/latest"))
      return route.fulfill({
        json: {
          id: 1,
          tag: "v1",
          assets: [
            { id: 2, name: "inkpoint-plugin.json", digest: null },
            { id: 3, name: "writer.json", digest: `sha256:${digest}` },
            { id: 4, name: "other.json", digest: null },
          ],
        },
        headers: { "access-control-allow-origin": "*" },
      });
    if (url.endsWith("/assets/2"))
      return route.fulfill({
        json: {
          schemaVersion: 1,
          plugins: [
            { ...manifest, asset: "writer.json" },
            { ...manifest, id: "test.other", name: "Other", asset: "other.json" },
          ],
        },
        headers: { "access-control-allow-origin": "*" },
      });
    if (url.endsWith("/assets/3"))
      return route.fulfill({ body: bytes, headers: { "access-control-allow-origin": "*" } });
    return route.abort();
  });
  await page.goto("/playground/plugins");
  await page.getByPlaceholder("owner/repository").fill("test/repo");
  await page.getByRole("button", { name: "查找插件" }).click();
  await page.getByRole("button", { name: "Writer · 1.0.0" }).click();
  await expect(page.getByText("Sample")).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "开始试用" }).click();
  const frame = page.frameLocator('iframe[title="插件试用"]');
  await expect(frame.getByRole("button", { name: "Insert" })).toBeVisible();
  await frame.getByRole("button", { name: "Insert" }).click();
  await expect(frame.locator(".cm-content")).toContainText("added");
  await frame.getByRole("button", { name: "撤销" }).click();
  await expect(frame.locator(".cm-content")).not.toContainText("added");
  await frame.getByLabel("Loud").check();
  await frame.locator(".cm-content").focus();
  const modifier = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
  );
  await page.keyboard.press(`${modifier}+Shift+Y`);
  await expect(frame.locator(".cm-content")).toContainText("LOUD");
  await frame.getByRole("button", { name: "停用插件" }).click();
  await expect(frame.getByRole("button", { name: "Insert" })).toHaveCount(0);
  expect(requests.filter((url) => url.includes("/assets/3"))).toHaveLength(1);
  expect(requests.some((url) => url.includes("/assets/4"))).toBe(false);
  expect(await page.locator("iframe").getAttribute("sandbox")).toBe("allow-scripts");
  const guest = page.frames().find((item) => item.url().includes("plugin-guest.html"))!;
  expect(
    await guest.evaluate(() => {
      try {
        return localStorage.length;
      } catch {
        return "blocked";
      }
    }),
  ).toBe("blocked");
  expect(
    await guest.evaluate(async () => {
      try {
        await fetch("https://example.com/");
        return "allowed";
      } catch {
        return "blocked";
      }
    }),
  ).toBe("blocked");
});
