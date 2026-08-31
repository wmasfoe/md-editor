# Apple Liquid Glass 设计规范与接入指南

## 一、 规范目的与适用范围

本文档规定了 Inkpoint 官方网站（`site` 模块）以及后续桌面端相关界面的 **Liquid Glass（液态玻璃）** 设计系统、物理光学参数、CSS Token 语义契约与前端组件应用准则。

---

## 二、 物理光学原理与核心特征

Liquid Glass 是 Apple 在 visionOS / iOS 18+ / macOS 设计语言中推出的高级玻璃材质，相比传统毛玻璃（Flat Glassmorphism），具有以下物理光学特征：

```
                 ┌──────────────────────────────────────────────┐  <- Top Specular Highlight (高光镜面边缘)
                 │  ▲ Inset 1px Specular Light (rgba(255,255,255,0.95))
  Translucent    │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  <- Frosted Blur (backdrop-filter: blur(16px))
  Backdrop Lens  │  ░░░░░░░ Directional Caustic Sheen ░░░░░░░░  │  <- Saturation Boost (saturate(180%~200%))
                 │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  <- Inset Dark Bevel (底缘微暗面)
                 └──────────────────────────────────────────────┘  <- Contact + Ambient Shadow (悬浮双层阴影)
```

1. **透镜折射与高光内嵌（Specular Edge Highlights）**：
   - 顶部内嵌 1px~1.5px 纯白高光反射（`inset 0 1px 1px 0 rgba(255,255,255,1)`）；
   - 底部内嵌微弱的暗部折射倒角（`inset 0 -1px 1px 0 rgba(0,0,0,0.03~0.3)`），增强立体通透厚度。
2. **高饱和背景模糊（Backdrop Blur & Saturation Boost）**：
   - `backdrop-filter: blur(16px~20px) saturate(180%~200%)`，使透过玻璃观察到的底色不仅被柔和磨砂，同时色彩更通透清润，避免发灰发暗。
3. **微弱表面光泽渐变（Directional Caustic Sheen）**：
   - 表面附带 180° 或 135° 的微弱光照渐变，呈现真实弧形玻璃微曲面的反光。
4. **悬浮双层阴影系统（Dual-layer Floating Shadows）**：
   - 包含近距离接触投影（Contact Shadow）与远距离环境漫反射投影（Ambient Shadow）。
5. **流体弹性滑动（Fluid Sliding Motion & Elastic Feedback）**：
   - 分段选择器（Segmented Control）采用浮动液态玻璃胶囊（Sliding Glass Thumb），配合 Apple 标准弹簧缓动曲线（`cubic-bezier(0.16, 1, 0.3, 1)`），在不同平台间丝滑滑动。
   - 点击时具备物理触感微缩放（`active:scale-[0.98]`）。

---

## 三、 CSS Token 与 Class 契约

定义在 `site/app/globals.css` 中的全局类：

| 类名 | 材质类型 | 核心样式特征 | 适用场景 |
| :--- | :--- | :--- | :--- |
| `.liquid-glass-track` | 外层凹槽轨道 | `backdrop-filter: blur(20px) saturate(190%)`, 偏暖石色半透明底, 内嵌凹槽微阴影 | 分段切换器（Segmented Control）的外层凹槽 |
| `.liquid-glass-pill` | Apple 水滴液态玻璃滑块 | `35%~60%` 晶莹多角度水光渐变, `backdrop-filter: blur(20px) saturate(220%) contrast(106%)`, 顶部 1.5px 钻石镜面高光, 内部焦散微光, 底部微倒角 | 分段切换器的浮动活动滑块 |
| `.liquid-glass-button-dark` | 黑曜石深色液态玻璃 | 深墨色渐变底, 顶部 1px 纯白镜面内高光, 悬浮微光扫掠, 点击微弹簧回弹 | 主下载按钮、页头下载按钮等主要 CTA 控件 |
| `.liquid-glass-button-light` | 白水晶浅色液态玻璃 | 通透白渐变底, `backdrop-filter: blur(16px) saturate(180%)`, 细密微边框与高光 | 语言切换器、复制按钮等次要操作控件 |

---

## 四、 核心组件落地实现

### 1. 交互式拖拽与 @samasante/liquid-glass 原生折射分段选择器 (`site/components/liquid-glass-segmented-control.tsx`)
- **多层架构与原生 SDF 折射**：
  1. **底层（Track Container）**：外层轨道采用 `.liquid-glass-track` 磨砂凹槽，`overflow-visible` 避免切断浮动透镜；
  2. **原生光学折射层（`<Glass>` Engine）**：基于 `@samasante/liquid-glass` 的 SVG `feDisplacementMap` SDF 透镜引擎，透镜中心坐标通过 `center.x = (position + 0.5) / count` 精准映射；
  3. **静止与移动状态分离**：
     - **静止状态（At Rest）**：控件完全透明，无白底遮罩，仅文字加粗高亮；
     - **移动状态（On Drag / Click Transition）**：动态激活 Liquid Glass 透镜与色散折射，滑行/拖拽过程中透镜随坐标平滑移动，到达目标后自然收起；
  4. **交互层（Pointer Dragging & Click Transition）**：
     - 单击选项时触发 420ms Apple 减速缓动曲线（`cubic-bezier(0.16, 1, 0.3, 1)`）平滑滑行；
     - 拖拽超过阈值（>4px）时开启实时拖拽跟踪，松手时弹簧吸附至最近选项。
- **无障碍保障**：支持 WAI-ARIA `role="tablist"` / `role="tab"`，支持键盘 `ArrowLeft` / `ArrowRight` 左右方向键导航与焦点同步。

### 2. 主下载按钮与微光扫掠
- 结构：
  ```tsx
  <a className="liquid-glass-button-dark group relative ...">
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/12 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
    />
    <span className="relative z-10 font-semibold tracking-tight">{label}</span>
  </a>
  ```
- 优势：深邃沉稳，同时在鼠标 hover 时泛起一层自然柔和的环境微光。

---

## 五、 性能与兼容性保证

1. **硬件加速**：所有位移动画与变形严格限制在 `transform` 与 `opacity`，避免触发布局重排（Layout Thrashing）；
2. **SSR 兼容性**：核心材质与动画由纯 CSS 驱动，Next.js SSR / 静态导出零水合抖动；
3. **多端适配**：在 iOS Safari 与 Android WebKit 上自动适配 `-webkit-backdrop-filter`，保证跨平台通透效果一致。
