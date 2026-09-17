import type { Metadata } from "next";
import { ReleasesContent } from "../../components/releases-content";
import { getReleasesData } from "../../lib/releases";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "版本分发中心 · 全平台客户端归档",
  description:
    "Inkpoint（墨点）全平台桌面端与移动端客户端历史版本归档，基于 Cloudflare R2 全球边缘加速直连分发。",
};

export default async function ReleasesPage() {
  const releasesData = await getReleasesData();

  return <ReleasesContent initialData={releasesData} />;
}
