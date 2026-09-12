import { describe, expect, it } from "vitest";

import { describeSharedSpike, OFFICIAL_SITE_DOMAIN, OFFICIAL_SITE_URL } from "./index.ts";

describe("shared M0 skeleton", () => {
  it("loads the shared package", () => {
    expect(describeSharedSpike()).toBe("shared-m0");
  });

  it("exposes the official site domain and url constants", () => {
    expect(OFFICIAL_SITE_DOMAIN).toBe("editor.justdev.cn");
    expect(OFFICIAL_SITE_URL).toBe("https://editor.justdev.cn");
  });
});
