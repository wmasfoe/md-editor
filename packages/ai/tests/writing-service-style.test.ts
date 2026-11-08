import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AI_SETTINGS,
  LITE_LOCAL_MODEL_ID,
  STANDARD_LOCAL_MODEL_ID,
  createAiWritingService,
  type AiContextSnapshot,
  type AiSettings,
  type ModelClient,
  type ModelContext,
} from "../src/index.ts";
import { mergeStyleProfile, styleCloudScope } from "../src/style/index.ts";

const RULE_TEXT = "技术术语保留英文原文，不翻译。";
const profile = mergeStyleProfile({
  workspace: [{ dimension: "termScript", value: "keep-english", status: "active", rounds: [] }],
});

const snapshot: AiContextSnapshot = {
  before: "我们今天讨论 React 的渲染",
  after: "",
  selectedText: "",
  mode: "wysiwyg",
  document: { filePath: "/notes/excluded/post.md" },
};

function withStyle(settings: AiSettings, patch: Partial<AiSettings["styleLearning"]>): AiSettings {
  return {
    ...settings,
    enabled: true,
    features: { ...settings.features, continuation: true, editing: true },
    styleLearning: { ...settings.styleLearning, enabled: true, ...patch },
  };
}

function local(modelId: string, patch: Partial<AiSettings["styleLearning"]> = {}): AiSettings {
  return withStyle(
    {
      ...DEFAULT_AI_SETTINGS,
      provider: "local",
      localModel: {
        ...DEFAULT_AI_SETTINGS.localModel,
        enabled: true,
        modelId,
        status: "available",
      },
    },
    patch,
  );
}

const cloudBase: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  provider: "openai",
  endpoints: {
    ...DEFAULT_AI_SETTINGS.endpoints,
    openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o", apiKey: "sk" },
  },
};

function recordingService() {
  const contexts: ModelContext[] = [];
  const client: ModelClient = {
    provider: "openai",
    modelId: "test",
    generate: vi.fn(async (context: ModelContext) => {
      contexts.push(context);
      return { text: "组件。" };
    }),
  } as unknown as ModelClient;
  const service = createAiWritingService({ allowLocal: true });
  (service as unknown as { resolveClient: () => ModelClient }).resolveClient = () => client;
  return { service, contexts };
}

const allText = (context: ModelContext) =>
  `${context.instruction ?? ""}\n${context.prompt}\n${context.rawCompletion?.prompt ?? ""}`;

describe("writing service style profile gate", () => {
  it("I-14: local Standard continuation carries the profile prefix", async () => {
    const { service, contexts } = recordingService();
    await service.continueWriting(local(STANDARD_LOCAL_MODEL_ID), snapshot, {
      isGhostText: false,
      profile,
    });
    expect(contexts[0]!.instruction).toContain(RULE_TEXT);
    expect(contexts[0]!.instruction).toContain("[写作偏好]");
  });

  it("I-18: a document excluded from learning still gets continuation with the workspace profile", async () => {
    // 排除只影响学习样本；服务层不感知文件是否被排除。
    const { service, contexts } = recordingService();
    const result = await service.continueWriting(local(STANDARD_LOCAL_MODEL_ID), snapshot, {
      isGhostText: false,
      profile,
    });
    expect(result.hasContinuation).toBe(true);
    expect(contexts[0]!.instruction).toContain(RULE_TEXT);
  });

  it("U-WS-1: disabled learning or missing cloud consent never sends the profile", async () => {
    const { service, contexts } = recordingService();
    await service.continueWriting(local(STANDARD_LOCAL_MODEL_ID, { enabled: false }), snapshot, {
      profile,
    });
    await service.continueWriting(withStyle(cloudBase, {}), snapshot, { profile });
    await service.predictUnifiedEdit(withStyle(cloudBase, {}), snapshot, { profile });
    for (const context of contexts) {
      expect(allText(context)).not.toContain(RULE_TEXT);
    }

    const consent = { ...styleCloudScope(cloudBase), grantedAt: "2026-11-09T00:00:00Z" };
    await service.continueWriting(withStyle(cloudBase, { cloudConsent: consent }), snapshot, {
      profile,
    });
    await service.predictUnifiedEdit(withStyle(cloudBase, { cloudConsent: consent }), snapshot, {
      profile,
    });
    expect(contexts.at(-2)!.instruction).toContain(RULE_TEXT);
    expect(contexts.at(-1)!.instruction).toContain(RULE_TEXT);
    // 云端只收到规则文字，不含路径、hash 或维度 id。
    expect(contexts.at(-1)!.instruction).not.toMatch(/termScript|keep-english|sha|\.md/u);
  });

  it("U-WS-2: Lite never carries the profile on FIM or local GEC branches", async () => {
    const { service, contexts } = recordingService();
    const lite = local(LITE_LOCAL_MODEL_ID);
    // 行尾 → FIM 续写
    await service.continueWriting(lite, snapshot, { profile });
    await service.predictUnifiedEdit(lite, snapshot, { profile });
    // 句中 → 本地 GEC 分支
    await service.predictUnifiedEdit(
      lite,
      { ...snapshot, before: "我们今天讨论", after: " React 的渲染" },
      { profile },
    );
    expect(contexts).toHaveLength(3);
    for (const context of contexts) {
      expect(allText(context)).not.toContain(RULE_TEXT);
      expect(allText(context)).not.toContain("写作偏好");
    }
  });
});

/** 返回固定输出并记录请求的纠错服务 */
function gecService(output: string) {
  const contexts: ModelContext[] = [];
  const client = {
    generate: vi.fn(async (context: ModelContext) => {
      contexts.push(context);
      return { text: output };
    }),
  } as unknown as ModelClient;
  const service = createAiWritingService({ allowLocal: true });
  (service as unknown as { resolveClient: () => ModelClient }).resolveClient = () => client;
  return { service, contexts };
}

describe("grammar fix with writing preferences", () => {
  const gecProfile = mergeStyleProfile({
    workspace: [
      { dimension: "termScript", value: "keep-english", status: "active", rounds: [] },
      { dimension: "cjkLatinSpacing", value: "spaced", status: "active", rounds: [] },
    ],
  });
  const text = "我门用React写界面";
  const gecSnapshot: AiContextSnapshot = { ...snapshot, before: "", after: "", selectedText: text };

  const modelOutput = '[[0, 2, "我门", "我们"], [3, 8, "React", "反应"]]';

  it("U-GEC-1/2: drops habit conflicts, adds style suggestions and keeps kinds separate", async () => {
    const { service } = gecService(modelOutput);
    const result = await service.fixGrammar(local(STANDARD_LOCAL_MODEL_ID), gecSnapshot, {
      profile: gecProfile,
    });
    expect(result.edit?.diffs?.map((diff) => [diff.kind, diff.original, diff.replacement])).toEqual(
      [
        ["fix", "我门", "我们"],
        ["style", "用R", "用 R"],
        ["style", "t写", "t 写"],
      ],
    );
  });

  it("U-GEC-1: the cloud prompt explains user habits as not being errors", async () => {
    const { service, contexts } = gecService("[]");
    const consent = { ...styleCloudScope(cloudBase), grantedAt: "t" };
    await service.fixGrammar(withStyle(cloudBase, { cloudConsent: consent }), gecSnapshot, {
      profile: gecProfile,
    });
    expect(contexts[0]!.instruction).toContain("不视为错误");
    expect(contexts[0]!.instruction).toContain("技术术语保留英文原文");
  });

  it("U-GEC-3: without an allowed profile the result matches the model output", async () => {
    const { service } = gecService(modelOutput);
    const off = await service.fixGrammar(
      local(STANDARD_LOCAL_MODEL_ID, { enabled: false }),
      gecSnapshot,
      { profile: gecProfile },
    );
    expect(off.edit?.diffs?.map((diff) => diff.replacement)).toEqual(["我们", "反应"]);
    const lite = await service.fixGrammar(local(LITE_LOCAL_MODEL_ID), gecSnapshot, {
      profile: gecProfile,
    });
    expect(lite.edit?.diffs?.map((diff) => diff.replacement)).toEqual(["我们", "反应"]);
  });
});
