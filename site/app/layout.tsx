import type { Metadata } from "next";
import { Inter } from "next/font/google";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // 浏览器扩展可能会给根节点注入属性；站点本身无客户端动态渲染，这里只屏蔽外部属性噪声。
    <html lang="zh-CN" className={inter.variable} suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col font-sans">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
