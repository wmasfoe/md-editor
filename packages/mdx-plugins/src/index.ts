export { Callout, type CalloutProps, type CalloutTone } from "./callout/Callout.tsx";
export { calloutPlugin, officialMdxPlugins } from "./metadata.ts";

import { Callout } from "./callout/Callout.tsx";

export const officialMdxComponents = {
  Callout,
} as const;
