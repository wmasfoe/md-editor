# GitHub 外部插件

用途：说明插件公共协议、包职责、发布产物、桌面生命周期与网页试用边界；修改插件加载、分发或开发模板时先读本文。

## 包与能力

| 包 | 职责 |
| --- | --- |
| `@md-editor/plugin-sdk` | 插件作者使用的清单、生命周期、编辑 API；`/syntax` 与 `/mdx` 是公共类型入口 |
| `@md-editor/plugin-host` | 插件校验、ESM 加载、贡献注册、生命周期、配置和清理；`/github` 负责分发客户端，`/mdx` 是纯注册表 |
| `@md-editor/syntax-plugins` | 内置 Markdown 插件实现 |
| `@md-editor/mdx-plugins` | 内置 MDX 组件与 metadata |

原 `mdx-component-registry` 已删除，公共类型迁入 `@md-editor/plugin-sdk/mdx`，注册实现迁入 `@md-editor/plugin-host/mdx`。其他文档中仍出现的旧包名是历史记录，以本文为准。编辑器核心和 renderer 只依赖 SDK 契约，应用创建 host MDX 注册表后注入编辑器。SDK 不依赖 host、编辑器实现、React 或平台代码。运行机制是 host 的内部职责，没有额外的 runtime 包。

首版支持公开 GitHub Releases 中可信作者的语法、写作命令、模板、快捷键和设置。第三方 React/MDX 组件执行、私有仓库、凭据和网络能力、自定义面板仍未开放。桌面插件与应用处于同一 JavaScript 环境，公共 API 不是逐插件权限沙箱。

## Release 契约

每个正式 Release 上传一个 `inkpoint-plugin.json`，`plugins` 数组不设固定数量上限：

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "id": "author.weekly",
      "name": "周报",
      "version": "1.0.0",
      "description": "插入个人周报模板",
      "apiVersion": 1,
      "asset": "author.weekly-1.0.0.inkpoint.json"
    }
  ]
}
```

每个索引项对应同一 Release 中唯一的独立附件。ID 和附件名均不可重复；缺少附件或包内 ID、名称、版本、说明、API 版本与索引不一致会拒绝安装。未列出的附件不作为插件识别，README 和截图可以共存。仓库的一次 Release 是完整目录快照，各插件可保持独立版本。

插件包是 UTF-8 JSON，结构为 `manifest`、`code`、可选 `styles`、`examples` 和可选 `settings`。`manifest` 与索引的上述五个元数据字段完全相同；`code` 是默认导出插件定义的单文件 ESM。示例包含 `id/name/markdown`、可选 `selection: {anchor, head}` 和操作说明。设置支持字符串、有限数字、布尔值和字符串枚举。

目录上限 1 MiB，单包上限 10 MiB，网络请求限时 30 秒。分发 Worker 分页读取所有 Release 附件，不以第一页或条目数截断；资源保护采用字节与时间限制，分页原始元数据累计上限 10 MiB。客户端还限制元数据响应大小，不承诺无限存储或网络资源。

Worker 入口为 `/plugins/github/:owner/:repo/releases/`，支持 `latest`、`id/:releaseId`、`tags/:tag` 和 `:releaseId/assets/:assetId`。上游只能是结构化 GitHub 来源，附件下载前校验其 Release 归属；没有任意 URL 代理。未认证的 GitHub API 按出口 IP 限 60 次/小时，而 Worker 出口 IP 是共享的，所以配置了 `GITHUB_TOKEN` secret 时请求会带上 `Authorization`（只发给 `api.github.com`，不随重定向转发到附件 CDN）。元数据请求使用 Cloudflare 边缘缓存：按数字 ID 定位的 Release 与其附件列表缓存 1 小时，`latest` 与标签缓存 60 秒以便尽快看到新发布；插件包二进制下载不缓存。这个路由在 `createRouterContext` 之前处理，有意不经过下载统计与通用响应缓存。客户端校验整个目录的附件映射，只下载所选插件包。GitHub 返回 SHA-256 摘要时比较摘要；固定安装来源同时记录仓库、Release ID、标签、附件 ID、插件 ID 和原始字节 SHA-256。

摘要证明产物一致性，不证明作者可信或代码安全。

## 开发与发布

开发模板位于独立仓库 [inkpoint-editor/inkpoint-plugin-starter](https://github.com/inkpoint-editor/inkpoint-plugin-starter)（GitHub Template Repository）。该仓库与端侧模型仓库 [inkpoint-editor/md-editor-models](https://github.com/inkpoint-editor/md-editor-models) 现已属于 inkpoint-editor 组织，分别从 `wmasfoe/inkpoint-plugin-starter` 与 `wmasfoe/md-editor-models` 迁入，旧地址会自动跳转。模板可直接 Fork，或在 GitHub 上使用 “Use this template”；主仓库不再保存模板副本。每个 `plugins/<name>/plugin.json` 描述一个插件，与相邻入口和可选样式一起构建。新增目录即可扩展插件数量。

插件从 SDK 导入公共契约和开发辅助 API：

```ts
import { definePlugin } from "@md-editor/plugin-sdk";

export default definePlugin({
  activate(context) {
    context.commands.register({
      id: "author.weekly.insert",
      title: "插入周报",
      async run() {
        const snapshot = context.editor.getSnapshot();
        const result = await context.editor.applyEdit({
          markdown: snapshot.markdown + "\n\n## 本周工作\n",
          expectedGeneration: snapshot.documentGeneration,
          expectedContentRevision: snapshot.contentRevision,
          selection: "end",
        });
        if (result.status === "stale") return;
      },
    });
  },
});
```

贡献 ID 必须以 `<插件 ID>.` 开头。Lezer 节点名必须以插件 ID 推导出的前缀开头，并追加自己的后缀。前缀由 `@md-editor/plugin-host` 的 `syntaxNodePrefix` 计算：按 `.` 分段转 PascalCase，段内 `-` 转为 `_` 加首字母大写，末尾再加 `_`，例如 `author.weekly` 对应 `AuthorWeekly_`，`my-org.tool` 对应 `My_OrgTool_`。末尾的 `_` 让 `owner.plugin` 的前缀不再是 `owner.pluginx` 前缀的前缀，`.` 与 `-` 的不同映射让 `a.b` 与 `a-b` 不会撞到同一个前缀。节点、命令和快捷键冲突会拒绝注册。

桌面快捷键由用户管理：安装后插件命令立即出现在命令面板，默认不绑定快捷键。每条命令可声明可选的 `description` 与 `suggestedKey`；既有 `context.keymaps.register` 声明也只提供建议键位，不自动绑定。设置页按命令展示名称、说明、建议键与绑定输入框，允许保存和清除。绑定按插件 ID 与命令 ID 持久化，停用时注销，重启或重新启用后恢复。已有按 keymap ID 保存的用户覆盖继续读取，用户下次编辑时迁移到命令 ID；从未由用户保存的默认键不迁移。

host 将真实插件 ID 显式传给贡献适配层，禁止根据贡献 ID 前缀猜测归属。`createPluginCommandBindings` 负责命令与建议键关联、绑定恢复、冲突处理和清理，桌面接入层注入 core 的格式校验与真实快捷键注册表。设置页在保存非空绑定前通过带唯一请求 ID 的事件查询主窗口最新占用状态，忽略普通广播和其他请求的响应；5 秒内无响应时拒绝保存并提示重试，清除绑定不依赖主窗口响应。注册时仍再次检查；非法、冲突或运行时注册异常的绑定不生效、不回退到建议键，错误记录到单条快捷键状态，命令仍可从命令面板执行。建议项注册遇到其他异常时回滚，防止残留贡献。设置页同时说明升级后默认键变为建议键、已保存用户绑定继续保留。更新后已删除命令的绑定保留并标记为不可用，用户可清理。

CodeMirror 和 Lezer 运行时通过 `context.dependencies` 获取；插件不可再次打包这些依赖。模板构建拒绝运行时导入 CodeMirror 和 Lezer，类型导入会被编译器擦除。SDK 的 `definePlugin` 等辅助函数可随插件打包，不引入编辑器运行时。其他依赖须打包到同一个 ESM；不支持插件之间的运行时依赖。

SDK 在工作区直接导出源码，发布到 npm 的包导出构建后的 JavaScript 与声明文件。`@md-editor/plugin-sdk` 已发布到 npm，模板直接从 npm 安装。CodeMirror 与 Lezer 在 SDK 中是可选 peer 依赖：只写命令或模板类的插件不需要它们，写语法插件需要自行安装其类型包。发布必须使用 `pnpm publish --access public`，因为包内依赖使用 workspace 的 `catalog:` 协议，`npm publish` 会把它原样写进发布产物。发布不会自动触发 GitHub Release 或部署网站/Worker。

模板包含自定义提及语法和周报写作插件。构建生成独立插件附件与目录，校验字段、设置、示例选区、ID 唯一性、单模块输出和大小限制。模板的 GitHub Actions 先检查类型与构建，再创建草稿 Release，上传全部校验产物后公开。插件写法以模板仓库为准。

## 桌面生命周期与恢复

首次安装前设置页弹出确认框，展示插件名称与 ID、版本、`owner/repo`、Release 标签和 SHA-256，并说明代码将在应用内执行；确认后才写入存储并启用。同一仓库的更新进入待生效版本，下次启动才执行。

主编辑窗口持有唯一 host；设置窗口修改原生持久化数据并发出变更事件，不运行插件。原生存储在应用数据目录，以原子替换写入，保存时检查修订号，拒绝旧窗口覆盖新配置、复活已移除插件或由其他仓库接管已有 ID。

每个插件独立保存启用状态、设置、快捷键覆盖、当前版本、上一版本和待更新版本。每个版本只持久化来源与原始字节 `raw`，解析后的包在读取时由 `raw` 推导，不重复存储；旧格式里多出的 `package` 字段读取时被忽略，下次写入时去掉。某个插件的本地副本损坏时只隔离该插件并在设置页提示移除，不影响其他插件加载；只有回退用的上一版本损坏时，当前版本照常可用。主动下载的更新在下次应用启动时晋升；回退恢复上一份版本。目录移除条目不会卸载本地副本。离线激活重新校验缓存的原始 JSON 字节摘要、清单与来源 ID，通过后才加载代码。

`activate(context)` 可返回清理函数。每个贡献返回 `Disposable`；停用、卸载或激活失败会取消 signal，清理贡献与样式。异步激活在停用后返回的清理函数仍会执行。文档修改经既有外部编辑事务提交，校验文档 generation/revision，保持撤销和 IME 语义；延迟到组合输入结束的编辑仍检查插件取消信号。同 ID 的新语法实例会重新配置解析与投影。

设置页提供禁用全部外部插件。若插件阻碍正常启动，可使用 `--disable-external-plugins` 参数启动，再在设置页关闭或移除插件；安全启动不激活插件、不晋升待更新版本。

## 网页交互试用

入口是 `/playground/plugins`。浏览目录、选择插件和读取说明不会执行其代码；点击“开始试用”后才创建该插件的独立编辑器。固定分享链接包含安装来源，桌面粘贴“安装地址”后验证同一产物。

guest 是单独构建的 HTML/模块入口，不导入普通 App，也不初始化草稿、文件系统和 AI 配置。父页面完成下载与校验，通过一次性建立的专用 MessageChannel 传入包、示例与主题；不提供宿主操作桥接。

iframe 只设置 `sandbox="allow-scripts"`，不授予 `allow-same-origin`、顶层导航、弹窗、表单或下载权限。guest 无法访问父页面存储，设置只保存在内存。CSP 禁止连接请求与远程图片等资源；JS/CSS 静态资源必须带 CORS 响应头，供 opaque origin 加载，Vite preview 和 Vercel 配置均已处理。

沙箱不能终止无限循环脚本，也不能跨浏览器可靠阻止 iframe 导航自身；不要将不普遍支持的 CSP `navigate-to` 当作网络隔离保证。试用边界保护正式应用的文档和存储，不宣称任意代码完全没有外部网络副作用。

## 验证入口

- `pnpm lint`、`pnpm test`、`pnpm typecheck`：全仓库约束与测试。
- `pnpm --filter @md-editor/web build`，随后 `pnpm --filter @md-editor/web test:browser`：真实 opaque iframe 加载、命令编辑、撤销、停用和存储/连接限制。
- `pnpm --filter @md-editor/desktop test`、`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml plugin_storage`：桌面接入、缓存与原生存储。
- `pnpm --filter @md-editor/plugin-sdk build` 与打包导入测试：独立发布契约。外部作者路径在模板仓库中用 `npm install`、`npm run typecheck`、`npm run build` 验证。

浏览器测试使用模拟的 GitHub Release 产物，不向真实仓库发布内容。真实线上可用需要按发布流程部署 Worker/Web、发布 SDK 与桌面版本。
