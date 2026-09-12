import { describe, expect, it } from "vitest";
import { applyResolvedUtoolsTheme, resolveUtoolsTheme } from "../theme";

describe("uTools theme resolution", () => {
  it("keeps an explicit light preference on a dark host", () => {
    expect(resolveUtoolsTheme("light", true)).toBe("light");
  });

  it("follows the host only for the system preference", () => {
    expect(resolveUtoolsTheme("system", true)).toBe("dark");
    expect(resolveUtoolsTheme("system", false)).toBe("light");
  });

  it("keeps light and dark root classes mutually exclusive", () => {
    const classes = new Set<string>(["dark"]);
    const root = {
      classList: {
        toggle(name: string, force?: boolean) {
          if (force) classes.add(name);
          else classes.delete(name);
          return force ?? false;
        },
      } as DOMTokenList,
      dataset: {} as DOMStringMap,
    };

    applyResolvedUtoolsTheme(root, "light");

    expect([...classes]).toEqual(["light"]);
    expect(root.dataset.theme).toBe("light");
  });
});
