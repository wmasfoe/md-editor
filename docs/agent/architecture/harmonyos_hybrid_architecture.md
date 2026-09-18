# HarmonyOS (鸿蒙 NEXT / OpenHarmony) 原生外壳与混合架构技术方案

## 1. 架构定位与设计哲学

Inkpoint 移动端套件秉持 **“即览 (Jilan)”** 设计哲学与 **混合架构 (Hybrid Web + Native Shell)**：
- **通用离线 Web 内核 (`apps/mobile/core`)**：复用成熟的 `@md-editor/renderer-codemirror`（静态阅读态与交互编辑态）与 Markdown 语法插件体系，确保与桌面端、iOS、Android 保持 100% 渲染一致与零格式损坏；
- **编辑器之外全面原生化 (Native ArkUI Shell)**：在 HarmonyOS NEXT (API 12+) 平台上，除了正文编辑渲染区域由轻量离线 ArkWeb 托管外，其余所有交互界面与系统能力均基于 **ArkTS + ArkUI 原生控件** 实现，提供最地道的 HarmonyOS 设计体验（平滑弹簧动效、触感震动反馈、系统文件沙箱持久化、半模态抽屉与输入法软键盘自适应吸附）。

---

## 2. 模块拓扑与工程组织

```
md-editor/
├── apps/
│   ├── mobile/
│   │   ├── core/                  # @md-editor/mobile-core: 通用 Web 离线单页内核 (CM6 + KaTeX)
│   │   ├── ios/                   # iOS 原生工程 (SwiftUI + WKWebView)
│   │   ├── android/               # Android 原生工程 (Jetpack Compose + SAF)
│   │   └── harmony/               # [新增] HarmonyOS NEXT 原生工程 (ArkTS + ArkUI + ArkWeb)
│   │       ├── AppScope/          # 应用全局配置与基础资源
│   │       ├── entry/             # 主 HAP 模块
│   │       │   ├── src/main/
│   │       │   │   ├── module.json5
│   │       │   │   ├── resources/
│   │       │   │   │   ├── base/      # 图标、字符串资源
│   │       │   │   │   └── rawfile/
│   │       │   │   │       └── editor/ # 离线静态资源包 (由 sync-mobile-web 自动分发)
│   │       │   │   └── ets/
│   │       │   │       ├── entryability/EntryAbility.ets # 生命周期入口
│   │       │   │       ├── pages/Index.ets               # 主界面
│   │       │   │       ├── viewmodel/DocumentViewModel.ets # 状态模型
│   │       │   │       ├── bridge/
│   │       │   │       │   ├── BridgeContracts.ets       # 1:1 契约镜像
│   │       │   │       │   └── HarmonyBridge.ets         # ArkWeb 双向 RPC 桥接
│   │       │   │       └── components/
│   │       │   │           ├── DocumentTopBar.ets        # 原生顶部导航与胶囊按钮
│   │       │   │           ├── KeyboardAccessoryBar.ets  # 原生软键盘联动格式化工具栏
│   │       │   │           ├── OutlineSheet.ets          # 原生大纲半模态抽屉
│   │       │   │           └── EditorWebComponent.ets    # 离线 ArkWeb 容器封装
│   │       │   ├── build-profile.json5
│   │       │   ├── hvigorfile.ts
│   │       │   └── oh-package.json5
│   │       ├── build-profile.json5
│   │       ├── hvigorfile.ts
│   │       ├── oh-package.json5
│   │       └── hvigorw            # 跨平台构建包装脚本
└── scripts/mobile/
    └── sync-mobile-web.mjs        # 静态产物自动分发脚本 (扩展同步至 harmony)
```

---

## 3. 双向类型安全通信协议 (InkpointBridge ↔ HarmonyBridge)

通信契约严格按照 `contracts.ts` 规范，ArkTS 与前端 TypeScript 保持 1:1 类型镜像：

### 3.1 原生向 Web 派发的 Action (Native -> Web)
原生通过 `WebviewController.runJavaScript` 调用 Web 端单例：
- `loadDocument(markdown, mode, title)`：注入 Markdown 正文与初始模式；
- `setMode(mode: "read" | "edit")`：在阅读态与编辑态之间平滑切换；
- `execCommand(command: MarkdownCommand)`：触发格式化指令；
- `requestContent`：请求前端回传最新 Markdown 内容以供持久化保存；
- `scrollToHeading(headingId)`：大纲锚点导航跳转。

### 3.2 Web 向原生反馈的 Event (Web -> Native)
ArkWeb 通过 `registerJavaScriptProxy` 将 `HarmonyBridgeProxy` 注入至前端全局 `window.HarmonyBridge`：
- `ready`：前端 DOM 与 CodeMirror 初始化就绪；
- `contentChange(isDirty, wordCount)`：用户编辑触发脏标记与字数统计；
- `saveResponse(markdown, isSuccess)`：回传最新文档文本供原生写入磁盘；
- `haptic(type)`：请求原生马达触发触感反馈；
- `outlineExtracted(headings)`：上报提取的文档大纲列表；
- `openUrl(url)`：拦截外部超链接，交由系统默认浏览器打开；
- `error(message, stack)`：前端未捕获异常上报。

---

## 4. HarmonyOS 原生控件与系统级深度集成

除了内部 Markdown 渲染与 CodeMirror 编辑器由 ArkWeb 离线承载，其余所有控件与系统能力全部采用 ArkUI 原生实现：

### 4.1 原生顶部导航栏 (`DocumentTopBar`)
- **打开文件**：原生图标按钮，直接调起系统级文件选择器；
- **文档标题与脏状态**：自适应截断标题，当 `isDirty` 为 `true` 时展示系统原生小红点；
- **双态切换胶囊药丸**：ArkUI 原生胶囊按钮，带平滑背景色过渡动效，点击切换“阅读/编辑”状态并伴随微触感；
- **更多菜单 (`bindMenu`)**：挂载原生下拉菜单，提供“立即保存”、“新建示例文件”、“字数统计”等操作。

### 4.2 原生软键盘联动格式化工具栏 (`KeyboardAccessoryBar`)
- **键盘动态吸附**：监听输入法软键盘的显示与高度变化，在编辑态下紧贴软键盘上方平滑升降；
- **横向平滑滚动**：使用 ArkUI 原生 `Scroll(Axis.Horizontal)`，支持触控惯性滑动；
- **按键布局一致性**：按键顺序与 iOS / Android 保持 **100% 完全一致**：
  `[H1] [H2] | [粗体] [斜体] [删除线] [行内代码] | [无序列表] [有序列表] [待办列表] [引用] [链接] [表格] | [收起键盘]`；
- **触感反馈**：每个格式化按键点击均触发轻量震动反馈。

### 4.3 原生大纲半模态抽屉 (`OutlineSheet`)
- **半模态展示**：采用 ArkUI 原生 `bindSheet`，支持手势下拉关闭与多档位高度调节；
- **层级视觉树**：采用原生 `List` 与 `ListItem`，根据标题级别 (`level: 1..6`) 进行阶梯式缩进，不同级别配置专属色阶圆点徽标；
- **精准锚点跳转**：点击目标标题时派发 `scrollToHeading` 指令并自动收起抽屉。

### 4.4 系统级文件就地读写 (`@kit.CoreFileKit`)
- **系统文件选择器**：接入 `picker.DocumentViewPicker`，支持从系统盘或外接介质中就地打开 `.md` 文件；
- **沙箱安全读写**：通过 `fs.open` 与文件流进行就地保存与原子替换，无需申请危险的全局存储权限。

### 4.5 系统级触感反馈 (`@kit.SensorServiceKit`)
- 接入系统 `vibrator` 振动马达，根据 `HapticFeedbackType` 区分 `selection`（选择刻度感）、`impactLight`（按键轻微触感）与 `impactMedium`（模式切换顿挫感）。

---

## 5. CI/CD 自动化验证与打包流水线 (GitHub Actions)

在 `.github/workflows/mobile-ci.yml` 中扩充 `harmony-ci` 作业，与 `ios-ci` 和 `android-ci` 并行执行：

```yaml
  harmony-ci:
    name: HarmonyOS Native Shell (ArkTS & ArkUI)
    needs: mobile-web-build
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download Mobile Web Assets
        uses: actions/download-artifact@v4
        with:
          name: mobile-web-dist
          path: apps/mobile/harmony/entry/src/main/resources/rawfile/editor

      - name: Setup OpenHarmony CLI & SDK (API 12)
        uses: ErBWs/setup-ohos@v2
        with:
          version: 5.0.0.125
          cache: true

      - name: Install ohpm dependencies
        working-directory: apps/mobile/harmony
        run: ohpm install --all

      - name: Build HarmonyOS HAP
        working-directory: apps/mobile/harmony
        run: |
          chmod +x ./hvigorw
          ./hvigorw --version --accept-license
          ./hvigorw assembleHap --mode module -p product=default --no-daemon

      - name: Upload Debug HAP
        uses: actions/upload-artifact@v4
        with:
          name: inkpoint-harmony-debug-hap
          path: apps/mobile/harmony/entry/build/default/outputs/default/*.hap
          retention-days: 7
```

---

## 6. 后续实施阶段与路线图

1. **第一阶段 (Phase 1) - Bridge 与分发基建**：
   - 扩展 `apps/mobile/core/src/bridge/index.ts` 识别 `window.HarmonyBridge`；
   - 更新 `scripts/mobile/sync-mobile-web.mjs` 支持自动同步至 `rawfile/editor`。
2. **第二阶段 (Phase 2) - HarmonyOS 原生工程搭建**：
   - 初始化 `apps/mobile/harmony` 官方工程骨架与配置文件（`build-profile.json5`, `module.json5` 等）；
   - 实现 `BridgeContracts.ets` 与 `HarmonyBridge.ets` 双向通信桥。
3. **第三阶段 (Phase 3) - 原生 ArkUI 控件与主页面装配**：
   - 实现 `DocumentTopBar`、`KeyboardAccessoryBar`、`OutlineSheet`；
   - 接入 `@kit.CoreFileKit` 与 `@kit.SensorServiceKit`；
   - 整合 `Index.ets` 主页，验证双向通信与动效。
4. **第四阶段 (Phase 4) - CI/CD 流水线集成**：
   - 配置 GitHub Actions `harmony-ci`，实现 PR / Push 自动编译与 HAP 产物构建上传。
