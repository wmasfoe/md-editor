import { describe, expect, it } from "vitest";
import { dirname, isSameOrChildPath, normalizePath } from "../src/lib/path";

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
