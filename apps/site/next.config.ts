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
   * Next 的 output file tracing 以 monorepo 根为 root，会把整棵 `apps/desktop/src-tauri`
   * （Rust 源码 + `target/` 构建产物，约 6.5 万个文件）trace 进 server function，
   * 导致生成的 `.vc-config.json` 里的 filePathMap 达 ~16MB，超过 Vercel 单文件 10MB
   * 上传上限而部署失败。站点运行期只需要各应用的 CHANGELOG 文件，Rust 目录与本产物无关。
   */
  outputFileTracingExcludes: {
    "*": [
      "../../apps/desktop/src-tauri/**",
      "../../apps/desktop/src-tauri/**/*",
      "apps/desktop/src-tauri/**",
    ],
  },
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
