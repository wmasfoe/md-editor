import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // liquid-glass-react 使用客户端 SVG filter / 鼠标跟踪，需纳入 transpile
  transpilePackages: ["liquid-glass-react"],
};

export default nextConfig;
