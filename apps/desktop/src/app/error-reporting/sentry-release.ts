/**
 * @fileoverview Sentry release 契约
 *
 * 运行时 `Sentry.init({ release })` 与生产构建上传 source map 必须使用同一 release，
 * 且两边都不设置 dist。事件里没有 dist 时，带 dist 的 artifact 对不上。
 * 符号解析优先走 Debug ID（@sentry/vite-plugin 注入），release 只负责归组。
 */

/** 与 Sentry 项目对应的默认 org / project。CI 可用同名变量覆盖，token 不在这里。 */
export const SENTRY_ORG_DEFAULT = "lijiaqi";
export const SENTRY_PROJECT_DEFAULT = "inkpoint";

export interface SentrySourcemapEnv {
  SENTRY_AUTH_TOKEN?: string;
  SENTRY_ORG?: string;
  SENTRY_PROJECT?: string;
  VITEST?: string;
  npm_lifecycle_event?: string;
}

/** 客户端上报的 release。上传 source map 时必须原样使用。 */
export function sentryReleaseName(version: string): string {
  return `inkpoint@${version}`;
}

export interface SentrySourcemapTarget {
  /** 没有 token 时不上传，调用方仍要删除本地 source map。 */
  upload: boolean;
  authToken?: string;
  org: string;
  project: string;
  releaseName: string;
}

export function resolveSentrySourcemapTarget(
  env: SentrySourcemapEnv,
  version: string,
): SentrySourcemapTarget {
  const authToken = env.SENTRY_AUTH_TOKEN?.trim() ?? "";
  const org = env.SENTRY_ORG?.trim() || SENTRY_ORG_DEFAULT;
  const project = env.SENTRY_PROJECT?.trim() || SENTRY_PROJECT_DEFAULT;
  return {
    upload: authToken.length > 0,
    authToken: authToken || undefined,
    org,
    project,
    releaseName: sentryReleaseName(version),
  };
}

/**
 * 上传失败时只警告。插件默认会抛错并中断 Vite；
 * 这里吞掉错误，让后面的 strip 和 assert 照常执行。
 * GitHub Actions 里写成 `::warning::`，失败会出现在 run summary。绝不打印 token。
 */
export function warnSentryUploadFailure(error: Error): void {
  const detail = sentryUploadFailureDetail(error);
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning::${detail}`);
    return;
  }
  console.warn(detail);
}

/** 把失败原因收成一行，并抹掉环境里的 token，避免它出现在日志或注解里。 */
function sentryUploadFailureDetail(error: Error): string {
  const token = process.env.SENTRY_AUTH_TOKEN?.trim() ?? "";
  const message = token.length > 0 ? error.message.split(token).join("[redacted]") : error.message;
  const singleLine = message.replace(/[\r\n]+/gu, " ");
  return `[sentry] Sourcemap upload failed; continuing the build and still removing local maps. ${singleLine}`;
}

/**
 * 插件写入 Sentry 的 release 选项。故意不含 `dist`：SDK 也不设置 dist。
 * 并行平台构建共用一个 release，因此不在这里 finalize，也不做 commit 关联
 * （浅克隆上 `setCommits` 会让发版失败，且与符号解析无关）。
 */
export function sentryViteReleaseOptions(version: string): {
  name: string;
  inject: true;
  create: true;
  finalize: false;
  setCommits: false;
  deploy: false;
} {
  return {
    name: sentryReleaseName(version),
    inject: true,
    create: true,
    finalize: false,
    setCommits: false,
    deploy: false,
  };
}

/**
 * 这次命令是不是会打进安装包的桌面生产构建。
 * Vitest 与包体探针（`pnpm test` / `test:bundle`）会加载这份 Vite 配置，
 * 但它们不是发版产物，生成 map 只会拖慢测试。
 * 这个函数不看 token。真正写出 `.map` 还要 `shouldUploadDesktopSourcemaps` 为真。
 */
export function isShippableDesktopBuild(env: SentrySourcemapEnv, argv: readonly string[]): boolean {
  if (env.VITEST === "true") {
    return false;
  }
  const lifecycle = env.npm_lifecycle_event ?? "";
  if (lifecycle === "test" || lifecycle.startsWith("test:")) {
    return false;
  }
  if (lifecycle === "build") {
    return true;
  }
  const invokedVite = argv.some((arg) => /(^|[\\/])vite(\.js)?$/u.test(arg) || arg === "vite");
  return invokedVite && argv.includes("build");
}

/**
 * 只有发版生产构建且配置了 `SENTRY_AUTH_TOKEN` 时才生成 hidden source map 并上传。
 * 没有 token 时不挂插件、也不写 `.map`，本地、fork 和 PR 构建的产物里不会留下源码映射。
 */
export function shouldUploadDesktopSourcemaps(
  env: SentrySourcemapEnv,
  argv: readonly string[],
  version: string,
): boolean {
  return isShippableDesktopBuild(env, argv) && resolveSentrySourcemapTarget(env, version).upload;
}

/** 有 token 的发版构建写 hidden map 供上传；否则 Vite 不生成 `.map`。 */
export function desktopSourcemapSetting(upload: boolean): "hidden" | false {
  return upload ? "hidden" : false;
}

/**
 * 传给 `@sentry/vite-plugin` 的选项。
 * `filesToDeleteAfterUpload` 在 writeBundle 的 finally 里删除 map，上传失败也会删。
 * release 不含 dist，与 `Sentry.init` 一致。
 */
export function desktopSentryVitePluginOptions(target: SentrySourcemapTarget, version: string) {
  return {
    org: target.org,
    project: target.project,
    authToken: target.authToken,
    telemetry: false as const,
    errorHandler: warnSentryUploadFailure,
    release: sentryViteReleaseOptions(version),
    sourcemaps: {
      assets: "./dist/**",
      filesToDeleteAfterUpload: ["./dist/**/*.map"],
    },
  };
}
