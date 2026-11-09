import { describe, expect, it, vi } from "vitest";
import {
  AiRequestScheduler,
  DEFAULT_AI_SETTINGS,
  LITE_LOCAL_MODEL_ID,
  STANDARD_LOCAL_MODEL_ID,
  type AiSettings,
} from "@md-editor/ai";
import {
  createEmptyStyleProfileDocument,
  hashStyleText,
  type StyleLearningOutcome,
  type StyleProfileDocument,
} from "@md-editor/ai/style";
import { StyleLearningEngine } from "@md-editor/ai/style-engine";
import {
  LOCAL_RUNTIME_COLD_MS,
  STYLE_LEARNING_IDLE_MS,
  StyleLearningCoordinator,
  recordAcceptedAiText,
  renameExclusions,
  renameInStyleDocument,
  type StyleLearningEnvironment,
  type StyleLearningRunner,
} from "../../../src/app/ai/style-learning/style-learning-coordinator";
import { workspaceRelativePath } from "../../../src/app/ai/style-learning/paths";

/** 可手动推进时间的环境 */
function createEnvironment(overrides: Partial<StyleLearningEnvironment> = {}) {
  let now = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let nextId = 1;
  const env: StyleLearningEnvironment = {
    now: () => now,
    setTimer: (callback, delayMs) => {
      const id = nextId++;
      timers.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimer: (handle) => timers.delete(handle as number),
    isDocumentDirty: () => false,
    isWindowVisible: () => true,
    ...overrides,
  };
  const advance = async (ms: number) => {
    now += ms;
    // 回调里可能注册新定时器，先取快照再遍历。
    for (const [id, timer] of Array.from(timers)) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
    await Promise.resolve();
    await Promise.resolve();
  };
  return { env, advance };
}

const enabledSettings: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  provider: "openai",
  styleLearning: { ...DEFAULT_AI_SETTINGS.styleLearning, enabled: true },
};

function outcome(status: StyleLearningOutcome["status"] = "learned"): StyleLearningOutcome {
  return { status, document: createEmptyStyleProfileDocument() };
}

describe("style learning coordinator", () => {
  it("I-1: never runs while style learning is disabled (the default)", async () => {
    const { env, advance } = createEnvironment();
    const runner: StyleLearningRunner = { run: vi.fn(async () => outcome()) };
    const coordinator = new StyleLearningCoordinator(env, runner);
    coordinator.update({
      settings: DEFAULT_AI_SETTINGS,
      standardModelReady: true,
      rootPath: "/notes",
    });
    expect(DEFAULT_AI_SETTINGS.styleLearning.enabled).toBe(false);

    coordinator.noteWorkspaceChanged();
    await advance(STYLE_LEARNING_IDLE_MS * 10);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("I-3: does not run without the Standard model or an open workspace", async () => {
    const { env, advance } = createEnvironment();
    const runner: StyleLearningRunner = { run: vi.fn(async () => outcome()) };
    const coordinator = new StyleLearningCoordinator(env, runner);
    coordinator.update({
      settings: enabledSettings,
      standardModelReady: false,
      rootPath: "/notes",
    });
    await advance(STYLE_LEARNING_IDLE_MS * 2);
    coordinator.update({ settings: enabledSettings, standardModelReady: true, rootPath: null });
    await advance(STYLE_LEARNING_IDLE_MS * 2);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("runs only after two minutes without input, with a saved document and a visible window", async () => {
    let dirty = true;
    let visible = false;
    const { env, advance } = createEnvironment({
      isDocumentDirty: () => dirty,
      isWindowVisible: () => visible,
    });
    const runner: StyleLearningRunner = { run: vi.fn(async () => outcome()) };
    const coordinator = new StyleLearningCoordinator(env, runner);
    coordinator.update({ settings: enabledSettings, standardModelReady: true, rootPath: "/notes" });

    await advance(STYLE_LEARNING_IDLE_MS - 1);
    coordinator.noteUserInput();
    await advance(STYLE_LEARNING_IDLE_MS);
    expect(runner.run).not.toHaveBeenCalled();

    dirty = false;
    visible = true;
    await advance(STYLE_LEARNING_IDLE_MS);
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: "/notes", autoRelink: false }),
    );
  });

  it("does not rescan while idle; a change or an unfinished round schedules the next run", async () => {
    const { env, advance } = createEnvironment();
    const results: StyleLearningOutcome[] = [
      outcome("learned"),
      outcome("preempted"),
      outcome("idle"),
    ];
    const runner: StyleLearningRunner = {
      run: vi.fn(async () => results.shift() ?? outcome("idle")),
    };
    const coordinator = new StyleLearningCoordinator(env, runner);
    coordinator.update({ settings: enabledSettings, standardModelReady: true, rootPath: "/notes" });

    await advance(STYLE_LEARNING_IDLE_MS);
    expect(runner.run).toHaveBeenCalledTimes(1);
    // 学完之后一直空闲：不再扫描。
    await advance(STYLE_LEARNING_IDLE_MS * 20);
    expect(runner.run).toHaveBeenCalledTimes(1);

    // 保存文档带来新变化；本轮被抢占，稍后自动继续；继续后无变化则停下。
    coordinator.noteWorkspaceChanged();
    await advance(STYLE_LEARNING_IDLE_MS);
    expect(runner.run).toHaveBeenCalledTimes(2);
    await advance(STYLE_LEARNING_IDLE_MS);
    expect(runner.run).toHaveBeenCalledTimes(3);
    await advance(STYLE_LEARNING_IDLE_MS * 20);
    expect(runner.run).toHaveBeenCalledTimes(3);
  });

  it("PRD 2.6: counts learnable windows per day and resets per-round metrics", async () => {
    const { env, advance } = createEnvironment();
    const runner: StyleLearningRunner = { run: vi.fn(async () => outcome("learned")) };
    const coordinator = new StyleLearningCoordinator(env, runner);
    coordinator.update({ settings: enabledSettings, standardModelReady: true, rootPath: "/notes" });
    await advance(STYLE_LEARNING_IDLE_MS);
    expect(coordinator.getMetrics()).toMatchObject({
      preemptions: 0,
      modelSwitches: 0,
      learnableWindowsToday: 1,
    });
    coordinator.noteWorkspaceChanged();
    await advance(STYLE_LEARNING_IDLE_MS);
    expect(coordinator.getMetrics().learnableWindowsToday).toBe(2);
  });

  it("I-2: turning style learning off cancels a running round", async () => {
    const { env, advance } = createEnvironment();
    let signal: AbortSignal | undefined;
    const runner: StyleLearningRunner = {
      run: vi.fn(
        (input) =>
          new Promise<StyleLearningOutcome>(() => {
            signal = input.signal;
          }),
      ),
    };
    const coordinator = new StyleLearningCoordinator(env, runner);
    coordinator.update({ settings: enabledSettings, standardModelReady: true, rootPath: "/notes" });
    await advance(STYLE_LEARNING_IDLE_MS);
    expect(signal?.aborted).toBe(false);

    coordinator.update({
      settings: DEFAULT_AI_SETTINGS,
      standardModelReady: true,
      rootPath: "/notes",
    });
    expect(signal?.aborted).toBe(true);
  });

  it("I-11: waits for a hot Lite runtime to go cold; Standard or cloud may learn right away", async () => {
    const lite: AiSettings = {
      ...enabledSettings,
      provider: "local",
      localModel: { ...enabledSettings.localModel, modelId: LITE_LOCAL_MODEL_ID },
    };
    const { env, advance } = createEnvironment();
    const runner: StyleLearningRunner = { run: vi.fn(async () => outcome()) };
    const coordinator = new StyleLearningCoordinator(env, runner);
    coordinator.update({ settings: lite, standardModelReady: true, rootPath: "/notes" });
    coordinator.noteLocalAiUse();

    expect(coordinator.runtimeAllowsLearning()).toBe(false);
    await advance(STYLE_LEARNING_IDLE_MS);
    expect(runner.run).not.toHaveBeenCalled();
    await advance(LOCAL_RUNTIME_COLD_MS);
    expect(runner.run).toHaveBeenCalledTimes(1);

    const standard: AiSettings = {
      ...lite,
      localModel: { ...lite.localModel, modelId: STANDARD_LOCAL_MODEL_ID },
    };
    coordinator.update({ settings: standard, standardModelReady: true, rootPath: "/notes" });
    coordinator.noteLocalAiUse();
    expect(coordinator.runtimeAllowsLearning()).toBe(true);
    coordinator.update({ settings: enabledSettings, standardModelReady: true, rootPath: "/notes" });
    expect(coordinator.runtimeAllowsLearning()).toBe(true);
  });

  it("I-6 and I-15: only a successful relink notifies; failures stay silent", async () => {
    const { env, advance } = createEnvironment();
    const onRelinked = vi.fn();
    const onDocumentChanged = vi.fn();
    const results: StyleLearningOutcome[] = [
      { ...outcome("failed"), error: "boom" },
      {
        ...outcome("learned"),
        relinked: { profileId: "ws-1", previousRoot: "/old/notes" },
      },
    ];
    const runner: StyleLearningRunner = { run: vi.fn(async () => results.shift()!) };
    const coordinator = new StyleLearningCoordinator(env, runner, {
      onRelinked,
      onDocumentChanged,
    });
    coordinator.update({ settings: enabledSettings, standardModelReady: true, rootPath: "/notes" });

    await advance(STYLE_LEARNING_IDLE_MS);
    expect(onRelinked).not.toHaveBeenCalled();
    await advance(STYLE_LEARNING_IDLE_MS);
    // 回调必须带上画像 id，提示里的“撤销”才能定位到这份画像。
    expect(onRelinked).toHaveBeenCalledWith({
      fromRoot: "/old/notes",
      toRoot: "/notes",
      profileId: "ws-1",
    });
    expect(onDocumentChanged).toHaveBeenCalledTimes(2);
  });

  it("I-13: a manual continuation on the shared scheduler preempts learning and cancels the bridge call", async () => {
    const scheduler = new AiRequestScheduler(2);
    const cancelled: string[] = [];
    const bridge = vi.fn(
      (_request, options?: { signal?: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          // 模拟桌面 bridge：取消时通知 Rust 并让请求失败。
          options?.signal?.addEventListener("abort", () => {
            cancelled.push("cancel_local_ai_request");
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const files = new Map(
      Array.from({ length: 6 }, (_, index) => [
        `post-${index}.md`,
        `# 第 ${index} 篇\n\n${"我们先给结论，再解释 React 和 TypeScript 的设计。".repeat(8)}`,
      ]),
    );
    let stored: StyleProfileDocument | null = null;
    const engine = new StyleLearningEngine({
      host: {
        scanSamples: async () => ({
          rootPath: "/notes",
          truncated: false,
          samples: [...files].map(([relPath, content]) => ({
            relPath,
            sha256: hashStyleText(content),
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
      inference: { schedule: (options) => scheduler.schedule(options), bridge },
    });

    const learning = engine.run();
    await vi.waitFor(() => expect(bridge).toHaveBeenCalled());
    const continuation = scheduler.schedule({
      scope: { documentId: "draft.md", task: "completion" },
      priority: "urgent",
      run: async () => "续写结果",
    });

    await expect(continuation.promise).resolves.toBe("续写结果");
    expect(cancelled).toEqual(["cancel_local_ai_request"]);
    await expect(learning).resolves.toMatchObject({ status: "preempted" });
  });
});

function base(): StyleProfileDocument {
  return {
    ...createEmptyStyleProfileDocument(),
    workspaces: [
      {
        id: "ws-1",
        rootPath: "/notes",
        linkState: "linked",
        samples: [
          {
            id: "s1",
            relPath: "diary/a.md",
            sha256: "x",
            paragraphHashes: [],
            eligible: true,
            stats: {},
            labels: {},
          },
        ],
        rules: [],
        roundCount: 0,
        changesSinceRound: 0,
      },
    ],
  };
}

describe("style learning document helpers", () => {
  it("I-7: records accepted AI text as sentence hashes only", () => {
    const next = recordAcceptedAiText(base(), "ws-1", "post.md", "第一句。第二句！");
    const hashes = next.aiSegments["ws-1"]?.["post.md"];
    expect(hashes).toEqual([hashStyleText("第一句。"), hashStyleText("第二句！")]);
    expect(JSON.stringify(next)).not.toContain("第一句");
    const document = base();
    expect(recordAcceptedAiText(document, "ws-1", "post.md", "   ")).toBe(document);
  });

  it("syncs sample paths, AI segments and exclusions after an in-app rename", () => {
    const withSegments = recordAcceptedAiText(base(), "ws-1", "diary/a.md", "一句。");
    const renamed = renameInStyleDocument(withSegments, "/notes", "diary", "journal");
    expect(renamed.workspaces[0]!.samples[0]!.relPath).toBe("journal/a.md");
    expect(Object.keys(renamed.aiSegments["ws-1"]!)).toEqual(["journal/a.md"]);
    expect(renameInStyleDocument(withSegments, "/other", "diary", "journal")).toBe(withSegments);
    expect(renameExclusions(["diary", "notes/x.md"], "diary", "journal")).toEqual([
      "journal",
      "notes/x.md",
    ]);
  });

  it("computes workspace relative paths across platforms", () => {
    expect(workspaceRelativePath("/notes", "/notes/a/b.md")).toBe("a/b.md");
    expect(workspaceRelativePath("/notes/", "/notes/a.md")).toBe("a.md");
    expect(workspaceRelativePath("C:\\notes", "C:\\notes\\a\\b.md")).toBe("a/b.md");
    expect(workspaceRelativePath("/notes", "/notes-old/a.md")).toBeNull();
  });
});
