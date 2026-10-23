import { useLayoutEffect } from "react";
import { changeLanguage, useTranslation } from "@md-editor/i18n";
import { AboutContent } from "../components/about/AboutContent";
import { AppTitleBar, isMacPlatform } from "./AppWindowChrome";
import { appVersion, loadAppSettings } from "./settings/app-settings";
import { applyThemeBeforeWindowReveal } from "./settings/theme-css";
import { revealCurrentAboutWindow } from "../desktop/about-window";
import { APP_DISPLAY_NAME } from "../lib/app-name";

/**
 * 关于窗口入口：只呈现产品身份信息，不挂设置上下文
 * （避免为一个静态页面初始化更新检查、跨窗口同步等主窗口职责）。
 *
 * 窗口在 Rust 侧以 `visible(false)` 创建；这里先应用持久化主题与语言再显示，
 * 与设置窗口共用同一套「主题/语言就绪后首帧」策略。
 *
 * 语言必须显式设置：i18n 在模块加载时按系统语言自举，而原生窗口标题用的是持久化语言
 * （`detect_menu_locale` 读 settings.language）。不设置就会出现「窗口标题中文、正文英文」。
 */
export function AboutWindowApp() {
  const { t } = useTranslation();
  const shouldShowOverlayTitleBar = isMacPlatform();
  const title = t("about.windowTitle", { app: APP_DISPLAY_NAME });

  useLayoutEffect(() => {
    document.title = title;
  }, [title]);

  useLayoutEffect(() => {
    let disposed = false;
    let disposeTheme: (() => void) | undefined;

    void loadAppSettings()
      .then(async (settings) => {
        if (disposed) return;
        // 先对齐持久化语言，再应用主题；两者就绪后才显示窗口。
        await changeLanguage(settings.language);
        if (disposed) return;
        // StrictMode 重放时重复 show/focus 是幂等的。
        disposeTheme = applyThemeBeforeWindowReveal(
          settings.theme,
          revealCurrentAboutWindow,
        ).dispose;
      })
      .catch((error: unknown) => {
        // 设置读取失败不应该让窗口永久隐藏：退回浏览器默认主题直接显示。
        console.warn("关于窗口主题加载失败，使用默认主题", error);
        if (!disposed) void revealCurrentAboutWindow();
      });

    return () => {
      disposed = true;
      disposeTheme?.();
    };
  }, []);

  return (
    <main className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--theme-surface)]">
      <AppTitleBar
        title={title}
        isVisible={shouldShowOverlayTitleBar}
        hasWindowControlsInset
        titleAlign="center"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AboutContent version={appVersion()} />
      </div>
    </main>
  );
}
