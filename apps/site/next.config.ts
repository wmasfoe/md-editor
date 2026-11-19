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
  /**
   * Next 的 output file tracing 以 monorepo 根为 root。桌面端已改为 Rust GPUI，
   * `apps/desktop` 下不再有前端构建产物；仍然显式排除它，避免 Rust `target/`
   * （数万个文件）被 trace 进 server function 而撑破 Vercel 的单文件 10MB 上限。
   * 站点运行期只需要各应用的 CHANGELOG 文件。
   */
  outputFileTracingExcludes: {
    "*": ["../../apps/desktop/target/**", "apps/desktop/target/**"],
  },
  transpilePackages: [
    "@md-editor/changelog",
    "@md-editor/core",
    "@md-editor/app-ui",
    "@md-editor/plugin-sdk",
    "@md-editor/plugin-host",
    "@md-editor/mdx-plugins",
    "@md-editor/editor",
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
  async redirects() {
    return [
      {
        source: "/download",
        destination: "/#download",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
