import { headers } from "next/headers";
import { HomeContent } from "../components/home-content";
import { getAndroidChangelogEntries, getChangelogEntries } from "../lib/changelog";
import { detectSitePlatform } from "../lib/platform";

export default async function HomePage() {
  const [latest] = getChangelogEntries();
  const [latestAndroid] = getAndroidChangelogEntries();
  const userAgent = (await headers()).get("user-agent") ?? "";
  const initialPlatform = detectSitePlatform(userAgent);

  return (
    <HomeContent latest={latest} latestAndroid={latestAndroid} initialPlatform={initialPlatform} />
  );
}
