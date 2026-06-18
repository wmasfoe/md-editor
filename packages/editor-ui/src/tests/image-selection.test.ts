import { describe, expect, it } from "vitest";
import { imageSelectionPluginKey } from "../utils/image-selection";

describe("image selection", () => {
  it("uses a stable plugin key for image node selection handling", () => {
    expect(imageSelectionPluginKey).toBeTruthy();
  });
});
