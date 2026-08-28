import type { Metadata } from "next";
import { ChangelogContent } from "../../components/changelog-content";
import { getChangelogEntries } from "../../lib/changelog";

export const metadata: Metadata = {
  title: "更新记录",
};

export default function ChangelogPage() {
  const entries = getChangelogEntries();

  return <ChangelogContent entries={entries} />;
}
