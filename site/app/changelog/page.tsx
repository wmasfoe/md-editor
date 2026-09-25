import type { Metadata } from "next";
import { ChangelogContent } from "../../components/changelog-content";
import {
  getAndroidChangelogEntries,
  getDesktopChangelogEntries,
  getWebChangelogEntries,
} from "../../lib/changelog";
import { getModelChangelog } from "../../lib/model-changelog-source";

export const metadata: Metadata = {
  title: "更新记录",
};

/**
 * ISR 页面级缓存：5分钟后台重新生成。
 * 平时请求由边缘 CDN 直接提供缓存响应，一次读取全量复用，避免每次请求重复解析各端 CHANGELOG.md。
 */
export const revalidate = 300;

export default async function ChangelogPage() {
  const desktopEntries = getDesktopChangelogEntries("zh");
  const desktopEntriesEn = getDesktopChangelogEntries("en");
  const androidEntries = getAndroidChangelogEntries("zh");
  const androidEntriesEn = getAndroidChangelogEntries("en");
  const webEntries = getWebChangelogEntries("zh");
  const webEntriesEn = getWebChangelogEntries("en");
  const modelChangelog = await getModelChangelog();

  return (
    <ChangelogContent
      entries={desktopEntries}
      entriesEn={desktopEntriesEn}
      androidEntries={androidEntries}
      androidEntriesEn={androidEntriesEn}
      webEntries={webEntries}
      webEntriesEn={webEntriesEn}
      modelChangelog={modelChangelog}
    />
  );
}
