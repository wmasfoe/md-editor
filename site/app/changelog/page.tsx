import type { Metadata } from "next";
import { ChangelogContent } from "../../components/changelog-content";
import { getDesktopChangelogEntries, getWebChangelogEntries } from "../../lib/changelog";
import { getModelChangelog } from "../../lib/model-changelog-source";

export const metadata: Metadata = {
  title: "更新记录",
};

export default async function ChangelogPage() {
  const desktopEntries = getDesktopChangelogEntries("zh");
  const desktopEntriesEn = getDesktopChangelogEntries("en");
  const webEntries = getWebChangelogEntries("zh");
  const webEntriesEn = getWebChangelogEntries("en");
  const modelChangelog = await getModelChangelog();

  return (
    <ChangelogContent
      entries={desktopEntries}
      entriesEn={desktopEntriesEn}
      webEntries={webEntries}
      webEntriesEn={webEntriesEn}
      modelChangelog={modelChangelog}
    />
  );
}
