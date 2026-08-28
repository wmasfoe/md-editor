import type { TranslationSchema } from "../types";

export const zh: TranslationSchema = {
  meta: {
    title: "Inkpoint · 本地优先的 Markdown / MDX 桌面编辑器",
    description: "Inkpoint（墨点）是简洁的本地 Markdown 和 MDX 桌面编辑器。",
  },
  header: {
    changelog: "更新记录",
    changelogShort: "更新",
    github: "GitHub",
    download: "下载",
    langSwitchAria: "切换语言",
  },
  hero: {
    tagline: "写得更专注",
    subtitle: "本地优先的桌面编辑器。文件留在磁盘上，用来处理日常写作、MDX 内容和桌面文件流。",
    latestPrefix: "最新",
    allPackages: "全部安装包",
  },
  download: {
    tablistAria: "选择下载平台",
    primaryMacos: "下载 macOS",
    primaryLinux: "下载 Linux",
    primaryWindows: "下载 Windows",
    secondaryLinuxArm64: "ARM64 AppImage",
    secondaryWindowsArm64: "ARM64 安装包",
    installMacosTitle: "终端一键安装",
    installMacosExtra: "若提示「已损坏」，移除隔离标记",
    installLinuxTitle: "终端一键安装",
    installWindowsTitle: "PowerShell 一键安装",
    recommendedTag: "推荐",
    copyButton: "复制",
    copiedButton: "已复制",
    copyCommandAria: "复制安装命令",
  },
  features: {
    sectionAria: "主要能力",
    items: [
      {
        title: "本地优先",
        description: "文件就在你的磁盘上。无需账号，也不依赖云同步。",
      },
      {
        title: "Markdown / MDX",
        description: "日常写作与组件化内容同一套编辑体验。",
      },
      {
        title: "桌面工作流",
        description: "文件树、最近文件、图片粘贴与原生菜单开箱即用。",
      },
    ],
  },
  status: {
    latestTitle: "最新版本",
    allChangelog: "全部记录",
    downloadVersion: "下载此版本",
    historyVersions: "历史版本",
    noChangelog: "暂无更新记录",
    webAppTitle: "Web App",
    webAppStatus: "计划中",
    webAppDescription: "第一版官网只保留入口状态，不提供在线编辑器。完整产品形态仍是桌面端 Inkpoint。",
    notOpenYet: "暂未开放",
  },
  changelog: {
    title: "更新记录",
    badge: "Releases",
    descriptionPrefix: "每个版本的变更说明。内容来自仓库根目录",
    descriptionSuffix: "。",
    empty: "暂无更新记录。",
    listAria: "更新记录列表",
    latestBadge: "最新",
    backHome: "返回首页",
  },
  footer: {
    summary: "Inkpoint，本地优先的 Markdown / MDX 桌面编辑器",
    github: "GitHub",
  },
};
