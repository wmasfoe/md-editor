import { describe, expect, it } from "vitest";
import {
  basename,
  dirname,
  isSameOrChildPath,
  isSamePath,
  joinPath,
  normalizePath,
  relativePathFromRoot,
} from "../src/index";

describe("path utilities", () => {
  describe("normalizePath", () => {
    it("converts Windows backslashes to forward slashes", () => {
      expect(normalizePath("C:\\Users\\test\\docs\\file.md")).toBe("C:/Users/test/docs/file.md");
    });

    it("strips Windows verbatim prefix //?/ or \\\\?\\", () => {
      expect(normalizePath("\\\\?\\C:\\Users\\test\\docs")).toBe("C:/Users/test/docs");
      expect(normalizePath("//?/C:/Users/test/docs")).toBe("C:/Users/test/docs");
    });

    it("normalizes drive letters to uppercase", () => {
      expect(normalizePath("c:\\Users\\test")).toBe("C:/Users/test");
      expect(normalizePath("d:/notes")).toBe("D:/notes");
    });

    it("strips trailing slashes from normal directories", () => {
      expect(normalizePath("C:/Users/test/")).toBe("C:/Users/test");
      expect(normalizePath("/home/user/docs/")).toBe("/home/user/docs");
    });

    it("preserves root directory slashes", () => {
      expect(normalizePath("/")).toBe("/");
      expect(normalizePath("C:/")).toBe("C:/");
    });
  });

  describe("dirname", () => {
    it("extracts directory from POSIX path", () => {
      expect(dirname("/notes/book/chapter1.md")).toBe("/notes/book");
      expect(dirname("/notes")).toBe("/");
    });

    it("extracts directory from Windows path", () => {
      expect(dirname("C:\\Users\\test\\abc\\folder1\\test03.md")).toBe("C:/Users/test/abc/folder1");
      expect(dirname("C:/Users/test/abc")).toBe("C:/Users/test");
    });

    it("returns root for top-level files on Windows drives", () => {
      expect(dirname("C:/test.md")).toBe("C:/");
    });

    it("returns dot for plain filenames", () => {
      expect(dirname("file.md")).toBe(".");
    });
  });

  describe("isSameOrChildPath", () => {
    it("recognizes exact path matches", () => {
      expect(isSameOrChildPath("/notes/book", "/notes/book")).toBe(true);
      expect(isSameOrChildPath("C:\\Users\\test\\abc", "C:/Users/test/abc")).toBe(true);
    });

    it("recognizes nested child paths on Windows", () => {
      expect(
        isSameOrChildPath("C:\\Users\\test\\abc\\folder1\\test03.md", "C:\\Users\\test\\abc"),
      ).toBe(true);
      expect(isSameOrChildPath("C:/Users/test/abc/folder1/test03.md", "C:\\Users\\test\\abc")).toBe(
        true,
      );
    });

    it("handles case-insensitive comparison for Windows drive paths", () => {
      expect(
        isSameOrChildPath("c:\\users\\test\\abc\\folder1\\test03.md", "C:\\Users\\test\\abc"),
      ).toBe(true);
    });

    it("handles verbatim \\\\?\\ prefixes", () => {
      expect(
        isSameOrChildPath(
          "\\\\?\\C:\\Users\\test\\abc\\folder1\\test03.md",
          "C:\\Users\\test\\abc",
        ),
      ).toBe(true);
    });

    it("rejects sibling or unrelated paths", () => {
      expect(isSameOrChildPath("/notes/other/test.md", "/notes/book")).toBe(false);
      expect(isSameOrChildPath("C:\\Users\\test\\abc-other\\test.md", "C:\\Users\\test\\abc")).toBe(
        false,
      );
    });
  });
});

describe("shared path boundaries", () => {
  it.each([
    [["/", "assets/a.png"], "/assets/a.png"],
    [["/", "/assets/a.png"], "/assets/a.png"],
    [["/notes/", "/assets/", "a.png"], "/notes/assets/a.png"],
    [["C:\\", "assets\\a.png"], "C:/assets/a.png"],
    [["//server/share/", "/assets/a.png"], "//server/share/assets/a.png"],
    [["\\\\server\\share\\", "\\assets\\a.png"], "//server/share/assets/a.png"],
    [["/"], "/"],
    [["", "/", "", "assets/a.png"], "/assets/a.png"],
  ])("joins %j without introducing or losing a filesystem root", (segments, expected) => {
    expect(joinPath(...segments)).toBe(expected);
  });

  it("preserves drive-relative paths without resolving a per-drive current directory", () => {
    expect(normalizePath("c:notes/../a.md")).toBe("C:a.md");
    expect(normalizePath("c:notes/../../a.md")).toBe("C:../a.md");
    expect(normalizePath("c:../a.md")).toBe("C:../a.md");
    expect(normalizePath("c:")).toBe("C:");
    expect(dirname("C:a.md")).toBe("C:");
    expect(basename("C:a.md")).toBe("a.md");
    expect(basename("C:")).toBe("");
    expect(joinPath("C:notes", "../a.md")).toBe("C:a.md");
    expect(isSamePath("c:NOTES/a.md", "C:notes/a.md")).toBe(true);
    expect(isSamePath("C:notes/a.md", "C:/notes/a.md")).toBe(false);
    expect(isSameOrChildPath("C:notes/a.md", "c:NOTES")).toBe(true);
    expect(isSameOrChildPath("C:notes/a.md", "C:/notes")).toBe(false);
    expect(relativePathFromRoot("C:notes", "c:NOTES/a.md")).toBe("a.md");
  });
  it("keeps filesystem roots and matches root descendants", () => {
    expect(dirname("/")).toBe("/");
    expect(dirname("C:/")).toBe("C:/");
    expect(normalizePath("//server/share/../../file.md")).toBe("//server/share/file.md");
    expect(normalizePath("c:/notes/../../file.md")).toBe("C:/file.md");
    expect(normalizePath("../../notes/./a.md")).toBe("../../notes/a.md");
    expect(isSameOrChildPath("/notes/a.md", "/")).toBe(true);
    expect(isSameOrChildPath("C:/notes/a.md", "c:/")).toBe(true);
    expect(isSameOrChildPath("/notes/a.md", "")).toBe(false);
  });
  it("preserves UNC shares, including Windows extended UNC paths", () => {
    expect(normalizePath("//?/UNC/server/share/docs/")).toBe("//server/share/docs");
    expect(dirname("//server/share")).toBe("//server/share");
    expect(isSameOrChildPath("//SERVER/share/docs/a.md", "//server/SHARE/")).toBe(true);
    expect(isSameOrChildPath("//server/share-other/a.md", "//server/share")).toBe(false);
  });
  it("relativizes with the same root and Windows identity rules", () => {
    expect(relativePathFromRoot("/", "/notes/a.md")).toBe("notes/a.md");
    expect(relativePathFromRoot("c:/NOTES/", "//?/C:/notes/Sub/a.md")).toBe("Sub/a.md");
    expect(relativePathFromRoot("/notes", "/notes-other/a.md")).toBe("/notes-other/a.md");
    expect(relativePathFromRoot("/notes", "/notes")).toBe("");
  });
});
