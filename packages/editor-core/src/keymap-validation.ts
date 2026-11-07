/**
 * @file keymap-validation.ts
 * @description 快捷键字符串的格式校验，供外部插件快捷键覆盖在注册前判断是否可用。
 */

const KEYMAP_MODIFIERS = new Set(["Mod", "Shift", "Alt"]);

/**
 * 校验快捷键字符串格式，合法返回 `null`，否则返回原因。
 *
 * 格式为若干修饰键（`Mod`、`Shift`、`Alt`，不可重复）加一个主键，以 `-` 连接。
 * 这里刻意与 `matchesRuntimeKeymap` 的解析保持一致：它按 `-` 切分并取最后一段作主键，
 * 所以主键不能是 `-` 本身，否则运行时永远匹配不上。
 */
export function validateKeymapKey(key: string): string | null {
  if (key === "" || key.trim() !== key) return "Shortcut must not be empty or padded";
  const parts = key.split("-");
  const main = parts.pop();
  if (!main) return "Shortcut needs a main key";
  const seen = new Set<string>();
  for (const modifier of parts) {
    if (!KEYMAP_MODIFIERS.has(modifier)) return `Unknown modifier: ${modifier || "(empty)"}`;
    if (seen.has(modifier)) return `Duplicate modifier: ${modifier}`;
    seen.add(modifier);
  }
  if (KEYMAP_MODIFIERS.has(main)) return "Shortcut needs a main key besides modifiers";
  return null;
}
