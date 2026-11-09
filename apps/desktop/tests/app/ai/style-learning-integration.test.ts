// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  AiRequestScheduler,
  DEFAULT_AI_SETTINGS,
  DEFAULT_STYLE_LEARNING_SETTINGS,
  STANDARD_LOCAL_MODEL_ID,
  createAiWritingService,
  type AiSettings,
  type ModelClient,
  type ModelContext,
} from "@md-editor/ai";
import { createEmptyStyleProfileDocument } from "@md-editor/ai/style";
import { StyleLearningEngine } from "@md-editor/ai/style-engine";
import { StyleLearningSettings } from "../../../src/components/settings/style-learning/StyleLearningSettings";
import { useStyleLearningStore } from "../../../src/app/ai/style-learning/style-learning-store";
import { useFileTreeStore } from "../../../src/app/stores/file-tree-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 有足够散文、分类结果稳定的 6 篇文章 */
function article(index: number): string {
  return `# 第 ${index} 篇\n\n${"我们先给结论，再解释 React 和 TypeScript 的设计。".repeat(8)}`;
}

/** I-12：假桥下完整跑一轮：扫描 → 首学 → 设置页出现生效规则 */
describe("I-12: a full learning round surfaces active rules in settings", () => {
  it("learns from the workspace and renders the learned rules", async () => {
    const files = new Map(
      Array.from({ length: 6 }, (_, index) => [`post-${index}.md`, article(index)]),
    );
    let stored: ReturnType<typeof createEmptyStyleProfileDocument> | null = null;
    const bridge = vi.fn(
      async () => "formality=formal;organization=conclusion-first;exampleUsage=rare",
    );
    const engine = new StyleLearningEngine({
      host: {
        scanSamples: async () => ({
          rootPath: "/notes",
          truncated: false,
          samples: [...files].map(([relPath, content]) => ({
            relPath,
            sha256: `sha-${relPath}-${content.length}`,
            bytes: content.length,
            modifiedMs: 1,
          })),
        }),
        readSample: async (relPath) => files.get(relPath)!,
        loadProfile: async () => stored,
        updateProfile: async (mutate) => {
          stored = mutate(stored ?? createEmptyStyleProfileDocument());
          return stored;
        },
      },
      inference: { schedule: (options) => new AiRequestScheduler(2).schedule(options), bridge },
    });

    const outcome = await engine.run();
    expect(outcome.status).toBe("learned");
    useStyleLearningStore.getState().setProfile(stored);
    useFileTreeStore.setState({ folder: { rootPath: "/notes", tree: null } as never });

    const container = document.createElement("div");
    document.body.append(container);
    const root: Root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(StyleLearningSettings, {
          aiSettingsDraft: {
            ...DEFAULT_AI_SETTINGS,
            styleLearning: { ...DEFAULT_STYLE_LEARNING_SETTINGS, enabled: true },
          },
          onChangeAiSettings: vi.fn(),
          standardModelReady: true,
          onDownloadStandardModel: vi.fn(),
        }),
      ),
    );

    const active = container.querySelector("[data-testid=style-active-rules]");
    expect(active?.textContent).toContain("语气正式");
    expect(active?.textContent).toContain("先给结论");
    // 状态行显示上次学习时间、样本数与生效规则数。
    expect(container.querySelector("[data-testid=style-status-line]")?.textContent).toMatch(
      /参与样本 6 篇 · 生效规则 \d+ 条/u,
    );
    act(() => root.unmount());
    container.remove();
  });
});

/** I-16：工作区画像失去关联时，三条写作路径都不附带该工作区画像 */
/** 返回固定输出并记录请求的写作服务 */
function recordingService() {
  const contexts: ModelContext[] = [];
  const client = {
    generate: vi.fn(async (context: ModelContext) => {
      contexts.push(context);
      return { text: "组件。" };
    }),
  } as unknown as ModelClient;
  const service = createAiWritingService({ allowLocal: true });
  (service as unknown as { resolveClient: () => ModelClient }).resolveClient = () => client;
  return { service, contexts };
}

describe("I-16: an unlinked workspace contributes no workspace profile", () => {
  const workspaceRule = {
    dimension: "termScript" as const,
    value: "keep-english",
    status: "active" as const,
    rounds: [],
  };
  const globalRule = {
    dimension: "cjkLatinSpacing" as const,
    value: "spaced",
    status: "active" as const,
    rounds: [],
  };
  const profile = {
    ...createEmptyStyleProfileDocument(),
    workspaces: [
      {
        id: "ws-1",
        rootPath: "/notes",
        linkState: "unlinked" as const,
        unlinkedSince: "2026-11-01T00:00:00Z",
        samples: [],
        rules: [workspaceRule],
        roundCount: 3,
        changesSinceRound: 0,
      },
    ],
    global: { rules: [globalRule], roundCount: 3 },
  };

  const settings: AiSettings = {
    ...DEFAULT_AI_SETTINGS,
    provider: "local",
    localModel: {
      ...DEFAULT_AI_SETTINGS.localModel,
      enabled: true,
      modelId: STANDARD_LOCAL_MODEL_ID,
      status: "available",
    },
    features: { ...DEFAULT_AI_SETTINGS.features, continuation: true, editing: true },
    styleLearning: { ...DEFAULT_STYLE_LEARNING_SETTINGS, enabled: true },
  };
  const snapshot = {
    before: "我们今天讨论 React 的渲染",
    after: "",
    selectedText: "我们今天讨论 React 的渲染",
    mode: "wysiwyg" as const,
    document: { filePath: "/notes/post.md" },
  };

  it("merges only the global layer for an unlinked workspace", async () => {
    const { service, contexts } = recordingService();
    // 失去关联：verifiedRoot 为 null，工作区画像不参与合并。
    const { resolveMergedStyleProfile } =
      await import("../../../src/app/ai/style-learning/style-learning-store");
    const merged = resolveMergedStyleProfile(profile, "/notes", null);
    expect(merged?.rules.map((rule) => rule.dimension)).toEqual(["cjkLatinSpacing"]);

    await service.continueWriting(settings, snapshot, { profile: merged, isGhostText: false });
    await service.predictUnifiedEdit(settings, snapshot, { profile: merged });
    await service.fixGrammar(settings, snapshot, { profile: merged });

    // 续写使用完整前缀；纠错使用宽容版前缀（只列机械书写习惯）。
    const continuation = `${contexts[0]!.instruction ?? ""}`;
    expect(continuation).toContain("中文与英文、数字之间加空格");
    expect(continuation).toContain("优先级低于当前文章");
    for (const context of contexts) {
      const text = `${context.instruction ?? ""}\n${context.prompt}`;
      expect(text).not.toContain("技术术语保留英文原文");
    }
  });
});
