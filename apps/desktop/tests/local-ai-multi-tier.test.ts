import { describe, expect, it } from "vitest";
import {
  BUILTIN_LOCAL_MODELS,
  formatSystemSpecsLabel,
  getRecommendedModelId,
  mergeLocalAiModelStatus,
  toLocalAiModelCommandStatus,
} from "../src/app/ai/local-ai-model-state";
import {
  localModelProgressLabel,
  localModelStatusLabel,
} from "../src/components/settings/settingsUtils";

describe("local AI multi-tier models and system specs", () => {
  it("includes Lite (0.5B), Standard (1.5B), and Pro (placeholder) descriptors", () => {
    expect(BUILTIN_LOCAL_MODELS.map((m) => m.id)).toEqual([
      "md-editor-writer-lite",
      "md-editor-writer-standard",
      "md-editor-writer-pro",
    ]);

    const lite = BUILTIN_LOCAL_MODELS.find((m) => m.id === "md-editor-writer-lite");
    const standard = BUILTIN_LOCAL_MODELS.find((m) => m.id === "md-editor-writer-standard");
    const pro = BUILTIN_LOCAL_MODELS.find((m) => m.id === "md-editor-writer-pro");

    expect(lite?.isAvailable).toBe(true);
    expect(lite?.recommendedMemoryGb).toBe(4);

    expect(standard?.isAvailable).toBe(true);
    expect(standard?.recommendedMemoryGb).toBe(8);

    expect(pro?.isAvailable).toBe(false);
    expect(pro?.displayName).toBe("Pro");
    expect(pro?.parameterSize).toBe("");
  });

  it("recommends Standard model for devices with >= 8GB memory and Lite for < 8GB", () => {
    expect(
      getRecommendedModelId({
        totalMemoryBytes: 16 * 1024 * 1024 * 1024,
        cpuArch: "aarch64",
        os: "macos",
        cpuCores: 8,
      }),
    ).toBe("md-editor-writer-standard");

    expect(
      getRecommendedModelId({
        totalMemoryBytes: 8 * 1024 * 1024 * 1024,
        cpuArch: "x86_64",
        os: "windows",
        cpuCores: 8,
      }),
    ).toBe("md-editor-writer-standard");

    expect(
      getRecommendedModelId({
        totalMemoryBytes: 4 * 1024 * 1024 * 1024,
        cpuArch: "x86_64",
        os: "linux",
        cpuCores: 4,
      }),
    ).toBe("md-editor-writer-lite");
  });

  it("formats system specs labels concisely", () => {
    expect(
      formatSystemSpecsLabel({
        totalMemoryBytes: 16 * 1024 * 1024 * 1024,
        cpuArch: "aarch64",
        os: "macos",
        cpuCores: 8,
      }),
    ).toBe("Apple Silicon / ARM64 · 16 GB 内存");

    expect(
      formatSystemSpecsLabel({
        totalMemoryBytes: 8 * 1024 * 1024 * 1024,
        cpuArch: "x86_64",
        os: "windows",
        cpuCores: 12,
      }),
    ).toBe("x86_64 12 核 CPU · 8 GB 内存");
  });

  it("tracks model version, latest version, and update readiness", () => {
    const status = toLocalAiModelCommandStatus({
      modelId: "md-editor-writer-lite",
      version: "v0.0.0-beta",
      latestVersion: "v0.1.0-beta",
      hasUpdate: true,
      status: "available",
      downloadedBytes: 491_400_032,
      totalBytes: 491_400_032,
    });

    expect(status.hasUpdate).toBe(true);
    expect(status.version).toBe("v0.0.0-beta");
    expect(status.latestVersion).toBe("v0.1.0-beta");
    expect(localModelStatusLabel(status.status, status.hasUpdate)).toBe("发现新版本");
    expect(localModelProgressLabel(status)).toContain("可更新至 v0.1.0-beta");

    const merged = mergeLocalAiModelStatus(
      {
        enabled: true,
        modelId: "md-editor-writer-lite",
        version: null,
        status: "not-downloaded",
        downloadedBytes: 0,
        totalBytes: 0,
        error: null,
      },
      status,
    );
    expect(merged.hasUpdate).toBe(true);
    expect(merged.latestVersion).toBe("v0.1.0-beta");
  });

  it("ensures un-downloaded model does not show in-use badge", () => {
    const unDownloadedStatus = toLocalAiModelCommandStatus({
      modelId: "md-editor-writer-lite",
      status: "not-downloaded",
    });
    expect(unDownloadedStatus.status).toBe("not-downloaded");
    expect(localModelStatusLabel(unDownloadedStatus.status)).toBe("未下载");
  });
});
