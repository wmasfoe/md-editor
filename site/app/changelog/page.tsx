import type { Metadata } from "next";
import { ChangelogContent } from "../../components/changelog-content";
import { getChangelogEntries } from "../../lib/changelog";
import { getModelChangelog } from "../../lib/model-changelog-source";

export const metadata: Metadata = {
  title: "更新记录",
};

export default async function ChangelogPage() {
  const entries = getChangelogEntries();
  const modelChangelog = await getModelChangelog();

  return <ChangelogContent entries={entries} modelChangelog={modelChangelog} />;
}
