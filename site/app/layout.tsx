import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { SiteBackdrop } from "../components/site-backdrop";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "Markdown Editor",
    template: "%s · Markdown Editor",
  },
  description: "简洁的本地 Markdown 和 MDX 桌面编辑器。",
};

// 覆盖刘海/底部指示条；themeColor 贴近深色 canvas，减少移动端浏览器栏跳色。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0a0f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // 浏览器扩展可能会给根节点注入属性；站点本身无客户端动态渲染，这里只屏蔽外部属性噪声。
    <html lang="zh-CN" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans">
        {/* 背景独立于内容树：liquid glass 折射这一层 */}
        <SiteBackdrop />
        {/*
          site-shell 禁止加 transform / isolation / filter：
          否则会切断子树 backdrop-filter 对固定背景的采样。
        */}
        <div className="site-shell">
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
