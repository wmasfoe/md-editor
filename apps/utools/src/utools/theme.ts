export type UtoolsThemePreference = "system" | "light" | "dark";
export type ResolvedUtoolsTheme = "light" | "dark";

/** 将用户偏好与宿主明暗状态收敛为唯一的渲染主题。 */
export function resolveUtoolsTheme(
  preference: UtoolsThemePreference,
  hostPrefersDark: boolean,
): ResolvedUtoolsTheme {
  if (preference === "system") {
    return hostPrefersDark ? "dark" : "light";
  }
  return preference;
}

/**
 * 同步根节点主题状态。显式 light class 用于阻止系统暗色媒体查询覆盖用户选择。
 */
export function applyResolvedUtoolsTheme(
  root: Pick<HTMLElement, "classList" | "dataset">,
  resolvedTheme: ResolvedUtoolsTheme,
): void {
  root.classList.toggle("light", resolvedTheme === "light");
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.dataset.theme = resolvedTheme;
}
