import { describe, expect, it } from "vitest";

import {
  findStyleRelinkCandidate,
  isStyleProfileExpired,
  isStyleProfileLinked,
  isUserStyleExcluded,
  undoStyleRelink,
  renameStyleRelPath,
  scoreStyleIdentity,
} from "../../src/style/index.ts";
import { sample, workspace } from "./fixtures.ts";

/** 每个样本 4 个段落 hash 的画像 */
function profileWith(prefix: string, files = 10) {
  return workspace(prefix, {
    samples: Array.from({ length: files }, (_, index) =>
      sample(`${prefix}${index}`, {
        paragraphHashes: [1, 2, 3, 4].map((p) => `${prefix}-${index}-${p}`),
      }),
    ),
  });
}

function hashesOf(...profiles: ReturnType<typeof profileWith>[]): Set<string> {
  return new Set(profiles.flatMap((profile) => profile.samples.flatMap((s) => s.paragraphHashes)));
}

describe("style profile identity", () => {
  it("U-ID-1: swapped directories each match their own profile", () => {
    const blog = profileWith("blog");
    const novel = profileWith("novel");
    const blogNow = hashesOf(blog);
    const novelNow = hashesOf(novel);

    expect(isStyleProfileLinked(blog, novelNow)).toBe(false);
    expect(isStyleProfileLinked(novel, blogNow)).toBe(false);
    const unlinked = [blog, novel].map((p) => ({ ...p, linkState: "unlinked" as const }));
    expect(findStyleRelinkCandidate(unlinked, blogNow)?.profileId).toBe("blog");
    expect(findStyleRelinkCandidate(unlinked, novelNow)?.profileId).toBe("novel");
  });

  it("U-ID-2: stays linked after 30% of files were edited outside the app", () => {
    const blog = profileWith("blog");
    const current = hashesOf(blog);
    // 3 个文件各改了 2 段，另有新文章加入。
    for (const index of [0, 1, 2]) {
      current.delete(`blog-${index}-1`);
      current.delete(`blog-${index}-2`);
    }
    current.add("new-article-paragraph");
    expect(scoreStyleIdentity(blog, current).score).toBeCloseTo(34 / 40);
    expect(isStyleProfileLinked(blog, current)).toBe(true);
  });

  it("U-ID-3: a directory recreated at the same path with new content is not linked", () => {
    const blog = profileWith("blog");
    expect(isStyleProfileLinked(blog, new Set(["fresh-1", "fresh-2"]))).toBe(false);
    // 无法校验身份的画像（没有段落 hash）保持关联。
    expect(isStyleProfileLinked(workspace("empty"), new Set())).toBe(true);
  });

  it("U-ID-4: relink requires score >= 0.5 and at least three matched samples, picking the best", () => {
    const blog = { ...profileWith("blog"), linkState: "unlinked" as const };
    const all = [...hashesOf(blog)];
    // 19/40 < 0.5
    expect(findStyleRelinkCandidate([blog], new Set(all.slice(0, 19)))).toBeUndefined();
    // 20/40 = 0.5，覆盖 5 个样本
    expect(findStyleRelinkCandidate([blog], new Set(all.slice(0, 20)))?.profileId).toBe("blog");

    const tiny = { ...profileWith("tiny", 2), linkState: "unlinked" as const };
    expect(findStyleRelinkCandidate([tiny], hashesOf(tiny))).toBeUndefined();

    const other = { ...profileWith("other"), linkState: "unlinked" as const };
    const mixed = new Set([...all, ...[...hashesOf(other)].slice(0, 24)]);
    expect(findStyleRelinkCandidate([other, blog], mixed)?.profileId).toBe("blog");
    // 已关联的画像不参与找回。
    expect(findStyleRelinkCandidate([profileWith("blog")], hashesOf(blog))).toBeUndefined();
  });

  it("U-ID-5: renames update file and directory prefixes only", () => {
    expect(renameStyleRelPath("notes/a.md", "notes", "posts")).toBe("posts/a.md");
    expect(renameStyleRelPath("notes", "notes", "posts")).toBe("posts");
    expect(renameStyleRelPath("notes-old/a.md", "notes", "posts")).toBe("notes-old/a.md");
    expect(renameStyleRelPath("a.md", "a.md", "b.md")).toBe("b.md");
  });

  it("U-ID-6: unlinked profiles expire after 30 days", () => {
    const now = new Date("2026-12-31T00:00:00Z");
    const unlinked = (days: number) => ({
      linkState: "unlinked" as const,
      unlinkedSince: new Date(now.getTime() - days * 86_400_000).toISOString(),
    });
    expect(isStyleProfileExpired(unlinked(31), now)).toBe(true);
    expect(isStyleProfileExpired(unlinked(29), now)).toBe(false);
    expect(isStyleProfileExpired({ linkState: "linked" }, now)).toBe(false);
  });

  it("matches user exclusions by path prefix like the Rust scanner", () => {
    expect(isUserStyleExcluded("diary/a.md", ["diary"])).toBe(true);
    expect(isUserStyleExcluded("diary", ["diary/"])).toBe(true);
    expect(isUserStyleExcluded("diary-public.md", ["diary"])).toBe(false);
    expect(isUserStyleExcluded("notes/a.md", [])).toBe(false);
  });
});

describe("undo relink", () => {
  it("returns a relinked profile to its previous root as unlinked", () => {
    const moved = workspace("w1", {
      rootPath: "/notes/new",
      relinkedFrom: { rootPath: "/notes/old", at: "t0" },
    });
    const [undone] = undoStyleRelink([moved, workspace("w2")], "w1", "t1");
    expect(undone).toMatchObject({
      rootPath: "/notes/old",
      linkState: "unlinked",
      unlinkedSince: "t1",
    });
    expect(undone).not.toHaveProperty("relinkedFrom");
    expect(undoStyleRelink([workspace("w3")], "w3", "t1")[0]).toMatchObject({
      linkState: "linked",
    });
  });
});
