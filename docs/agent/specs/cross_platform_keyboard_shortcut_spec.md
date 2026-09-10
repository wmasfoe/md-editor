# 跨平台快捷键与修饰键对齐规范

> 状态：桌面端与 Web 端当前契约。v0.10.1 验证通过（PR #55, #56）；统一人机界面修饰键呈现顺序、macOS 变体字符物理键位优先比对与 IME 隔离。

## 用途

记录桌面端与 Web 端的快捷键配置、呈现格式化、键盘事件比对算法以及输入法状态机契约。修改 `packages/editor-ui/src/keyboard.ts`、`apps/desktop/src/app/settings/app-settings.ts`、`apps/desktop/src-tauri/src/app_menu.rs` 或快捷键监听时，先读本规范。

---

## 核心不变量

### 1. 平台修饰键文案与显示顺序规范

为符合各平台人机交互设计规范（Apple HIG 与 Windows UX Guidelines），快捷键展示文案必须遵循严格的排序与命名契约：

- **macOS 规范**：`Control` -> `Option` -> `Command` -> `Shift`
  - 严禁在 macOS 上将 Option 键显示为 `Alt`；
  - 严禁在 macOS 上将 Command 键显示为 `Win` 或 `Meta`。
- **Windows 规范**：`Ctrl` -> `Win` -> `Alt` -> `Shift`
- **Linux 规范**：`Ctrl` -> `Super` -> `Alt` -> `Shift`

```typescript
// 统一内部 keymap 格式（例如 Mod-Alt-T）到面向用户展示文案的转换
displayShortcutKey("Mod-Alt-T", "mac");     // => "Option+Command+T"
displayShortcutKey("Mod-Alt-T", "windows"); // => "Ctrl+Alt+T"
displayShortcutKey("Mod-Alt-T", "linux");   // => "Ctrl+Alt+T"
```

### 2. 物理键位优先比对算法 (Physical Key Fallback)

- **背景与问题**：在 macOS 环境下，用户按住 `Option` 键输入字母或数字时，操作系统文本输入子系统会将字符转换为特定的变体排版符号（例如按 `Option+T` 产生 `†`，按 `Option+1` 产生 `¡`）。如果快捷键匹配函数仅依赖 `event.key.toLowerCase() === 't'`，会导致 `Cmd+Option+T` 彻底失效。
- **比对算法契约**：
  1. 首先比对修饰键位掩码（`event.metaKey` / `ctrlKey` / `altKey` / `shiftKey`）；
  2. 针对字母键（`a-z`）：优先检查物理键位码 `event.code` 是否匹配 `Key${X}`（如 `KeyT`）；
  3. 针对数字键（`0-9`）：优先检查 `event.code` 是否匹配 `Digit${X}` 或 `Numpad${X}`；
  4. 只有当物理键位不匹配或缺少 `code` 时，才回退比对 `event.key`。

### 3. IME 输入法安全隔离契约

- 当用户处于拼音、日文假名等输入法文本合成态（IME Composition）时：
  - `event.isComposing === true`，或 `event.keyCode === 229`；
- 所有快捷键比对函数（`matchesRuntimeKeymap`、`shortcutKeyFromKeyboardEvent`）必须直接判定为不匹配并返回 `false` 或 `null`；
- 严禁在输入法选词、翻页或回车上屏期间抢占按键事件或派发编辑命令。

### 4. 原生应用菜单加速器双向对齐

- 桌面端 Rust 原生菜单（`apps/desktop/src-tauri/src/app_menu.rs`）声明的快捷键加速器必须与前端应用默认快捷键绑定保持 1:1 绝对一致；
- 新增或调整全局快捷键时，必须同步更新原生菜单加速器与前端 Keymap 注册表。
