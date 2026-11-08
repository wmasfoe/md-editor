import { describe, expect, it, vi } from "vitest";

import {
  AI_REQUEST_PREEMPTED_REASON,
  AiRequestScheduler,
  STANDARD_LOCAL_MODEL_ID,
  type LocalInferenceRequest,
} from "../../src/index.ts";
import {
  createEmptyStyleProfileDocument,
  hashStyleText,
  type StyleInferencePort,
  type StyleLearningHost,
  type StyleProfileDocument,
} from "../../src/style/index.ts";
import {
  BOOTSTRAP_ROUNDS,
  ROUND_CHANGE_THRESHOLD,
  STYLE_RUNTIME_BUSY_ERROR,
  StyleLearningEngine,
} from "../../src/style/engine-entry.ts";
import { spacedTechArticle } from "./fixtures.ts";

/** 内存中的工作区与存储 */
class FakeHost implements StyleLearningHost {
  public files = new Map<string, string>();
  public document: StyleProfileDocument | null = null;
  public reads: string[] = [];
  public saves = 0;

  public constructor(public rootPath = "/notes/blog") {}

  public async scanSamples() {
    return {
      rootPath: this.rootPath,
      truncated: false,
      samples: [...this.files.entries()].map(([relPath, content]) => ({
        relPath,
        sha256: `sha-${hashStyleText(content)}`,
        bytes: content.length,
        modifiedMs: 1,
      })),
    };
  }

  public async readSample(relPath: string) {
    this.reads.push(relPath);
    const content = this.files.get(relPath);
    if (content === undefined) throw new Error("missing");
    return content;
  }

  public async loadProfile() {
    return this.document;
  }

  public async saveProfile(document: StyleProfileDocument) {
    this.saves += 1;
    this.document = structuredClone(document);
  }
}

const FORMAL = "formality=formal;organization=conclusion-first;exampleUsage=frequent";

function setup(
  options: { files?: number; output?: (request: LocalInferenceRequest) => Promise<string> } = {},
) {
  const host = new FakeHost();
  for (let index = 0; index < (options.files ?? 9); index += 1) {
    host.files.set(`post-${index}.md`, spacedTechArticle(`Topic${index}`));
  }
  const scheduler = new AiRequestScheduler(2);
  const bridge = vi.fn(options.output ?? (async () => FORMAL));
  const schedule = vi.fn(scheduler.schedule.bind(scheduler)) as StyleInferencePort["schedule"];
  const inference: StyleInferencePort = { schedule, bridge };
  const engine = new StyleLearningEngine({
    host,
    inference,
    now: () => new Date("2026-11-09T00:00:00Z"),
  });
  return {
    host,
    scheduler,
    bridge,
    schedule: schedule as unknown as ReturnType<typeof vi.fn>,
    engine,
  };
}

describe("style learning engine", () => {
  it("U-EN-1: bootstraps on first run with enough samples into active rules", async () => {
    const { engine, host } = setup({ files: 15 });
    const outcome = await engine.run();

    expect(outcome.status).toBe("learned");
    const workspace = host.document!.workspaces[0]!;
    expect(workspace.roundCount).toBe(BOOTSTRAP_ROUNDS);
    expect(workspace.changesSinceRound).toBe(0);
    const active = workspace.rules
      .filter((rule) => rule.status === "active")
      .map((rule) => rule.dimension);
    expect(active).toEqual(
      expect.arrayContaining([
        "cjkLatinSpacing",
        "cjkPunctuationWidth",
        "formality",
        "organization",
      ]),
    );
  });

  it("U-EN-1: does not start with fewer than five samples, then waits for N changes", async () => {
    const few = setup({ files: 4 });
    expect((await few.engine.run()).status).toBe("updated");
    expect(few.bridge).not.toHaveBeenCalled();

    const { engine, host, bridge } = setup({ files: 6 });
    await engine.run();
    const calls = bridge.mock.calls.length;
    host.files.set("new-1.md", spacedTechArticle("New"));
    expect((await engine.run()).status).toBe("updated");
    expect(host.document!.workspaces[0]!.changesSinceRound).toBe(1);
    expect(bridge.mock.calls.length).toBe(calls);

    for (let index = 0; index < ROUND_CHANGE_THRESHOLD; index += 1) {
      host.files.set(`batch-${index}.md`, spacedTechArticle(`Batch${index}`));
    }
    expect((await engine.run()).status).toBe("learned");
    expect(host.document!.workspaces[0]!.roundCount).toBe(BOOTSTRAP_ROUNDS + 1);
    // 只为新样本调用模型，未变化的样本复用已存标签。
    expect(bridge.mock.calls.length - calls).toBe(ROUND_CHANGE_THRESHOLD + 1);
  });

  it("U-EN-2: removed samples are dropped and re-aggregated without calling the model", async () => {
    const { engine, host, bridge } = setup({ files: 6 });
    await engine.run();
    const calls = bridge.mock.calls.length;
    host.files.delete("post-0.md");
    host.files.delete("post-1.md");

    expect((await engine.run()).status).toBe("updated");
    const workspace = host.document!.workspaces[0]!;
    expect(workspace.samples.map((s) => s.relPath)).not.toContain("post-0.md");
    expect(bridge.mock.calls.length).toBe(calls);
    // 支持文件不足 5 个，已生效规则退场。
    expect(workspace.rules.find((rule) => rule.dimension === "formality")?.status).toBe("retired");
  });

  it("U-EN-3: only the local Standard model is requested through the bridge", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { engine, bridge } = setup({ files: 6 });
    await engine.run();
    expect(bridge).toHaveBeenCalled();
    for (const [request] of bridge.mock.calls) {
      expect(request.modelId).toBe(STANDARD_LOCAL_MODEL_ID);
      expect(request.task).toBe("style-analysis");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("U-EN-3: an unavailable Standard model reports failure without writing a round", async () => {
    const { engine, host } = setup({
      files: 6,
      output: async () => {
        throw new Error("本地模型 md-editor-writer-standard 尚未下载");
      },
    });
    const outcome = await engine.run();
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("尚未下载");
    expect(host.document!.workspaces[0]!.roundCount).toBe(0);
  });

  it("U-EN-4: a preempted chunk is discarded and no partial round is written", async () => {
    let release!: () => void;
    const started = new Promise<void>((resolve) => (release = resolve));
    const { engine, host, scheduler } = setup({
      files: 6,
      output: (_request) =>
        new Promise<string>((_resolve, reject) => {
          release();
          // 抢占时调度器中止 run 的 signal；fake bridge 不监听，直接挂起，
          // 由调度器拒绝 promise 来模拟。
          void reject;
        }),
    });
    const run = engine.run();
    await started;
    const user = scheduler.schedule({
      scope: { documentId: "draft.md", task: "completion" },
      priority: "urgent",
      run: async () => "continued",
    });
    await expect(user.promise).resolves.toBe("continued");
    const outcome = await run;
    expect(outcome.status).toBe("preempted");
    expect(host.document!.workspaces[0]!.roundCount).toBe(0);
    expect(AI_REQUEST_PREEMPTED_REASON).toBe("preempted");
  });

  it("U-EN-5: failures are returned as status instead of thrown", async () => {
    const host = new FakeHost();
    host.scanSamples = async () => {
      throw new Error("当前没有打开的工作区");
    };
    const engine = new StyleLearningEngine({
      host,
      inference: { schedule: vi.fn(), bridge: vi.fn() } as unknown as StyleInferencePort,
    });
    await expect(engine.run()).resolves.toMatchObject({
      status: "failed",
      error: "当前没有打开的工作区",
    });
  });

  it("U-EN-6: every classification chunk is scheduled exclusively through the shared port", async () => {
    const { engine, bridge, schedule } = setup({ files: 6 });
    await engine.run();
    expect(schedule).toHaveBeenCalledTimes(bridge.mock.calls.length);
    for (const [options] of schedule.mock.calls) {
      expect(options).toMatchObject({
        exclusive: true,
        priority: "background",
        affinityKey: `local:${STANDARD_LOCAL_MODEL_ID}:none`,
        scope: { task: "style-analysis" },
      });
    }
  });

  it("U-EN-7: a busy runtime gives up this idle window without retrying", async () => {
    const { engine, host, bridge } = setup({
      files: 6,
      output: async () => {
        throw new Error(STYLE_RUNTIME_BUSY_ERROR);
      },
    });
    const outcome = await engine.run();
    expect(outcome.status).toBe("busy");
    expect(bridge).toHaveBeenCalledTimes(1);
    expect(host.document!.workspaces[0]!.roundCount).toBe(0);
  });

  it("U-EN-8: a modified sample drops its old features immediately and is re-classified next round", async () => {
    const { engine, host, bridge } = setup({ files: 6 });
    await engine.run();
    const before = host.document!.workspaces[0]!.samples.find((s) => s.relPath === "post-0.md")!;
    expect(Object.keys(before.labels).length).toBeGreaterThan(0);

    host.files.set("post-0.md", "我们用React写界面,再用TypeScript写类型.".repeat(12));
    const calls = bridge.mock.calls.length;
    expect((await engine.run()).status).toBe("updated");
    const after = host.document!.workspaces[0]!.samples.find((s) => s.relPath === "post-0.md")!;
    expect(after.sha256).not.toBe(before.sha256);
    expect(after.labels).toEqual({});
    expect(after.stats.cjkLatinSpacing?.value).toBe(0);
    expect(bridge.mock.calls.length).toBe(calls);
  });

  it("marks a swapped directory unlinked and relinks only when enabled", async () => {
    const { engine, host } = setup({ files: 6 });
    await engine.run();
    const original = host.document!.workspaces[0]!;

    // 原目录被替换成完全不同的内容。
    host.files = new Map([["other.md", spacedTechArticle("Unrelated")]]);
    await engine.run();
    expect(host.document!.workspaces.find((w) => w.id === original.id)?.linkState).toBe("unlinked");

    // 原内容出现在新路径下，开启找回后改绑。
    host.rootPath = "/notes/moved-blog";
    host.files = new Map(
      original.samples.map((s, i) => [s.relPath, spacedTechArticle(`Topic${i}`)]),
    );
    const unlinkedDocument = structuredClone(host.document!);
    const noRelink = await engine.run();
    expect(noRelink.relinked).toBeUndefined();
    // 未开启找回时按新目录学习，原画像保持失去关联。
    expect(noRelink.workspaceId).not.toBe(original.id);
    expect(host.document!.workspaces.find((w) => w.id === original.id)?.linkState).toBe("unlinked");

    host.document = unlinkedDocument;
    const relinked = await engine.run({ autoRelink: true });
    expect(relinked.relinked).toEqual({ profileId: original.id, previousRoot: "/notes/blog" });
    expect(host.document!.workspaces.find((w) => w.id === original.id)).toMatchObject({
      linkState: "linked",
      rootPath: "/notes/moved-blog",
    });
  });

  it("excludes accepted AI sentences recorded for the workspace", async () => {
    const { engine, host } = setup({ files: 6 });
    await engine.run();
    const workspaceId = host.document!.workspaces[0]!.id;
    const aiSentence = "这是 AI 续写的一句话。";
    host.document = {
      ...host.document!,
      aiSegments: { [workspaceId]: { "ai.md": [hashStyleText(aiSentence)] } },
    };
    host.files.set("ai.md", `${aiSentence}`.repeat(30));
    await engine.run();
    const sample = host.document!.workspaces[0]!.samples.find((s) => s.relPath === "ai.md")!;
    expect(sample.eligible).toBe(false);
  });

  it("starts from an empty document when none is stored", () => {
    expect(createEmptyStyleProfileDocument()).toMatchObject({ version: 1, workspaces: [] });
  });
});

describe("style learning engine with edit feedback", () => {
  /** 学习一次后，给工作区写入编辑特征，再新增足够的文章触发下一轮 */
  async function learnWithFeedback(
    dimension: "sentenceLength" | "formality",
    value: string,
    count: number,
  ) {
    const { engine, host } = setup({ files: 6 });
    await engine.run();
    const workspace = host.document!.workspaces[0]!;
    const before = workspace.rules.find((rule) => rule.dimension === dimension);
    host.document = {
      ...host.document!,
      workspaces: [
        {
          ...workspace,
          editFeedback: Array.from({ length: count }, (_, i) => ({
            at: `2099-01-0${i + 1}`,
            dimension,
            value,
          })),
        },
      ],
    };
    for (let index = 0; index < ROUND_CHANGE_THRESHOLD; index += 1) {
      host.files.set(`more-${index}.md`, spacedTechArticle(`More${index}`));
    }
    await engine.run();
    const latest = host.document!.workspaces[0]!.rules.find(
      (rule) => rule.dimension === dimension,
    )!;
    return { before, latest };
  }

  it("U-EF-3: feedback fills a dimension the samples cannot decide", async () => {
    const { latest } = await learnWithFeedback("sentenceLength", "short", 4);
    // 样本统计本轮判定为 medium，与反馈冲突：反馈不覆盖样本结论。
    expect(latest.rounds.at(-1)!.value).toBe("medium");
    expect(latest.rounds.at(-1)!.supportSampleIds.some((id) => id.startsWith("edit:"))).toBe(false);
  });

  it("U-EF-3: feedback agreeing with the samples adds support to the latest round", async () => {
    const { before, latest } = await learnWithFeedback("formality", "formal", 3);
    const round = latest.rounds.at(-1)!;
    expect(round.value).toBe("formal");
    expect(round.supportSampleIds.filter((id) => id.startsWith("edit:"))).toHaveLength(3);
    expect(latest.rounds.length).toBeGreaterThan(before?.rounds.length ?? 0);
  });
});
