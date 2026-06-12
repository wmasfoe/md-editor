import { describe, expect, it } from "vitest";

import { describeSharedSpike } from "./index.ts";

describe("shared M0 skeleton", () => {
  it("loads the shared package", () => {
    expect(describeSharedSpike()).toBe("shared-m0");
  });
});
