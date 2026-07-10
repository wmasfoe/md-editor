import { describe, expect, it } from "vitest";
import {
  basename,
  isExternalSchemeLink,
  isHttpLink,
  normalizeLocalHrefPath,
  splitLinkHref,
} from "./link-target";

describe("link target helpers", () => {
  it("recognizes http and https links", () => {
    expect(isHttpLink("https://example.com/post")).toBe(true);
    expect(isHttpLink("http://example.com/post")).toBe(true);
    expect(isHttpLink("./post.md")).toBe(false);
  });

  it("does not treat Windows absolute paths as external schemes", () => {
    expect(isExternalSchemeLink("C:\\notes\\post.md")).toBe(false);
    expect(isExternalSchemeLink("mailto:hello@example.com")).toBe(true);
  });

  it("splits local paths from fragments", () => {
    expect(splitLinkHref("./guide.md#install")).toEqual({
      path: "./guide.md",
      fragment: "install",
    });
    expect(splitLinkHref("#current-section")).toEqual({
      path: "",
      fragment: "current-section",
    });
  });

  it("normalizes local href paths without changing separators", () => {
    expect(normalizeLocalHrefPath("<docs/my%20post.md>?preview=true")).toBe("docs/my post.md");
  });

  it("derives a display name from paths", () => {
    expect(basename("/notes/assets/diagram.png")).toBe("diagram.png");
    expect(basename("C:\\notes\\post.mdx")).toBe("post.mdx");
  });
});
