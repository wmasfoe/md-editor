import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { headers } from "next/headers";
import { InkWashFilter } from "../components/ink-wash-filter";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { getChangelogEntries } from "../lib/changelog";
import { buildDownloadCatalog } from "../lib/downloads";
import { detectLocaleFromHeader } from "../lib/i18n";
import { I18nProvider } from "../lib/i18n/context";
import { OFFICIAL_SITE_URL } from "../lib/site-links";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  adjustFontFallback: false,
  fallback: [],
});

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  axes: ["SOFT", "WONK", "opsz"],
  adjustFontFallback: false,
  fallback: [],
});

export const metadata: Metadata = {
  metadataBase: new URL(OFFICIAL_SITE_URL),
  title: {
    default: "Inkpoint",
    template: "%s · Inkpoint",
  },
  description: "Inkpoint（墨点）是简洁的本地 Markdown 和 MDX 桌面编辑器。",
};

// 覆盖刘海/底部指示条；themeColor 与 canvas 一致，减少移动端浏览器栏跳色。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#faf9f6",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const acceptLanguage = (await headers()).get("accept-language") ?? "";
  const initialLocale = detectLocaleFromHeader(acceptLanguage);
  const [latest] = getChangelogEntries();
  const catalog = latest ? buildDownloadCatalog(latest.version, initialLocale) : null;

  return (
    // 浏览器扩展可能会给根节点注入属性；这里只屏蔽外部属性噪声。
    <html
      lang={initialLocale === "zh" ? "zh-CN" : "en"}
      className={`${inter.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col font-sans">
        <I18nProvider initialLocale={initialLocale}>
          <InkWashFilter />
          <SiteHeader catalog={catalog} />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </I18nProvider>
      </body>
    </html>
  );
}
