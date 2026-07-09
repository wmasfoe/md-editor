import { describe, expect, it } from "vitest";
import { parseChangelog } from "../lib/changelog";

describe("parseChangelog", () => {
  it("parses version sections in order", () => {
    const entries = parseChangelog(`# Changelog

## 0.3.17 - 2026-07-10

- Added website.
- Fixed release notes.

## 0.3.16 - 2026-07-09

- Previous release.
`);

    expect(entries).toEqual([
      {
        version: "0.3.17",
        date: "2026-07-10",
        items: ["Added website.", "Fixed release notes."]
      },
      {
        version: "0.3.16",
        date: "2026-07-09",
        items: ["Previous release."]
      }
    ]);
  });

  it("ignores malformed sections without list items", () => {
    expect(parseChangelog("# Changelog\n\n## Draft\n\nNo bullets yet.\n")).toEqual([]);
  });
});
