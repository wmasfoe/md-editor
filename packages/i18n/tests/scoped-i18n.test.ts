import { describe, expect, it } from "vitest";
import { getI18n, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";
import { configureI18n, createI18nScope, ensureI18nInitialized, t as translate } from "../src/i18n";

describe("independent host translations", () => {
  it("restores its own resources when an initially injected instance is cleared", async () => {
    const host = createInstance();
    await host.init({ lng: "en", resources: { en: { translation: { host: "HOST" } } } });
    const scope = createI18nScope({ instance: host });
    expect(scope.t("host")).toBe("HOST");
    scope.configure({ instance: undefined });
    await scope.changeLanguage("en");
    expect(scope.instance).not.toBe(host);
    expect(scope.t("common.save")).toBe("Save");
  });

  it("keeps instances and language changes isolated without replacing the React default", async () => {
    const previous = getI18n();
    const first = createI18nScope();
    const second = createI18nScope();
    await first.changeLanguage("en");
    await second.changeLanguage("zh");
    expect(first.t("common.save")).toBe("Save");
    expect(second.t("common.save")).toBe("保存");
    await first.changeLanguage("ja");
    expect(second.getCurrentLocale()).toBe("zh");
    expect(first.instance).not.toBe(second.instance);
    expect(getI18n()).toBe(previous);
  });
});

it("renders each provider through its own instance without initializing the application scope", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { I18nextProvider, useTranslation } = await import("../src/index");
  const previous = getI18n();
  const first = createI18nScope();
  const second = createI18nScope();
  expect(first.instance.isInitialized).toBeFalsy();
  await first.changeLanguage("en");
  await second.changeLanguage("zh");
  function Label() {
    const { t } = useTranslation();
    return createElement("span", null, t("common.save"));
  }
  const render = (scope: typeof first) =>
    renderToStaticMarkup(
      createElement(I18nextProvider, { i18n: scope.instance }, createElement(Label)),
    );
  expect(render(first)).toBe("<span>Save</span>");
  expect(render(second)).toBe("<span>保存</span>");
  await first.changeLanguage("ja");
  expect(render(second)).toBe("<span>保存</span>");
  expect(getI18n()).toBe(previous);
});

it("does not reclaim a host React default on repeated facade calls or providerless renders", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { useTranslation } = await import("../src/index");
  const application = ensureI18nInitialized("en");
  const host = createInstance();
  await host.init({ lng: "en", resources: { en: { translation: { host: "HOST" } } } });
  initReactI18next.init(host);
  function Label() {
    const { t } = useTranslation();
    return createElement("span", null, t("common.save"));
  }
  try {
    expect(translate("common.save")).toBe("Save");
    expect(ensureI18nInitialized()).toBe(application);
    expect(renderToStaticMarkup(createElement(Label))).toBe("<span>Save</span>");
    expect(getI18n()).toBe(host);
    // Explicitly switching the application instance still registers the new one.
    configureI18n({ instance: host });
    expect(getI18n()).toBe(host);
    configureI18n({ instance: undefined });
    expect(getI18n()).toBe(application);
  } finally {
    configureI18n({ instance: undefined });
    initReactI18next.init(application);
  }
});
