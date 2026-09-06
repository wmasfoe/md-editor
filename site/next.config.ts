import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@md-editor/editor-core",
    "@md-editor/editor-ui",
    "@md-editor/renderer-codemirror",
    "@md-editor/shared",
  ],
};

export default nextConfig;
