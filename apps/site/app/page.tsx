import { headers } from "next/headers";
import { HomeContent } from "../components/home-content";
import {
  getAndroidChangelogEntries,
  getChangelogEntries,
  getIosChangelogEntries,
} from "../lib/changelog";
import { detectSitePlatform } from "../lib/platform";

export default async function HomePage() {
  const [latest] = getChangelogEntries();
  const [latestAndroid] = getAndroidChangelogEntries();
  const [latestIos] = getIosChangelogEntries();
  const userAgent = (await headers()).get("user-agent") ?? "";
  const initialPlatform = detectSitePlatform(userAgent);

  return (
    <HomeContent
      latest={latest}
      latestAndroid={latestAndroid}
      latestIos={latestIos}
      initialPlatform={initialPlatform}
    />
  );
}
