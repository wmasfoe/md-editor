import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  resolveSentrySourcemapTarget,
  sentryReleaseName,
  sentryViteReleaseOptions,
  shouldEmitDesktopSourcemaps,
  shouldUploadDesktopSourcemaps,
  warnSentryUploadFailure,
} from "../src/app/error-reporting/sentry-release.ts";

describe("sentry sourcemap upload contract", () => {
  it("uses the same release the SDK reports and never sets dist", () => {
    expect(sentryReleaseName("0.19.2")).toBe("inkpoint@0.19.2");
    const release = sentryViteReleaseOptions("0.19.2");
    expect(release.name).toBe("inkpoint@0.19.2");
    expect(release).not.toHaveProperty("dist");
    expect(release.finalize).toBe(false);
    expect(release.setCommits).toBe(false);
  });

  it("uploads only when SENTRY_AUTH_TOKEN is set and keeps org/project defaults", () => {
    expect(resolveSentrySourcemapTarget({}, "0.19.2")).toEqual({
      upload: false,
      authToken: undefined,
      org: "lijiaqi",
      project: "inkpoint",
      releaseName: "inkpoint@0.19.2",
    });

    const configured = resolveSentrySourcemapTarget(
      {
        SENTRY_AUTH_TOKEN: "  token  ",
        SENTRY_ORG: " other-org ",
        SENTRY_PROJECT: "",
      },
      "1.2.3",
    );
    expect(configured.upload).toBe(true);
    expect(configured.authToken).toBe("token");
    expect(configured.org).toBe("other-org");
    expect(configured.project).toBe("inkpoint");
    expect(configured.releaseName).toBe("inkpoint@1.2.3");
  });

  it("treats the desktop production build as shippable and skips tests", () => {
    expect(shouldEmitDesktopSourcemaps({ npm_lifecycle_event: "build" }, [])).toBe(true);
    expect(shouldEmitDesktopSourcemaps({ npm_lifecycle_event: "test" }, ["build"])).toBe(false);
    expect(shouldEmitDesktopSourcemaps({ npm_lifecycle_event: "test:bundle" }, [])).toBe(false);
    expect(shouldEmitDesktopSourcemaps({ VITEST: "true", npm_lifecycle_event: "build" }, [])).toBe(
      false,
    );
    expect(shouldEmitDesktopSourcemaps({}, ["/repo/node_modules/vite/bin/vite.js", "build"])).toBe(
      true,
    );
    expect(
      shouldEmitDesktopSourcemaps({}, [
        "node",
        "apps/desktop/scripts/code-language-bundle-probe.mjs",
      ]),
    ).toBe(false);
  });

  it("uploads hidden sourcemaps only when a shippable build has a token", () => {
    expect(shouldUploadDesktopSourcemaps({ npm_lifecycle_event: "build" }, [], "0.22.3")).toBe(
      false,
    );
    expect(
      shouldUploadDesktopSourcemaps(
        { npm_lifecycle_event: "build", SENTRY_AUTH_TOKEN: "  token  " },
        [],
        "0.22.3",
      ),
    ).toBe(true);
    expect(
      shouldUploadDesktopSourcemaps(
        { npm_lifecycle_event: "test", SENTRY_AUTH_TOKEN: "token" },
        ["build"],
        "0.22.3",
      ),
    ).toBe(false);
    expect(
      shouldUploadDesktopSourcemaps({ VITEST: "true", SENTRY_AUTH_TOKEN: "token" }, [], "0.22.3"),
    ).toBe(false);
  });

  it("wires strip and guard into the desktop and web build scripts", () => {
    const desktop = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      scripts: { build: string };
    };
    const web = JSON.parse(
      readFileSync(new URL("../../web/package.json", import.meta.url), "utf8"),
    ) as { scripts: { build: string } };
    expect(desktop.scripts.build).toContain("strip-sourcemaps.mjs dist");
    expect(desktop.scripts.build).toContain("assert-no-sourcemaps.mjs dist");
    expect(desktop.scripts.build.indexOf("vite build")).toBeLessThan(
      desktop.scripts.build.indexOf("strip-sourcemaps.mjs"),
    );
    expect(web.scripts.build).toContain("assert-no-sourcemaps.mjs dist");
  });

  it("warns instead of failing the build when sourcemap upload fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => warnSentryUploadFailure(new Error("401 Unauthorized"))).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("401 Unauthorized");
    warn.mockRestore();

    const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(viteConfig).toContain("errorHandler: warnSentryUploadFailure");
    expect(viteConfig).toContain('filesToDeleteAfterUpload: ["./dist/**/*.map"]');
    expect(viteConfig).toContain('sourcemap: uploadSourcemaps ? "hidden" : false');
    expect(viteConfig).toContain("sentryViteReleaseOptions(packageJson.version)");
    expect(viteConfig).toContain("shouldUploadDesktopSourcemaps");
  });

  it("injects the Sentry token only in release workflows", () => {
    const pullRequestBuild = readFileSync(
      new URL("../../../.github/workflows/build-desktop.yml", import.meta.url),
      "utf8",
    );
    expect(pullRequestBuild).not.toContain("SENTRY_AUTH_TOKEN");
    expect(pullRequestBuild).not.toContain("note-sentry-auth.mjs");
    expect(pullRequestBuild).toContain("assert-no-sourcemaps.mjs");
    const releaseDesktop = readFileSync(
      new URL("../../../.github/workflows/release-desktop.yml", import.meta.url),
      "utf8",
    );
    const releaseBeta = readFileSync(
      new URL("../../../.github/workflows/release-beta.yml", import.meta.url),
      "utf8",
    );
    expect(releaseDesktop).toContain("SENTRY_AUTH_TOKEN");
    expect(releaseBeta).toContain("SENTRY_AUTH_TOKEN");
    expect(releaseDesktop).toContain("note-sentry-auth.mjs");
    expect(releaseBeta).toContain("note-sentry-auth.mjs");
  });
});
