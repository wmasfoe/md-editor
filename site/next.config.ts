import type { NextConfig } from "next";

/**
 * Web Playground 应用的目标地址。
 * - 生产环境：从环境变量 WEB_APP_URL 读取（例如 https://inkpoint-web.vercel.app）；
 * - 本地开发环境：默认代理至本地 Vite 启动端口 http://localhost:5174。
 */
const rawWebAppUrl =
  process.env.WEB_APP_URL ||
  (process.env.NODE_ENV === "development" ? "http://localhost:5174" : "");
const webAppUrl = rawWebAppUrl.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@md-editor/editor-core",
    "@md-editor/editor-ui",
    "@md-editor/mdx-component-registry",
    "@md-editor/mdx-plugins",
    "@md-editor/renderer-codemirror",
    "@md-editor/shared",
    "@md-editor/syntax-plugins",
  ],
  async rewrites() {
    if (!webAppUrl) {
      return [];
    }
    return [
      {
        source: "/playground",
        destination: `${webAppUrl}/playground/`,
      },
      {
        source: "/playground/:path*",
        destination: `${webAppUrl}/playground/:path*`,
      },
    ];
  },
};

export default nextConfig;
