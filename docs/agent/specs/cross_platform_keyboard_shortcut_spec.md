# 跨平台快捷键与修饰键对齐规范

> 状态：桌面端与 Web 端当前契约。v0.10.1 验证通过（PR #55, #56）；统一人机界面修饰键呈现顺序、macOS 变体字符物理键位优先比对与 IME 隔离。

## 用途

记录桌面端与 Web 端的快捷键配置、呈现格式化、键盘事件比对算法以及输入法状态机契约。修改 `packages/app-ui/src/keyboard.ts`、`apps/desktop/src/app/settings/app-settings.ts`、`apps/desktop/src-tauri/src/app_menu.rs` 或快捷键监听时，先读本规范。

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

### 5. 单一键位表与归属（Single Source of Truth）

**背景**：默认 chord 曾同时存在于 6 处（core 的 `createMarkdownFormattingFeature`、`@md-editor/editor` 的
`createMarkdownFormattingBindings` 内联字面量、desktop 的 `DEFAULT_SHORTCUT_TEMPLATES`、web 的
if-chain、web 设置面板速查表、app-ui 的展示层）。其中 desktop 还用了与 core 不一致的大小写
（core `Mod-f` / desktop `Mod-F`），web 更把 `Mod-b` 当作"切换侧边栏"，与格式化表的"加粗"直接冲突 ——
同一个 `⌘B` 在 web 是侧边栏、在 desktop 是加粗。

**契约**：

1. **默认 chord 只写在 `packages/core/src/keymap.ts`**：
   - `MARKDOWN_FORMATTING_KEYMAPS`（格式化命令，形状 = `KeymapDescriptor & { title }`）；
   - 其余内建命令的默认键位通过 `createBuiltInKeymaps()` 读取（它把内建 Feature 装进一次性注册表后返回 `list()`）。
2. **每个 chord 必须声明归属** `KeymapDescriptor.owner`：
   - `"editor"`：编辑器内核自己安装 keydown 监听（CodeMirror keymap），并且**自己完成语义**。
     目前是 `format.*` 全部命令 + `view.toggleSource`；
   - 缺省 = `"host"`：宿主安装监听并派发。编辑器**不得**为宿主语义的 chord 安装任何绑定，
     否则宿主在 bubble 阶段监听时会被静默吞掉（历史缺陷：`Mod-/` 被 CodeMirror
     `toggleComment` 吃掉）。
3. **内置快捷键开箱可用，宿主不写键盘代码**：凡是编辑器能独立完成的编辑器语义命令，
   绑定必须内置。`view.toggleSource`（`⌘/`）就是标准案例 —— 桥接层同时持有 `DocumentState`
   与渲染器，能完成「渲染器先应用 → 核心 CAS 提交 → 失败回滚」的两阶段切换，
   因此通过 `createCodeMirrorEditorBridge` / `<CodeMirrorEditor>` 接入的宿主**不需要**再绑这个键。
   宿主自己做（capture 阶段）也不会重复执行：CM 的 keymap 在 `defaultPrevented` 时直接放行。
4. **默认值与用户覆盖只按一套规则合并**：`resolveKeymaps(base, overrides)`。
   `null` 或空白串 = 显式解绑（该 id 不出现在结果里）；未知 id 忽略。
   宿主把合并结果传给编辑器端口 `setKeymaps()` 时，该表是**权威表**：
   结果里没有的 id 即视为解绑，编辑器不会再回退到默认值；内置命令（`view.toggleSource`）
   的 chord 也从这张表里取，所以设置面板改键会真实生效。
5. **固定别名不算默认值**：如 `Mod-Shift-k` 之于 `format.codeBlock`。它们在编辑器内维护，
   但必须与所属命令**同生共死**（命令解绑后别名一并消失）。
6. **新增/调整内建快捷键时**：改 `packages/core/src/keymap.ts` 一处，然后
   - 若新增的是格式化命令，编辑器的命令映射表（`createMarkdownFormattingBindings`）需要加执行体；
   - 桌面端原生菜单加速器（`app_menu.rs`）与前端保持 1:1；
   - `pnpm test` 里的 `packages/core/tests/keymap.test.ts` 会校验 id / chord 不重复、
     内建表与 Feature 装配不脱钩。
