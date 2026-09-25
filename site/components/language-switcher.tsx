"use client";

import { useEffect, useRef, useState } from "react";
import { LanguageIcon } from "@heroicons/react/20/solid";
import { useI18n } from "../lib/i18n/context";
import { LOCALE_FLAGS, LOCALE_LABELS, type Locale } from "../lib/i18n/types";

/**
 * 语言展示顺序（同参考图交互与习惯）：
 * 1. 🇺🇸 English
 * 2. 🇨🇳 简体中文
 * 3. 🇭🇰 繁體中文
 * 4. 🇯🇵 日本語
 */
const ORDERED_LOCALES: Locale[] = ["en", "zh", "zh-Hant", "ja"];

/**
 * Apple 风格下拉语言切换器：
 * - 触发按钮：文A 图标 (LanguageIcon)，带微交互触感反馈与聚焦环；
 * - 弹出层：精细亚克力毛玻璃 (backdrop-blur-xl) + 柔和投影 + 细边框；
 * - 选项条目：国旗图标 + 原生语言名称，当前选中项高亮圆角药丸底色；
 * - 交互与无障碍：支持点击外部关闭、ESC 键关闭、键盘焦点以及 ARIA 属性。
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // 点击外部与 ESC 键自动关闭
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (nextLocale: Locale) => {
    setLocale(nextLocale);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={t.header.langSwitchAria}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={t.header.langSwitchAria}
        className={`group relative inline-flex h-8 w-8 cursor-pointer select-none items-center justify-center rounded-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas sm:h-9 sm:w-9 ${
          isOpen
            ? "bg-surface-soft text-ink shadow-xs"
            : "text-muted hover:bg-surface-soft hover:text-ink active:scale-[0.96]"
        }`}
      >
        <LanguageIcon
          aria-hidden
          className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-105"
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label={t.header.langSwitchAria}
          className="absolute right-0 top-full z-50 mt-2 min-w-[150px] origin-top-right rounded-2xl border border-line/80 bg-surface/95 p-1.5 shadow-xl backdrop-blur-xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150"
        >
          {ORDERED_LOCALES.map((code) => {
            const isSelected = locale === code;
            return (
              <button
                key={code}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(code)}
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] sm:text-sm transition-all duration-150 ${
                  isSelected
                    ? "bg-accent/10 font-semibold text-accent"
                    : "font-normal text-ink-soft hover:bg-surface-soft hover:text-ink active:bg-surface-soft/80"
                }`}
              >
                <span className="text-base select-none leading-none shrink-0" aria-hidden>
                  {LOCALE_FLAGS[code]}
                </span>
                <span className="flex-1 truncate">{LOCALE_LABELS[code]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
