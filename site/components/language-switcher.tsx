"use client";

import { GlobeAltIcon } from "@heroicons/react/20/solid";
import { useI18n } from "../lib/i18n/context";

/**
 * Apple 官网风格语言切换器：
 * 1. 材质：亚克力毛玻璃底色 (backdrop-blur-md) + 微高光内阴影 (inset top border highlight)；
 * 2. 边框与阴影：细密石色边框 + Apple 级微柔投影 (0 1px 2px rgba(0,0,0,0.03))；
 * 3. 动效与触感：Apple 标志性点击缩放反馈 (active:scale-[0.96]) + 200ms 缓动过渡；
 * 4. 无障碍：符合 HIG 的 44px 最小触控热区包裹与原生焦点环 (focus-visible)。
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  const toggleLocale = () => {
    setLocale(locale === "zh" ? "en" : "zh");
  };

  const isZh = locale === "zh";
  const displayLabel = isZh ? "EN" : "中";
  const title = isZh ? "Switch to English" : "切换为中文";

  return (
    <button
      type="button"
      onClick={toggleLocale}
      aria-label={t.header.langSwitchAria}
      title={title}
      className="liquid-glass-button-light group relative inline-flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium tracking-tight text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas sm:h-8 sm:px-3 sm:text-[13px]"
    >
      <GlobeAltIcon
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-muted transition-colors duration-200 group-hover:text-ink"
      />
      <span className="font-semibold text-ink transition-colors duration-200">{displayLabel}</span>
    </button>
  );
}
