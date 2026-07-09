# Desktop Store 与 Controller 边界规范

用途：规范 desktop 层 Zustand store、controller hook、runtime/service 单例之间的职责边界，避免为了“集中 import”而把真实业务动作藏在 controller 里，再通过 `setState` 注入到空壳 store。

## 核心判断

同一个 ownership 层里的模块需要 runtime、service 或其他稳定单例时，可以直接 import。不要为了让某个依赖“只在一处 import”，把所有业务动作集中到一个 controller，再运行时注入给 store。

这种过度集中会制造两个问题：

- store 看起来是行为主人，实际只是 no-op 占位，真实逻辑藏在 controller 生命周期里。
- app 根部或 controller 变成隐式启动顺序中心，后续改动需要同时理解 store、controller、Provider 和挂载时机。

## Store 应负责什么

Desktop store 可以直接负责 desktop-scoped 的稳定状态和动作：

- 可订阅 UI/app 状态，例如当前文件夹、pending action、confirmation、asset preview。
- 同层业务动作，例如打开文档、文件树 create/rename/delete、确认弹窗请求、文件操作 loading。
- 对 desktop runtime/service 的直接调用，例如 `runtime`、`fileService`、`recentFilesStore`。

这些依赖都属于 desktop app 层时，直接 import 比隐藏式注入更清楚。

## Controller 应负责什么

Controller hook 只保留需要 React 生命周期的 wiring：

- 注册和清理快捷键、native menu、窗口关闭 guard。
- 注册和清理 paste/drop、recent-file events 等全局监听。
- 连接 React Provider 生命周期本身必须提供的能力，例如 editor-ui command dispatcher、WYSIWYG fragment 跳转、更新确认流程、document revision remount、依赖这些能力的文档打开入口。

Controller 不应成为 store action 的隐藏宿主。不要在 controller 里组装业务 action 后用 `useStore.setState(...)` 写进 store。确实依赖 Provider 挂载态的能力，应拆成命名 bridge hook，例如 `useDesktopCommandDispatcher` 或 `useDesktopWysiwygLinkBridge`，并让 hook 名称说明为什么这里需要生命周期 wiring。

## 不要用初始化入口伪装清晰

避免把运行时 action 注入从：

```ts
useSomeStore.setState({ doThing });
```

改成：

```ts
initializeSomeStore({ doThing, runtime, service });
```

如果 store action 必须等 App 根部初始化后才可用，心智负担并没有消失，只是换了名字。优先让 desktop store 直接 import 同层稳定依赖；只有确实依赖 React Provider 挂载态的动作，才使用局部命名 bridge hook。

## 什么时候不该直接 import

直接 import 只适用于同一 ownership 层。以下情况仍应通过 adapter/callback/API 边界：

- `editor-core` 需要保持平台无关、React 无关。
- `editor-ui` 需要跨 desktop/web/mobile 复用。
- 依赖是 Tauri、文件系统、native menu/window 等平台能力，并且目标模块位于 shared package。
- 依赖是测试时需要替换的外部系统，且没有稳定 fake/service 边界。

跨层时要用明确 API 注入；同层时不要为了形式上的集中而制造隐藏全局 wiring。

## 代码检查表

改动 desktop store/controller 时先检查：

1. 这个 action 的长期主人是不是某个 desktop store？
2. store 里是否存在 no-op action，真实实现却由 controller later `setState` 注入？
3. controller 是否只是因为“依赖都从这里 import”而承担业务逻辑？
4. 直接 import desktop 单例是否比初始化入口更清楚？
5. 如果需要 React Provider 才能拿到依赖，是否已经拆成命名 bridge hook，而不是藏在总 controller 中？

如果答案显示 store 是稳定主人，就把动作定义在 store 中；如果答案显示能力属于生命周期 wiring，就放进命名 bridge hook；不要把两者混成运行时注入的空壳 store。
