import type { TranslationSchema } from "../types";

export const en: TranslationSchema = {
  meta: {
    title: "Inkpoint · Local-First Markdown and MDX Desktop Editor",
    description: "Inkpoint is a distraction-free, local-first Markdown and MDX desktop editor.",
  },
  header: {
    changelog: "Changelog",
    changelogShort: "Log",
    github: "GitHub",
    download: "Download",
    langSwitchAria: "Switch language",
  },
  hero: {
    tagline: "Focus on Writing",
    subtitle:
      "A local-first desktop editor. Files stay safely on disk for everyday writing, MDX content, and desktop workflows.",
    latestPrefix: "Latest",
    allPackages: "All Releases",
  },
  download: {
    tablistAria: "Select download platform",
    primaryMacos: "Download for macOS",
    primaryLinux: "Download for Linux",
    primaryWindows: "Download for Windows",
    secondaryLinuxArm64: "ARM64 AppImage",
    secondaryWindowsArm64: "ARM64 Setup",
    installMacosTitle: "One-line Terminal Install",
    installMacosExtra: 'If prompted "damaged", remove quarantine attribute',
    installLinuxTitle: "One-line Terminal Install",
    installWindowsTitle: "PowerShell One-line Install",
    recommendedTag: "Recommended",
    copyButton: "Copy",
    copiedButton: "Copied",
    copyCommandAria: "Copy install command",
  },
  features: {
    sectionAria: "Key Features",
    items: [
      {
        title: "Local-First",
        description:
          "Your files stay directly on your disk. No account required, zero cloud dependency.",
      },
      {
        title: "Markdown / MDX",
        description:
          "A seamless editing experience for everyday writing and componentized content.",
      },
      {
        title: "Desktop Workflow",
        description:
          "Built-in file tree, recent documents, image pasting, and native menus out of the box.",
      },
    ],
  },
  status: {
    latestTitle: "Latest Release",
    allChangelog: "All Records",
    downloadVersion: "Download this version",
    historyVersions: "Release History",
    noChangelog: "No release records available",
    webAppTitle: "Web App",
    webAppStatus: "Planned",
    webAppDescription:
      "The first website version only acts as an entry point without an online editor. The core product remains the desktop Inkpoint.",
    notOpenYet: "Coming Soon",
  },
  changelog: {
    title: "Changelog",
    badge: "Releases",
    descriptionPrefix: "Release notes for each version. Sourced from",
    descriptionSuffix: "in the repository root.",
    empty: "No changelog entries found.",
    listAria: "Changelog timeline",
    latestBadge: "Latest",
    backHome: "Back to Home",
  },
  footer: {
    summary: "Inkpoint, a local-first Markdown / MDX desktop editor",
    github: "GitHub",
  },
};
