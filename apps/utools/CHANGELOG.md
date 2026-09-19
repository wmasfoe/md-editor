# Changelog - uTools Plugin

All notable changes to the Inkpoint uTools plugin will be documented in this file.

## 0.1.1 - 2026-09-18

- 修复在保存文档与粘贴/拖入本地图片时，页面视口突然跳顶、选区丢失与撤销栈失效的严重缺陷 (#90)
- 优化保存流程，采用底层检查点与结算协议（`beginSave` / `settleSave`），确保同文档代际不递增与视口稳定
- 优化图片插入，采用编辑器原子事务端口（`applyExternalEdit`），平滑聚焦光标且保持当前视口滚动
- 遵循沉浸式编辑器交互原则，全面静默保存成功、贴图成功、模式切换及文件树常规操作的冗余 Toast，仅保留失败报错与必要前置拦截警示

## 0.1.0 - 2026-09-05

- 首次发布 Inkpoint uTools 平台插件（`apps/utools`），定位轻量随手编辑与导流跳板
- 关键字即时呼出：支持 `md`、`markdown`、`编辑器`、`Inkpoint`、`墨点` 快速唤起
- 所见即所得编辑：基于 CodeMirror 6 单状态栈，即打即显，内置 600ms 防抖自动保存
- 云端漫游草稿：对接 `utools.db` 云数据库，草稿在 uTools 账号下跨设备自动同步
- 本地文件秒开：关联 `.md`、`.markdown`、`.mdx`、`.txt` 文件，通过 Node.js `fs` 桥接直接读写
- 超级面板集成：支持全局划词（`cmd: over`）一键导入，编辑完成后支持“贴回应用”快速回传
- 快捷键支持：支持 `Cmd+S` / `Ctrl+S` 即时写盘保存并给予 Toast 反馈
- 主题跟随：自动感知并跟随 uTools 宿主环境的明暗主题模式切换
- 架构完全隔离：100% 收敛于 `apps/utools` 子包，严格遵循零污染与可拔插原则
- 商店合规打包：提供自动化构建插件，生成未混淆 CommonJS Preload 脚本与发布版 `plugin.json`
- 导流与隐私边界：顶部常驻官网跳转横幅，配置自定义 AI API Key 时提供第三方平台隐私免责声明
