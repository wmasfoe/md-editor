import type { NextConfig } from "next";

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
};

export default nextConfig;
